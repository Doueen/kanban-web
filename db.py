"""Read-only SQLite access to the Hermes kanban database.

The live database is owned by the Hermes gateway. Every connection here is
opened in read-only mode with a busy_timeout so we never block the writer or
risk corrupting its data. All writes go through kanban_cli.py.
"""
import json
import os
import sqlite3
import time

DB_PATH = os.environ.get("KANBAN_DB", "/root/.hermes/kanban.db")

STATUS_LABELS = {
    "todo": "待办",
    "ready": "就绪",
    "running": "运行中",
    "blocked": "阻塞",
    "scheduled": "定时",
    "review": "评审",
    "done": "完成",
    "archived": "归档",
    "triage": "待梳理",
}

TASK_COLS = (
    "id, title, body, assignee, status, priority, created_by, created_at, "
    "started_at, completed_at, workspace_kind, workspace_path, branch_name, "
    "project_id, tenant, result, consecutive_failures, max_runtime_seconds, "
    "last_heartbeat_at, current_run_id, skills, model_override, "
    "provider_override, block_kind, block_recurrences, session_id, "
    "workflow_template_id, current_step_key"
)


def connect():
    conn = sqlite3.connect("file:%s?mode=ro" % DB_PATH, uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def _parse_skills(value):
    if isinstance(value, str) and value:
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return []
    return value or []


def _row_to_task(row):
    task = dict(row)
    task["skills"] = _parse_skills(task.get("skills"))
    return task


def _parse_payload(value):
    if not value:
        return None
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def fetch_tasks(status=None, assignee=None, q=None, include_archived=False, limit=None):
    """List tasks with optional filters. Mirrors the CLI `list` view."""
    sql = "SELECT %s FROM tasks WHERE 1=1" % TASK_COLS
    params = []
    if status:
        sql += " AND status = ?"
        params.append(status)
    if assignee:
        sql += " AND assignee = ?"
        params.append(assignee)
    if q:
        sql += " AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')"
        params.extend(["%%%s%%" % q, "%%%s%%" % q])
    if not include_archived:
        sql += " AND status != 'archived'"
    sql += " ORDER BY priority DESC, created_at DESC"
    if limit:
        sql += " LIMIT ?"
        params.append(limit)
    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_task(r) for r in rows]


def get_assignees():
    with connect() as conn:
        rows = conn.execute(
            "SELECT assignee AS name, COUNT(*) AS count FROM tasks "
            "WHERE assignee IS NOT NULL AND assignee != '' "
            "GROUP BY assignee ORDER BY assignee"
        ).fetchall()
    return [dict(r) for r in rows]


def get_board():
    """Group tasks by status for the kanban board."""
    tasks = fetch_tasks(include_archived=True)
    statuses = []
    for status, label in STATUS_LABELS.items():
        col_tasks = [t for t in tasks if t["status"] == status]
        statuses.append({
            "status": status,
            "label": label,
            "count": len(col_tasks),
            "tasks": col_tasks,
        })
    return statuses


def get_task(task_id):
    """Task detail: task + comments + links + runs + attachments + recent events."""
    with connect() as conn:
        row = conn.execute(
            "SELECT %s FROM tasks WHERE id = ?" % TASK_COLS, (task_id,)
        ).fetchone()
        if row is None:
            return None
        task = _row_to_task(row)

        comments = [dict(r) for r in conn.execute(
            "SELECT id, task_id, author, body, created_at FROM task_comments "
            "WHERE task_id = ? ORDER BY created_at ASC", (task_id,)
        ).fetchall()]

        parents = [dict(r) for r in conn.execute(
            "SELECT l.parent_id AS id, t.title FROM task_links l "
            "LEFT JOIN tasks t ON t.id = l.parent_id "
            "WHERE l.child_id = ? ORDER BY l.parent_id", (task_id,)
        ).fetchall()]
        children = [dict(r) for r in conn.execute(
            "SELECT l.child_id AS id, t.title FROM task_links l "
            "LEFT JOIN tasks t ON t.id = l.child_id "
            "WHERE l.parent_id = ? ORDER BY l.child_id", (task_id,)
        ).fetchall()]

        runs = [dict(r) for r in conn.execute(
            "SELECT id, task_id, profile, step_key, status, outcome, "
            "started_at, ended_at, summary, error, last_heartbeat_at, "
            "max_runtime_seconds FROM task_runs "
            "WHERE task_id = ? ORDER BY started_at DESC", (task_id,)
        ).fetchall()]

        attachments = [dict(r) for r in conn.execute(
            "SELECT id, task_id, filename, content_type, size, uploaded_by, "
            "created_at FROM task_attachments "
            "WHERE task_id = ? ORDER BY created_at DESC", (task_id,)
        ).fetchall()]

        events = [dict(r) for r in conn.execute(
            "SELECT id, task_id, run_id, kind, payload, created_at "
            "FROM task_events WHERE task_id = ? "
            "ORDER BY created_at DESC LIMIT 20", (task_id,)
        ).fetchall()]

    for e in events:
        e["payload"] = _parse_payload(e.get("payload"))
    for r in runs:
        r["ended_at"] = r.get("ended_at")
    return {
        "task": task,
        "comments": comments,
        "parents": parents,
        "children": children,
        "runs": runs,
        "attachments": attachments,
        "events": events,
    }


def stats_fallback():
    """SQLite fallback for `hermes kanban stats --json`."""
    now = int(time.time())
    by_status = {}
    by_assignee = {}
    oldest_ready = None
    with connect() as conn:
        for status, n in conn.execute(
            "SELECT status, COUNT(*) FROM tasks GROUP BY status"
        ).fetchall():
            by_status[status] = n
        for name, status, n in conn.execute(
            "SELECT assignee, status, COUNT(*) FROM tasks "
            "WHERE assignee IS NOT NULL GROUP BY assignee, status"
        ).fetchall():
            by_assignee.setdefault(name, {})[status] = n
        row = conn.execute(
            "SELECT MIN(created_at) FROM tasks WHERE status = 'ready'"
        ).fetchone()
        oldest_ready = row[0] if row else None
    return {
        "by_status": by_status,
        "by_assignee": by_assignee,
        "oldest_ready_age_seconds": (now - oldest_ready) if oldest_ready else None,
        "now": now,
    }
