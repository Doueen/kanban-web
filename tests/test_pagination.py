"""pytest：任务列表分页（t_3e39ffeb 验收）。

验收标准：50 个种子任务 + page_size=20 → page=2 返回 21–40、total=50。
另覆盖：_page_param 非法输入回退/钳制、超界页码空列表、筛选与分页组合。
"""
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as app_module  # noqa: E402
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
def seeded_db(tmp_path):
    """50 个任务：id t_001..t_050，created_at 递增 → 排序后 id 顺序即页码顺序。"""
    path = tmp_path / "kanban.db"
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    rows = [
        ("t_%03d" % i, "任务 %03d" % i, None, "alice", "todo", 0, "test", 1_750_000_000 + i)
        for i in range(1, 51)
    ]
    conn.executemany(
        "INSERT INTO tasks (id,title,body,assignee,status,priority,created_by,created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        rows,
    )
    conn.commit()
    conn.close()
    return str(path)


def _ids(tasks):
    return [t["id"] for t in tasks]


def test_acceptance_page2_returns_21_40_total_50(seeded_db):
    """验收标准：50 任务 + page_size=20 → page=2 返回第 21–40 条，total=50。"""
    page1 = db.fetch_tasks(db_path=seeded_db, limit=20, offset=0)
    page2 = db.fetch_tasks(db_path=seeded_db, limit=20, offset=20)
    page3 = db.fetch_tasks(db_path=seeded_db, limit=20, offset=40)
    # 排序固定 priority DESC, created_at DESC（最新在前）→ 页码 1 是最新的 t_050..t_031
    assert _ids(page1) == ["t_%03d" % i for i in range(50, 30, -1)]
    assert _ids(page2) == ["t_%03d" % i for i in range(30, 10, -1)]
    assert _ids(page3) == ["t_%03d" % i for i in range(10, 0, -1)]
    assert db.count_tasks(db_path=seeded_db) == 50


def test_pagination_pages_exhaust_without_overlap_or_gap(seeded_db):
    ids = []
    for page in range(1, 5):
        ids += _ids(db.fetch_tasks(db_path=seeded_db, limit=20, offset=(page - 1) * 20))
    assert ids == ["t_%03d" % i for i in range(50, 0, -1)]  # 4 页恰好拼回全集，无重无漏


def test_beyond_last_page_returns_empty_not_error(seeded_db):
    assert db.fetch_tasks(db_path=seeded_db, limit=20, offset=100) == []


def test_count_tasks_respects_filters(seeded_db):
    assert db.count_tasks(db_path=seeded_db, status="todo") == 50
    assert db.count_tasks(db_path=seeded_db, status="done") == 0
    assert db.count_tasks(db_path=seeded_db, q="任务 044") == 1  # 模糊匹配 1 条


def test_count_tasks_matches_fetch_length(seeded_db):
    """count 与 fetch 使用同一 WHERE 片段（_tasks_where 共享），数量必须一致。"""
    for kwargs in (
        {},
        {"status": "todo"},
        {"q": "任务 0"},
        {"include_archived": True},
    ):
        rows = db.fetch_tasks(db_path=seeded_db, **kwargs)
        assert db.count_tasks(db_path=seeded_db, **kwargs) == len(rows), kwargs


# --- API 层参数校验 ---------------------------------------------------------

def test_page_param_graceful_fallback():
    p = app_module._page_param
    assert p("2", 1) == 2
    assert p("abc", 1) == 1          # 非数字 → 默认
    assert p(None, 1) == 1           # None → 默认
    assert p("-3", 1) == 1           # 负数 → 默认
    assert p("0", 1) == 1            # 0 → 默认
    assert p("", 1) == 1             # 空串 → 默认
    assert p("50", 20, max_value=100) == 50
    assert p("500", 20, max_value=100) == 100  # 超上限 → 钳制


def test_api_tasks_envelope_uses_monkeypatched_db(tmp_path, monkeypatch):
    """API 层信封契约：page/page_size/total/total_pages 字段齐全（只读临时库）。"""
    monkeypatch.setenv("KANBAN_DB", str(tmp_path / "kanban.db"))
    import importlib
    # 必须先 reload db 再 reload app_module：app.py 顶层 `import db` 从
    # sys.modules 取绑定，顺序反了会拿到旧 db 模块（真实库路径），读到生产数据。
    importlib.reload(db)
    importlib.reload(app_module)
    # active board 非 default 时 current_db_path() 忽略 KANBAN_DB（走 boards/<slug>），
    # 测试必须钉死路径，否则读到生产库（daily 板恰好有 6 条 todo，total 对不上）。
    monkeypatch.setattr(db, "current_db_path", lambda: str(tmp_path / "kanban.db"))
    conn = sqlite3.connect(str(tmp_path / "kanban.db"))
    conn.executescript(SCHEMA)
    conn.executemany(
        "INSERT INTO tasks (id,title,body,assignee,status,priority,created_by,created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        [("t_%03d" % i, "任务 %03d" % i, None, None, "todo", 0, "test", 1_750_000_000 + i)
         for i in range(1, 51)],
    )
    conn.commit()
    conn.close()

    resp = app_module.api_tasks(page="2", page_size="20")
    assert resp["page"] == 2
    assert resp["page_size"] == 20
    assert resp["total"] == 50
    assert resp["total_pages"] == 3
    assert _ids(resp["items"]) == ["t_%03d" % i for i in range(30, 10, -1)]

    # 超界页码：空列表而非错误；total 保持真实值
    beyond = app_module.api_tasks(page="99", page_size="20")
    assert beyond["items"] == [] and beyond["total"] == 50

    # 非法输入回退默认值
    bad = app_module.api_tasks(page="abc", page_size="-5")
    assert bad["page"] == 1 and bad["page_size"] == 20
    assert len(bad["items"]) == 20

    # 非数字 page_size 回退 20，不 422
    assert app_module.api_tasks(page="1", page_size="lots")["page_size"] == 20
