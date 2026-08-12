"""Hermes Kanban Web — FastAPI backend (v2, multi-board).

Reads go straight to SQLite (read-only, see db.py). Every write is executed
via the `hermes kanban` CLI (see kanban_cli.py). HTTP Basic Auth guards every
route using KANBAN_WEB_USER / KANBAN_WEB_PASS env vars (default: hermes /
generated-at-startup, printed to stderr on boot).
"""
import json
import os
import secrets
import shutil
import sys
from pathlib import Path

import yaml

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
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
security = HTTPBasic(auto_error=False)


def require_auth(creds: HTTPBasicCredentials = Depends(security)) -> str:
    if creds is None:
        # 未提供凭据 → 统一 401 无 WWW-Authenticate 头，
        # 浏览器不弹原生框，由前端自定义登录页接管。
        raise HTTPException(status_code=401, detail="Unauthorized")
    user_ok = secrets.compare_digest(creds.username, WEB_USER)
    pass_ok = secrets.compare_digest(creds.password, WEB_PASS)
    if not (user_ok and pass_ok):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return creds.username


def _run_write(fn, *args, **kwargs):
    """Run a CLI write op; return its stdout as the API payload or a 400."""
    try:
        proc = fn(*args, **kwargs)
    except kanban_cli.CLIError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return JSONResponse({"ok": True, "message": kanban_cli.summary(proc)})


def _run_json(fn, *args, **kwargs):
    """Run a CLI op that emits --json; parse and return it or raise a 400/500."""
    try:
        proc = fn(*args, **kwargs)
    except kanban_cli.CLIError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        return json.loads(proc.stdout or "{}")
    except ValueError:
        raise HTTPException(status_code=500, detail="CLI returned invalid JSON")


def _run_text(fn, *args, **kwargs):
    """Run a CLI op and return its raw stdout as a plain-text response."""
    try:
        proc = fn(*args, **kwargs)
    except kanban_cli.CLIError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return PlainTextResponse(proc.stdout or "")


def _reason_payload(payload, default="via web"):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="body must be a JSON object")
    return payload.get("note") or default


async def _json_body(request, required=False):
    try:
        return await request.json()
    except Exception:
        if required:
            raise HTTPException(status_code=400, detail="body must be a JSON object")
        return {}


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


# --- boards -----------------------------------------------------------------

# 交付产物下载白名单前缀（绝对路径，可扩展）
DL_ALLOWED_PREFIXES = (
    "/opt/hermes/kanban/",   # 所有 board 工作目录与数据区
    "/root/notes/",          # 笔记/交付目录
)

@app.get("/api/download", dependencies=[Depends(require_auth)])
def api_download(path: str = Query(...)):
    """下载交付产物（白名单路径内只读文件）。"""
    p = os.path.realpath(path)
    if not any(p.startswith(pre) for pre in DL_ALLOWED_PREFIXES):
        raise HTTPException(403, "路径不在允许下载范围内")
    if not os.path.isfile(p):
        raise HTTPException(404, "文件不存在")
    return FileResponse(p, filename=os.path.basename(p), media_type="application/octet-stream")

@app.get("/api/boards", dependencies=[Depends(require_auth)])
def api_boards():
    return _run_json(kanban_cli.boards_list, include_archived=True)


@app.get("/api/boards/current", dependencies=[Depends(require_auth)])
def api_current_board():
    slug = db.current_board_slug()
    name = None
    try:
        for b in _run_json(kanban_cli.boards_list, include_archived=True):
            if b.get("slug") == slug:
                name = b.get("name") or slug
                break
    except HTTPException:
        pass
    return {"slug": slug, "name": name or slug}


@app.post("/api/boards", dependencies=[Depends(require_auth)])
async def api_create_board(request: Request):
    body = await _json_body(request, required=True)
    slug = (body.get("slug") or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="slug is required")
    return _run_write(
        kanban_cli.boards_create, slug,
        name=(body.get("name") or "").strip() or None,
        description=(body.get("description") or "").strip() or None,
        icon=(body.get("icon") or "").strip() or None,
        color=(body.get("color") or "").strip() or None,
    )


@app.post("/api/boards/{slug}/switch", dependencies=[Depends(require_auth)])
def api_board_switch(slug: str):
    res = _run_write(kanban_cli.boards_switch, slug)
    db.refresh_current_board()
    return res


@app.post("/api/boards/{slug}/restore", dependencies=[Depends(require_auth)])
def api_board_restore(slug: str):
    """恢复已归档 board（归档 = 目录移入 _archived，恢复 = 移回）。"""
    boards_dir = Path.home() / ".hermes" / "kanban" / "boards"
    arch_dir = boards_dir / "_archived"
    if not arch_dir.is_dir():
        raise HTTPException(404, "未找到归档的 board")
    cands = sorted(arch_dir.glob(f"{slug}-*"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not cands:
        raise HTTPException(404, "未找到归档的 board")
    src = cands[0]
    dst = boards_dir / slug
    if dst.exists():
        dst = boards_dir / f"{slug}-restored"
    shutil.move(str(src), str(dst))
    db.refresh_current_board()
    return {"ok": True, "message": f"已恢复 board「{slug}」"}


@app.post("/api/boards/{slug}/rename", dependencies=[Depends(require_auth)])
async def api_rename_board(slug: str, request: Request):
    body = await _json_body(request, required=True)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    return _run_write(kanban_cli.boards_rename, slug, name)


@app.post("/api/boards/{slug}/workdir", dependencies=[Depends(require_auth)])
async def api_set_board_workdir(slug: str, request: Request):
    body = await _json_body(request)
    path = (body.get("path") or "").strip() or None
    return _run_write(kanban_cli.boards_set_workdir, slug, path)


@app.delete("/api/boards/{slug}", dependencies=[Depends(require_auth)])
async def api_delete_board(slug: str, request: Request):
    body = await _json_body(request)
    delete = bool(body.get("delete")) if isinstance(body, dict) else False
    return _run_write(kanban_cli.boards_rm, slug, delete=delete)


# --- write endpoints --------------------------------------------------------

@app.post("/api/tasks", dependencies=[Depends(require_auth)])
async def api_create_task(request: Request):
    body = await _json_body(request, required=True)
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
    body = await _json_body(request)
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
    body = await _json_body(request, required=True)
    assignee = (body.get("assignee") or "").strip()
    if not assignee:
        raise HTTPException(status_code=400, detail="assignee is required")
    return _run_write(kanban_cli.assign, task_id, assignee)


@app.post("/api/tasks/{task_id}/comment", dependencies=[Depends(require_auth)])
async def api_comment(task_id: str, request: Request):
    body = await _json_body(request, required=True)
    text = (body.get("body") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="comment body is required")
    return _run_write(kanban_cli.comment, task_id, text)


@app.post("/api/tasks/{task_id}/link", dependencies=[Depends(require_auth)])
async def api_link(task_id: str, request: Request):
    body = await _json_body(request, required=True)
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
    body = await _json_body(request)
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


# --- task extended (v2) -----------------------------------------------------

@app.post("/api/tasks/{task_id}/edit", dependencies=[Depends(require_auth)])
async def api_edit_task(task_id: str, request: Request):
    body = await _json_body(request, required=True)
    result = (body.get("result") or "").strip()
    if not result:
        raise HTTPException(status_code=400, detail="result is required")
    summary = (body.get("summary") or "").strip() or None
    metadata = body.get("metadata")
    if metadata is not None and not isinstance(metadata, str):
        metadata = json.dumps(metadata, ensure_ascii=False)
    return _run_write(kanban_cli.edit, task_id, result, summary, metadata)


@app.post("/api/tasks/{task_id}/specify", dependencies=[Depends(require_auth)])
def api_specify(task_id: str):
    return _run_write(kanban_cli.specify, task_id)


@app.post("/api/tasks/{task_id}/decompose", dependencies=[Depends(require_auth)])
def api_decompose(task_id: str):
    return _run_write(kanban_cli.decompose, task_id)


@app.post("/api/tasks/{task_id}/claim", dependencies=[Depends(require_auth)])
async def api_claim(task_id: str, request: Request):
    body = await _json_body(request)
    ttl = body.get("ttl") if isinstance(body, dict) else None
    if ttl is not None:
        try:
            ttl = int(ttl)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="ttl must be an integer")
    return _run_write(kanban_cli.claim, task_id, ttl)


@app.post("/api/tasks/{task_id}/heartbeat", dependencies=[Depends(require_auth)])
async def api_heartbeat(task_id: str, request: Request):
    body = await _json_body(request)
    note = (body.get("note") or "").strip() or None if isinstance(body, dict) else None
    return _run_write(kanban_cli.heartbeat, task_id, note)


@app.post("/api/tasks/{task_id}/reassign", dependencies=[Depends(require_auth)])
async def api_reassign(task_id: str, request: Request):
    body = await _json_body(request, required=True)
    assignee = (body.get("assignee") or "").strip()
    if not assignee:
        raise HTTPException(status_code=400, detail="assignee is required")
    return _run_write(kanban_cli.reassign, task_id, assignee)


@app.get("/api/tasks/{task_id}/context", dependencies=[Depends(require_auth)])
def api_context(task_id: str):
    return _run_text(kanban_cli.context, task_id)


@app.get("/api/tasks/{task_id}/log", dependencies=[Depends(require_auth)])
def api_log(task_id: str, tail: int = None):
    return _run_text(kanban_cli.log, task_id, tail)


@app.get("/api/platforms", dependencies=[Depends(require_auth)])
def api_platforms():
    """读取 Hermes 已绑定的消息平台（config.yaml platforms 段 enabled: true）。"""
    try:
        cfg_path = Path.home() / ".hermes" / "config.yaml"
        if not cfg_path.is_file():
            return []
        data = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        platforms = data.get("platforms") or {}
        out = []
        for name, conf in platforms.items():
            if not isinstance(conf, dict) or not conf.get("enabled"):
                continue
            home = conf.get("home_channel") or {}
            out.append({
                "platform": name,
                "name": conf.get("label") or name,
                "chat_id": home.get("chat_id") or "",
                "thread_id": home.get("thread_id") or "",
                "user_id": home.get("user_id") or "",
            })
        return out
    except Exception:
        return []


@app.get("/api/tasks/{task_id}/notify", dependencies=[Depends(require_auth)])
def api_notify_list(task_id: str):
    return _run_json(kanban_cli.notify_list, task_id)


@app.post("/api/tasks/{task_id}/notify", dependencies=[Depends(require_auth)])
async def api_notify_subscribe(task_id: str, request: Request):
    body = await _json_body(request, required=True)
    platform = (body.get("platform") or "").strip()
    chat_id = (body.get("chat_id") or body.get("chat-id") or "").strip()
    if not platform or not chat_id:
        raise HTTPException(status_code=400, detail="platform and chat_id are required")
    return _run_write(
        kanban_cli.notify_subscribe, task_id, platform, chat_id,
        chat_type=(body.get("chat_type") or "").strip() or None,
        thread_id=(body.get("thread_id") or "").strip() or None,
        user_id=(body.get("user_id") or "").strip() or None,
        notifier_profile=(body.get("notifier_profile") or "").strip() or None,
    )


@app.delete("/api/tasks/{task_id}/notify", dependencies=[Depends(require_auth)])
async def api_notify_unsubscribe(task_id: str, request: Request):
    body = await _json_body(request, required=True)
    platform = (body.get("platform") or "").strip()
    chat_id = (body.get("chat_id") or body.get("chat-id") or "").strip()
    if not platform or not chat_id:
        raise HTTPException(status_code=400, detail="platform and chat_id are required")
    thread_id = (body.get("thread_id") or "").strip() or None
    return _run_write(kanban_cli.notify_unsubscribe, task_id, platform, chat_id, thread_id)


# --- swarm / global ---------------------------------------------------------

@app.post("/api/swarm", dependencies=[Depends(require_auth)])
async def api_swarm(request: Request):
    body = await _json_body(request, required=True)
    goal = (body.get("goal") or "").strip()
    if not goal:
        raise HTTPException(status_code=400, detail="goal is required")
    workers = []
    for w in body.get("workers") or []:
        profile = (w.get("profile") or "").strip()
        if not profile:
            continue
        title = (w.get("title") or "").strip()
        skills = w.get("skills")
        if isinstance(skills, str):
            skills = [s.strip() for s in skills.split(",") if s.strip()]
        if not isinstance(skills, list):
            skills = []
        comp = profile
        if title:
            comp += ":" + title
        if skills:
            comp += ":" + ",".join(str(s).strip() for s in skills if str(s).strip())
        workers.append(comp)
    if not workers:
        raise HTTPException(status_code=400, detail="at least one worker is required")
    verifier = (body.get("verifier") or "").strip()
    synthesizer = (body.get("synthesizer") or "").strip()
    if not verifier or not synthesizer:
        raise HTTPException(status_code=400, detail="verifier and synthesizer are required")
    priority = body.get("priority")
    created_by = (body.get("created_by") or "").strip() or "web"
    return _run_write(kanban_cli.swarm, goal, workers, verifier, synthesizer, priority=priority, created_by=created_by)


@app.get("/api/diagnostics", dependencies=[Depends(require_auth)])
def api_diagnostics(severity: str = None, task: str = None):
    return _run_json(kanban_cli.diagnostics, severity=severity, task=task)


@app.get("/api/events", dependencies=[Depends(require_auth)])
def api_events(since: int = None, kinds: str = None):
    kind_list = [k.strip() for k in (kinds or "").split(",") if k.strip()] or None
    return db.get_events(since=since, kinds=kind_list)


@app.post("/api/gc", dependencies=[Depends(require_auth)])
async def api_gc(request: Request):
    body = await _json_body(request)
    event_days = body.get("event_retention_days") if isinstance(body, dict) else None
    log_days = body.get("log_retention_days") if isinstance(body, dict) else None
    if event_days is not None:
        try:
            event_days = int(event_days)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="event_retention_days must be an integer")
    if log_days is not None:
        try:
            log_days = int(log_days)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="log_retention_days must be an integer")
    return _run_write(kanban_cli.gc, event_retention_days=event_days, log_retention_days=log_days)


@app.post("/api/repair", dependencies=[Depends(require_auth)])
def api_repair():
    try:
        proc = kanban_cli.repair()
    except kanban_cli.CLIError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        return json.loads(proc.stdout or "{}")
    except ValueError:
        return {"ok": proc.returncode == 0, "message": kanban_cli.summary(proc)}


@app.get("/api/assignees", dependencies=[Depends(require_auth)])
def api_assignees():
    return _run_json(kanban_cli.assignees)


# --- static frontend --------------------------------------------------------

# HTML 不缓存（JS/CSS 有 hash 不受影响，但 index.html 需要每次重新验证）
@app.middleware("http")
async def no_cache_index(request, call_next):
    response = await call_next(request)
    if request.url.path in ("/", "/index.html", "/sw.js"):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response

app.mount("/", StaticFiles(directory=str(BASE_DIR / "web" / "dist"), html=True), name="static")
