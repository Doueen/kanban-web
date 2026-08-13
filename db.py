"""Read-only SQLite access to the Hermes kanban database (multi-board aware).

The live database is owned by the Hermes gateway. Every connection here is
opened in read-only mode with a busy_timeout so we never block the writer or
risk corrupting its data. All writes go through kanban_cli.py.

Boards: the active board is decided by `hermes kanban boards show` output.
The default board lives at /root/.hermes/kanban.db (back-compat); every other
board lives at /root/.hermes/kanban/boards/<slug>/kanban.db. The active board
slug is cached for 30s and refreshed on POST /api/boards/{slug}/switch.
"""
import json
import os
import sqlite3
import time
from pathlib import Path

import kanban_cli

DEFAULT_DB_PATH = os.environ.get("KANBAN_DB", "/root/.hermes/kanban.db")
BOARDS_ROOT = os.environ.get("KANBAN_BOARDS_ROOT", "/root/.hermes/kanban/boards")
DEFAULT_BOARD_SLUG = "default"
# M1-3 E4: TTL 30s → 300s（轮询不再每次 CLI 探活）
BOARD_CACHE_TTL = 300.0
BOARDS_CACHE_TTL = 300.0

_current_board = None
_current_board_ts = 0.0
_boards_cache = None
_boards_cache_ts = 0.0

STATUS_LABELS = {
    "triage": "待梳理",
    "todo": "待办",
    "ready": "就绪",
    "running": "运行中",
    "blocked": "阻塞",
    "scheduled": "定时",
    "review": "评审",
    "done": "完成",
    "archived": "归档",
}

TASK_COLS = (
    "id, title, body, assignee, status, priority, created_by, created_at, "
    "started_at, completed_at, workspace_kind, workspace_path, branch_name, "
    "project_id, tenant, result, consecutive_failures, max_runtime_seconds, "
    "last_heartbeat_at, current_run_id, skills, model_override, "
    "provider_override, block_kind, block_recurrences, session_id, "
    "workflow_template_id, current_step_key"
)


# --- board resolution -------------------------------------------------------

def current_board_slug(force=False):
    """Active board slug, cached for BOARD_CACHE_TTL seconds.

    M1-3 E4: 文件系统直读（~/.hermes/kanban/current 文本文件），
    轮询路径不再产生 CLI 子进程。force=True（手动刷新/切换）时强制重读。
    """
    global _current_board, _current_board_ts
    now = time.time()
    if not force and _current_board is not None and (now - _current_board_ts) < BOARD_CACHE_TTL:
        return _current_board
    slug = None
    try:
        current_file = Path(BOARDS_ROOT).parent / "current"
        if current_file.is_file():
            slug = current_file.read_text(encoding="utf-8").strip() or None
    except Exception:
        slug = None
    if not slug:
        slug = DEFAULT_BOARD_SLUG
    _current_board = slug
    _current_board_ts = now
    return slug


def refresh_current_board():
    """Force-re-read the active board (call after a successful switch)."""
    return current_board_slug(force=True)


def boards_list_cached(include_archived=True, force=False):
    """CLI `boards list --json --all` 输出，内存 TTL 缓存（BOARDS_CACHE_TTL）。

    M1-3 E4: boards 列表加内存 TTL；写操作（switch/create/rename/workdir/
    rm/restore）后由 invalidate_boards_cache() 主动失效。
    """
    global _boards_cache, _boards_cache_ts
    now = time.time()
    if not force and _boards_cache is not None and (now - _boards_cache_ts) < BOARDS_CACHE_TTL:
        return _boards_cache
    try:
        proc = kanban_cli.boards_list(include_archived=include_archived)
        data = json.loads(proc.stdout or "[]")
    except Exception:
        data = _boards_cache or []
    _boards_cache = data
    _boards_cache_ts = now
    return data


def invalidate_boards_cache():
    global _boards_cache, _boards_cache_ts
    _boards_cache = None
    _boards_cache_ts = 0.0


def current_db_path():
    """Path of the SQLite DB for the active board."""
    slug = current_board_slug()
    if slug == DEFAULT_BOARD_SLUG:
        return DEFAULT_DB_PATH
    return os.path.join(BOARDS_ROOT, slug, "kanban.db")


def board_db_path(slug):
    """Path of the SQLite DB for a specific board slug."""
    if slug == DEFAULT_BOARD_SLUG:
        return DEFAULT_DB_PATH
    return os.path.join(BOARDS_ROOT, slug, "kanban.db")


# --- connection -------------------------------------------------------------

def connect(db_path=None):
    conn = sqlite3.connect(
        "file:%s?mode=ro" % (db_path or current_db_path()), uri=True, timeout=10
    )
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


# --- queries ----------------------------------------------------------------

def _tasks_where(status=None, assignee=None, q=None, include_archived=False):
    """Shared WHERE fragment + params for task listing/counting queries."""
    sql = ""
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
    return sql, params


STATUS_ORDER = list(STATUS_LABELS.keys())  # 前端 ListView 同序：triage→todo→ready→running→blocked→scheduled→review→done→archived

# sort 参数 → ORDER BY 片段（status 按看板列序，tiebreak 与默认一致）
_SORT_SQL = {
    "status": "CASE status %s END, priority DESC, created_at DESC"
    % " ".join("WHEN '%s' THEN %d" % (s, i) for i, s in enumerate(STATUS_ORDER)),
    "priority": "priority DESC, created_at DESC",
    "created": "created_at DESC",
}


def fetch_tasks(status=None, assignee=None, q=None, include_archived=False, limit=None, offset=None, sort: str | None = None, db_path=None):
    """List tasks with optional filters. Mirrors the CLI `list` view.

    Pagination support: `limit` + `offset` (both optional, applied after the
    fixed ORDER BY priority DESC, created_at DESC so pages are stable).

    `sort`: "status"（看板列序）/ "priority" / "created"；None 或未知值 →
    默认 priority DESC, created_at DESC（保持旧行为，分页稳定）。
    """
    where, params = _tasks_where(status=status, assignee=assignee, q=q, include_archived=include_archived)
    order = _SORT_SQL[sort] if sort in _SORT_SQL else "priority DESC, created_at DESC"
    sql = "SELECT %s FROM tasks WHERE 1=1%s ORDER BY %s" % (TASK_COLS, where, order)
    if limit is not None:
        sql += " LIMIT ?"
        params.append(limit)
    if offset is not None:
        sql += " OFFSET ?"
        params.append(offset)
    with connect(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_task(r) for r in rows]


def count_tasks(status=None, assignee=None, q=None, include_archived=False, db_path=None):
    """Count tasks matching the same filters as fetch_tasks (pagination total)."""
    where, params = _tasks_where(status=status, assignee=assignee, q=q, include_archived=include_archived)
    with connect(db_path) as conn:
        return conn.execute("SELECT COUNT(*) FROM tasks WHERE 1=1%s" % where, params).fetchone()[0]


def get_assignees(db_path=None):
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT assignee AS name, COUNT(*) AS count FROM tasks "
            "WHERE assignee IS NOT NULL AND assignee != '' "
            "GROUP BY assignee ORDER BY assignee"
        ).fetchall()
    return [dict(r) for r in rows]


def board_fingerprint(db_path=None):
    """轻量变更指纹（M1-3 E6）：tasks/comments/events/attachments 的
    MAX(created_at) UNION，排除 heartbeat 事件。用于 /api/board 的 ETag。"""
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT MAX(created_at) FROM tasks "
            "UNION SELECT MAX(created_at) FROM task_comments "
            "UNION SELECT MAX(created_at) FROM task_events WHERE kind != 'heartbeat' "
            "UNION SELECT MAX(created_at) FROM task_attachments"
        ).fetchall()
    return "|".join(str(r[0] or 0) for r in rows)


def get_board(db_path=None):
    """Group tasks by status for the kanban board."""
    tasks = fetch_tasks(include_archived=True, db_path=db_path)
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


def get_task(task_id, db_path=None):
    """Task detail: task + comments + links + runs + attachments + recent events."""
    with connect(db_path) as conn:
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


def get_events(since=None, kinds=None, limit=100, db_path=None):
    """Recent global task_events, ascending by created_at.

    Optional filters: `since` (unix seconds, exclusive) and `kinds` (list of
    event kind strings). Results are capped at `limit` rows.
    """
    sql = "SELECT id, task_id, run_id, kind, payload, created_at FROM task_events WHERE 1=1"
    params = []
    if since is not None:
        sql += " AND created_at > ?"
        params.append(int(since))
    if kinds:
        sql += " AND kind IN (%s)" % ",".join("?" * len(kinds))
        params.extend(kinds)
    sql += " ORDER BY created_at ASC LIMIT ?"
    params.append(limit)
    with connect(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
    out = [dict(r) for r in rows]
    for e in out:
        e["payload"] = _parse_payload(e.get("payload"))
    return out


def get_events_after(after_id=None, kinds=None, limit=100, db_path=None):
    """Events ascending by event id, resumable via exclusive id cursor (S3/S6).

    Event ids are monotonically increasing rowids, so an id cursor is exact
    (no same-second duplicates/skips like a created_at cursor).
    """
    sql = "SELECT id, task_id, run_id, kind, payload, created_at FROM task_events WHERE 1=1"
    params = []
    if after_id is not None:
        sql += " AND id > ?"
        params.append(int(after_id))
    if kinds:
        sql += " AND kind IN (%s)" % ",".join("?" * len(kinds))
        params.extend(kinds)
    sql += " ORDER BY id ASC LIMIT ?"
    params.append(limit)
    with connect(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
    out = [dict(r) for r in rows]
    for e in out:
        e["payload"] = _parse_payload(e.get("payload"))
    return out


def stats_fallback(db_path=None):
    """SQLite fallback for `hermes kanban stats --json`."""
    now = int(time.time())
    by_status = {}
    by_assignee = {}
    oldest_ready = None
    with connect(db_path) as conn:
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
