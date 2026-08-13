"""pytest 骨架（M1-6 E11）：db.py 查询层（只读 sqlite，临时库 fixture）。

铁律：写操作权威在 CLI，db.py 只读 —— 本测试同样只读临时库。
"""
import os
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402

SCHEMA = """
CREATE TABLE tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT,
    status TEXT NOT NULL, priority INTEGER DEFAULT 0, created_by TEXT,
    created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER,
    workspace_kind TEXT NOT NULL DEFAULT 'scratch', workspace_path TEXT,
    branch_name TEXT, project_id TEXT, tenant TEXT, result TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    max_runtime_seconds INTEGER, last_heartbeat_at INTEGER,
    current_run_id INTEGER, skills TEXT, model_override TEXT,
    provider_override TEXT, block_kind TEXT, block_recurrences TEXT,
    session_id TEXT, workflow_template_id TEXT, current_step_key TEXT
);
CREATE TABLE task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, author TEXT,
    body TEXT, created_at INTEGER
);
CREATE TABLE task_links (
    parent_id TEXT NOT NULL, child_id TEXT NOT NULL,
    PRIMARY KEY (parent_id, child_id)
);
CREATE TABLE task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT,
    step_key TEXT, status TEXT, outcome TEXT, started_at INTEGER,
    ended_at INTEGER, summary TEXT, error TEXT, last_heartbeat_at INTEGER,
    max_runtime_seconds INTEGER
);
CREATE TABLE task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, run_id INTEGER,
    kind TEXT, payload TEXT, created_at INTEGER
);
CREATE TABLE task_attachments (
    id TEXT PRIMARY KEY, task_id TEXT, filename TEXT, content_type TEXT,
    size INTEGER, uploaded_by TEXT, created_at INTEGER
);
"""


@pytest.fixture()
def tmp_db(tmp_path):
    """Build a minimal hermetic kanban DB and return its path."""
    path = tmp_path / "kanban.db"
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    now = 1_750_000_000
    rows = [
        ("t_1", "任务甲", "body", "alice", "todo", 1, "web", now - 100),
        ("t_2", "任务乙", None, None, "done", 0, "web", now - 90),
        ("t_3", "归档任务", None, "bob", "archived", 0, "web", now - 80),
        ("t_4", "阻塞任务", None, "alice", "blocked", 0, "web", now - 70),
    ]
    conn.executemany(
        "INSERT INTO tasks (id,title,body,assignee,status,priority,created_by,created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        rows,
    )
    conn.execute(
        "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?,?,?,?)",
        ("t_1", "web", "评论", now - 50),
    )
    conn.executemany(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?,?,?,?)",
        [
            ("t_1", "created", None, now - 100),
            ("t_1", "status", '{"status":"done"}', now - 60),
            ("t_1", "heartbeat", None, now - 10),  # 指纹应忽略
        ],
    )
    conn.commit()
    conn.close()
    return str(path)


def test_fetch_tasks_excludes_archived_by_default(tmp_db):
    tasks = db.fetch_tasks(db_path=tmp_db)
    assert {t["id"] for t in tasks} == {"t_1", "t_2", "t_4"}


def test_fetch_tasks_status_and_q_filters(tmp_db):
    todos = db.fetch_tasks(status="todo", db_path=tmp_db)
    assert [t["id"] for t in todos] == ["t_1"]
    hit = db.fetch_tasks(q="任务乙", db_path=tmp_db)
    assert [t["id"] for t in hit] == ["t_2"]


def test_fetch_tasks_include_archived(tmp_db):
    tasks = db.fetch_tasks(include_archived=True, db_path=tmp_db)
    assert {t["id"] for t in tasks} == {"t_1", "t_2", "t_3", "t_4"}


def test_get_board_status_order_follows_STATUS_LABELS(tmp_db):
    """db.py 是列序权威：triage 必须在前（历史事故：待梳理列缺失）。"""
    board = db.get_board(db_path=tmp_db)
    order = [c["status"] for c in board]
    assert order[0] == "triage"
    assert order == list(db.STATUS_LABELS.keys())
    by_status = {c["status"]: c["count"] for c in board}
    assert by_status["todo"] == 1
    assert by_status["done"] == 1
    assert by_status["archived"] == 1


def test_get_board_done_column_includes_completed_tasks(tmp_db):
    """回归（t_03792579 用户可见现象）：/api/board 的 done 列必须把已完成任务
    连同任务数据一起下发——前端渲染只看列里的 tasks 数组，只有 count 不够。

    修复前：任务确实进入了 done（CLI/DB 侧正常），但 SSE 推送链缺陷让前端
    拿不到新数据、看板冻结 → 完成列"没有任务"。此测试钉住数据契约：
    done 列 tasks 数组必须包含已完成任务（含 id/title/status 渲染三要素）。
    """
    board = db.get_board(db_path=tmp_db)
    done_col = next(c for c in board if c["status"] == "done")
    assert done_col["count"] == 1
    assert len(done_col["tasks"]) == 1
    t = done_col["tasks"][0]
    assert t["id"] == "t_2"
    assert t["title"] == "任务乙"
    assert t["status"] == "done"
    # 其他列不受影响：todo 任务只出现在 todo 列
    todo_col = next(c for c in board if c["status"] == "todo")
    assert [x["id"] for x in todo_col["tasks"]] == ["t_1"]


def test_get_board_archived_lazy_loads_tasks(tmp_db):
    """M2-4 S4：archived 列只下发 count（tasks=[]），展开时前端再懒加载。"""
    board = db.get_board(db_path=tmp_db)
    arch_col = next(c for c in board if c["status"] == "archived")
    assert arch_col["count"] == 1
    assert arch_col["tasks"] == []
    assert arch_col.get("lazy") is True


def test_board_fingerprint_changes_and_ignores_heartbeat(tmp_db):
    fp1 = db.board_fingerprint(db_path=tmp_db)
    conn = sqlite3.connect(tmp_db)
    conn.execute(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t_1','heartbeat',NULL,?)",
        (9_999_999_999,),
    )
    conn.commit()
    conn.close()
    fp2 = db.board_fingerprint(db_path=tmp_db)
    assert fp1 == fp2, "heartbeat 事件不得改变变更指纹（E6）"
    conn = sqlite3.connect(tmp_db)
    conn.execute(
        "INSERT INTO task_comments (task_id, author, body, created_at) VALUES ('t_2','web','x',?)",
        (9_999_999_999,),
    )
    conn.commit()
    conn.close()
    fp3 = db.board_fingerprint(db_path=tmp_db)
    assert fp3 != fp2, "新评论必须改变变更指纹"


def test_board_fingerprint_changes_on_same_second_events(tmp_db):
    """t_3ad4fe46 回归：同秒内的非 heartbeat 事件必须改变指纹。

    根因是 created_at 秒级精度 —— 同一秒内完成两个任务，MAX(created_at)
    不变 → ETag 不变 → /api/board 304 → 前端漏显且粘滞。
    修复：指纹追加非 heartbeat 事件的 MAX(task_events.id) 单调分量。"""
    conn = sqlite3.connect(tmp_db)
    conn.execute(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t_1','completed',NULL,?)",
        (9_999_999_999,),
    )
    conn.commit()
    fp_a = db.board_fingerprint(db_path=tmp_db)
    # 同一秒（同 created_at）再完成第二个任务 —— 只靠 id 递增区分
    conn.execute(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t_2','completed',NULL,?)",
        (9_999_999_999,),
    )
    conn.commit()
    conn.close()
    fp_b = db.board_fingerprint(db_path=tmp_db)
    assert fp_b != fp_a, "同秒第二条 completed 事件必须改变变更指纹（id 单调分量）"


def test_get_task_missing_returns_none(tmp_db):
    assert db.get_task("t_nope", db_path=tmp_db) is None


def test_get_task_includes_comments(tmp_db):
    detail = db.get_task("t_1", db_path=tmp_db)
    assert detail["task"]["title"] == "任务甲"
    assert any(c["body"] == "评论" for c in detail["comments"])


def test_get_assignees_groups(tmp_db):
    assignees = db.get_assignees(db_path=tmp_db)
    by_name = {a["name"]: a["count"] for a in assignees}
    assert by_name == {"alice": 2, "bob": 1}
