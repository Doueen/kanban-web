"""pytest：/api/board ETag 条件请求契约（t_3ad4fe46 回归，t_e564bf47 补充）。

根因回顾：board_fingerprint() 使用 MAX(created_at)（秒级精度），同一秒内
完成第二个任务时指纹不变 → If-None-Match 命中 → 304 → 前端跳过 board 赋值
→ 完成列漏显且粘滞。修复：指纹追加非 heartbeat 事件的 MAX(task_events.id)
单调分量 + 前端手动刷新/切板 force 绕过。

覆盖：
- 无变化 → 条件请求 304（零传输保留，不破坏既有优化）
- 同秒完成第二个任务 → 旧 ETag 条件请求必须 200 + done 列含新任务（修复前 304）
- 仅 heartbeat 事件 → 指纹不变 → 仍 304（心跳噪音排除）
- 正常完成任务场景 → 指纹变化 + done 列出现任务、原列移除（数据契约）
"""
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as app_module  # noqa: E402
import db  # noqa: E402
from test_db import SCHEMA  # noqa: E402

APP = app_module.app


@pytest.fixture(autouse=True)
def auth_env(monkeypatch):
    monkeypatch.setattr(app_module, "WEB_USER", "tester")
    monkeypatch.setattr(app_module, "WEB_PASS", "t-pass")
    yield


@pytest.fixture()
def api_db(tmp_path, monkeypatch):
    """Hermetic 临时库：app 层所有 db 访问（connect→current_db_path）指向它。"""
    path = tmp_path / "kanban.db"
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    now = 1_750_000_000
    rows = [
        ("t_1", "任务甲", "body", "alice", "todo", 1, "web", now - 100),
        ("t_2", "任务乙", None, None, "done", 0, "web", now - 90),
        ("t_4", "阻塞任务", None, "alice", "blocked", 0, "web", now - 70),
    ]
    conn.executemany(
        "INSERT INTO tasks (id,title,body,assignee,status,priority,created_by,created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        rows,
    )
    conn.executemany(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?,?,?,?)",
        [
            ("t_1", "created", None, now - 100),
            ("t_2", "created", None, now - 90),
            ("t_4", "created", None, now - 70),
            ("t_1", "heartbeat", None, now - 10),  # 指纹应忽略
        ],
    )
    conn.commit()
    conn.close()
    monkeypatch.setattr(db, "current_db_path", lambda: str(path))
    return str(path)


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    with TestClient(APP) as c:
        yield c


def _auth():
    return ("tester", "t-pass")


def _complete(conn, task_id, ts):
    """模拟 CLI complete 的落库：状态迁移 + completed 事件（同秒可传相同 ts）。"""
    conn.execute(
        "UPDATE tasks SET status='done', completed_at=? WHERE id=?", (ts, task_id)
    )
    conn.execute(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?,?,NULL,?)",
        (task_id, "completed", ts),
    )
    conn.commit()


def _done_ids(body):
    return {
        t["id"]
        for c in body["statuses"]
        if c["status"] == "done"
        for t in c["tasks"]
    }


def test_board_conditional_304_when_unchanged(client, api_db):
    """无变化：条件请求必须 304（ETag 零传输优化保留）。"""
    r1 = client.get("/api/board", auth=_auth())
    assert r1.status_code == 200
    etag = r1.headers["etag"]
    assert etag
    r2 = client.get("/api/board", auth=_auth(), headers={"If-None-Match": etag})
    assert r2.status_code == 304


def test_board_same_second_complete_conditional_returns_200(client, api_db):
    """t_3ad4fe46 回归：同秒完成第二个任务 → 旧 ETag 条件请求必须 200。

    修复前：指纹（仅 MAX(created_at)）不变 → 304 → 前端漏显且粘滞。
    修复后：非 heartbeat 事件 MAX(id) 单调分量 → 指纹必变 → 200 + 新数据。
    精确复刻线上 repro 顺序：complete t1 → 拿 ETag → 同秒 complete t4 →
    带 If-None-Match 请求 → 必须 200。
    """
    ts = 1_750_000_500  # 固定时间戳保证两次 complete 严格同秒
    conn = sqlite3.connect(api_db)
    _complete(conn, "t_1", ts)
    conn.close()

    r1 = client.get("/api/board", auth=_auth())
    assert r1.status_code == 200
    etag = r1.headers["etag"]
    assert "t_1" in _done_ids(r1.json())

    # 同秒完成第二个任务（同一 created_at，只有事件 id 递增）
    conn = sqlite3.connect(api_db)
    _complete(conn, "t_4", ts)
    conn.close()

    r2 = client.get("/api/board", auth=_auth(), headers={"If-None-Match": etag})
    assert r2.status_code == 200, "同秒 completed 事件后旧 ETag 条件请求必须 200（修复前 304）"
    assert {"t_1", "t_4"} <= _done_ids(r2.json())
    assert r2.headers["etag"] != etag


def test_board_heartbeat_only_keeps_304(client, api_db):
    """仅 heartbeat 事件不改变指纹 → 条件请求仍 304（心跳噪音排除）。"""
    r1 = client.get("/api/board", auth=_auth())
    etag = r1.headers["etag"]

    conn = sqlite3.connect(api_db)
    conn.execute(
        "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?,?,NULL,?)",
        ("t_2", "heartbeat", 1_750_000_600),
    )
    conn.commit()
    conn.close()

    r2 = client.get("/api/board", auth=_auth(), headers={"If-None-Match": etag})
    assert r2.status_code == 304, "heartbeat 不得无效化 ETag"


def test_board_normal_completion_updates_done_column(client, api_db):
    """正常完成任务场景：完成列出现任务、原列移除、指纹变化。"""
    r0 = client.get("/api/board", auth=_auth())
    etag0 = r0.headers["etag"]
    assert _done_ids(r0.json()) == {"t_2"}

    ts = 1_750_000_700
    conn = sqlite3.connect(api_db)
    _complete(conn, "t_1", ts)
    conn.close()

    r1 = client.get("/api/board", auth=_auth())
    assert r1.status_code == 200
    assert r1.headers["etag"] != etag0
    body = r1.json()
    assert "t_1" in _done_ids(body)
    todo_col = next(c for c in body["statuses"] if c["status"] == "todo")
    assert [t["id"] for t in todo_col["tasks"]] == []
    done_col = next(c for c in body["statuses"] if c["status"] == "done")
    assert done_col["count"] == len(done_col["tasks"]) == 2
