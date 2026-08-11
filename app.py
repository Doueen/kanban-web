"""Hermes Kanban Web — FastAPI backend.

Reads go straight to SQLite (read-only, see db.py). Every write is executed
via the `hermes kanban` CLI (see kanban_cli.py). HTTP Basic Auth guards every
route using KANBAN_WEB_USER / KANBAN_WEB_PASS env vars (default: hermes /
generated-at-startup, printed to stderr on boot).
"""
import json
import os
import secrets
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles

import db
import kanban_cli

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = Path(os.environ.get("KANBAN_WEB_UPLOAD_DIR", "/tmp/kanban-web-uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

WEB_USER = os.environ.get("KANBAN_WEB_USER") or "hermes"
WEB_PASS = os.environ.get("KANBAN_WEB_PASS")
if not WEB_PASS:
    WEB_PASS = secrets.token_urlsafe(12)
    print("[kanban-web] KANBAN_WEB_USER=%s KANBAN_WEB_PASS=%s" % (WEB_USER, WEB_PASS), file=sys.stderr)

app = FastAPI(title="Hermes Kanban Web", docs_url=None, redoc_url=None, openapi_url=None)
security = HTTPBasic()


def require_auth(creds: HTTPBasicCredentials = Depends(security)) -> str:
    user_ok = secrets.compare_digest(creds.username, WEB_USER)
    pass_ok = secrets.compare_digest(creds.password, WEB_PASS)
    if not (user_ok and pass_ok):
        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Basic"},
        )
    return creds.username


def _run_write(fn, *args, **kwargs):
    """Run a CLI write op; return its stdout as the API payload or a 400."""
    try:
        proc = fn(*args, **kwargs)
    except kanban_cli.CLIError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return JSONResponse({"ok": True, "message": kanban_cli.summary(proc)})


def _reason_payload(payload, default="via web"):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    return payload.get("note") or default


# --- read endpoints ---------------------------------------------------------

@app.get("/api/board", dependencies=[Depends(require_auth)])
def api_board():
    return {
        "statuses": db.get_board(),
        "assignees": db.get_assignees(),
    }


@app.get("/api/tasks", dependencies=[Depends(require_auth)])
def api_tasks(status: str = None, assignee: str = None, q: str = None, archived: str = None):
    include_archived = archived in ("1", "true", "yes")
    if status and status not in db.STATUS_LABELS:
        raise HTTPException(status_code=400, detail="invalid status")
    return db.fetch_tasks(status=status, assignee=assignee, q=q, include_archived=include_archived)


@app.get("/api/tasks/{task_id}", dependencies=[Depends(require_auth)])
def api_task_detail(task_id: str):
    detail = db.get_task(task_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="task not found")
    return detail


@app.get("/api/stats", dependencies=[Depends(require_auth)])
def api_stats():
    try:
        proc = kanban_cli.run_checked(["stats", "--json"])
        try:
            return json.loads(proc.stdout or "{}")
        except ValueError:
            return db.stats_fallback()
    except kanban_cli.CLIError:
        return db.stats_fallback()


# --- write endpoints --------------------------------------------------------

@app.post("/api/tasks", dependencies=[Depends(require_auth)])
async def api_create_task(request: Request):
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    try:
        proc = kanban_cli.create(
            title=title,
            body=body.get("body"),
            assignee=body.get("assignee") or None,
            priority=body.get("priority"),
            parents=[p for p in (body.get("parent") or []) if p],
            workspace=body.get("workspace") or None,
            triage=bool(body.get("triage")),
        )
    except kanban_cli.CLIError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    task_id = None
    try:
        task_id = json.loads(proc.stdout or "{}").get("id")
    except ValueError:
        pass
    return {"ok": True, "id": task_id, "message": kanban_cli.summary(proc)}


@app.post("/api/tasks/{task_id}/action", dependencies=[Depends(require_auth)])
async def api_task_action(task_id: str, request: Request):
    body = await request.json()
    action = body.get("action") if isinstance(body, dict) else None
    note = body.get("note") if isinstance(body, dict) else None

    handlers = {
        "complete": lambda: kanban_cli.complete(task_id),
        "block": lambda: kanban_cli.block(task_id, _reason_payload({"note": note}, "blocked via web")),
        "unblock": lambda: kanban_cli.unblock(task_id, note),
        "schedule": lambda: kanban_cli.schedule(task_id, _reason_payload({"note": note}, "scheduled via web")),
        "promote": lambda: kanban_cli.promote(task_id, _reason_payload({"note": note}, "via web")),
        "request-review": lambda: kanban_cli.request_review(task_id),
        "reopen-review": lambda: kanban_cli.reopen_review(task_id, note),
        "request-changes": lambda: kanban_cli.request_changes(task_id, _reason_payload({"note": note}, "changes requested")),
        "archive": lambda: kanban_cli.archive(task_id),
        "reclaim": lambda: kanban_cli.reclaim(task_id, note),
    }
    fn = handlers.get(action)
    if fn is None:
        raise HTTPException(status_code=400, detail="unknown action")
    return _run_write(fn)


@app.post("/api/tasks/{task_id}/assign", dependencies=[Depends(require_auth)])
async def api_assign(task_id: str, request: Request):
    body = await request.json()
    assignee = (body.get("assignee") or "").strip()
    if not assignee:
        raise HTTPException(status_code=400, detail="assignee is required")
    return _run_write(kanban_cli.assign, task_id, assignee)


@app.post("/api/tasks/{task_id}/comment", dependencies=[Depends(require_auth)])
async def api_comment(task_id: str, request: Request):
    body = await request.json()
    text = (body.get("body") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="comment body is required")
    return _run_write(kanban_cli.comment, task_id, text)


@app.post("/api/tasks/{task_id}/link", dependencies=[Depends(require_auth)])
async def api_link(task_id: str, request: Request):
    body = await request.json()
    other_id = (body.get("other_id") or "").strip()
    if not other_id:
        raise HTTPException(status_code=400, detail="other_id is required")
    direction = body.get("direction")
    if direction == "parent":
        parent_id, child_id = other_id, task_id
    elif direction == "child":
        parent_id, child_id = task_id, other_id
    else:
        parent_id, child_id = sorted([task_id, other_id])
    return _run_write(kanban_cli.link, parent_id, child_id)


@app.delete("/api/tasks/{task_id}/link/{other_id}", dependencies=[Depends(require_auth)])
async def api_unlink(task_id: str, other_id: str, direction: str = None):
    if direction == "parent":
        parent_id, child_id = other_id, task_id
    elif direction == "child":
        parent_id, child_id = task_id, other_id
    else:
        parent_id, child_id = sorted([task_id, other_id])
    return _run_write(kanban_cli.unlink, parent_id, child_id)


@app.post("/api/tasks/{task_id}/set-model", dependencies=[Depends(require_auth)])
async def api_set_model(task_id: str, request: Request):
    body = await request.json()
    model = (body.get("model") or "").strip() or None
    provider = (body.get("provider") or "").strip() or None
    return _run_write(kanban_cli.set_model, task_id, model, provider)


@app.post("/api/tasks/{task_id}/attachments", dependencies=[Depends(require_auth)])
async def api_upload_attachment(task_id: str, file: UploadFile = File(...)):
    suffix = Path(file.filename or "upload").suffix or ""
    target = UPLOAD_DIR / ("%s%s" % (secrets.token_hex(8), suffix))
    try:
        content = await file.read()
        target.write_bytes(content)
        return _run_write(kanban_cli.attach, task_id, str(target))
    finally:
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass


@app.get("/api/tasks/{task_id}/attachments", dependencies=[Depends(require_auth)])
def api_list_attachments(task_id: str):
    detail = db.get_task(task_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="task not found")
    return detail["attachments"]


@app.delete("/api/tasks/{task_id}/attachments/{aid}", dependencies=[Depends(require_auth)])
async def api_delete_attachment(task_id: str, aid: int):
    detail = db.get_task(task_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="task not found")
    if not any(a["id"] == aid for a in detail["attachments"]):
        raise HTTPException(status_code=404, detail="attachment not found")
    return _run_write(kanban_cli.attach_rm, aid)


# --- static frontend --------------------------------------------------------

app.mount("/", StaticFiles(directory=str(BASE_DIR / "static"), html=True), name="static")
