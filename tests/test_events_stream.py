"""pytest：GET /api/events/stream SSE 事件推送契约（M2-3 S3）。

覆盖：
- 401 无凭证 / 错误凭证
- 200 text/event-stream + no-cache 头
- 帧格式：id: N + data: {json}（event_id 单调递增）
- 排除 heartbeat 噪音事件
- Last-Event-ID 续传：带游标请求只返回更新的 id
- 连接关闭（流中断）后生成器正常退出，不悬挂
"""
import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as app_module  # noqa: E402

APP = app_module.app


@pytest.fixture(autouse=True)
def auth_env(monkeypatch):
    monkeypatch.setattr(app_module, "WEB_USER", "tester")
    monkeypatch.setattr(app_module, "WEB_PASS", "t-pass")
    yield


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    with TestClient(APP) as c:
        yield c


def _auth():
    return ("tester", "t-pass")


def test_stream_requires_auth(client):
    r = client.get("/api/events/stream")
    assert r.status_code == 401
    r2 = client.get("/api/events/stream", auth=("tester", "wrong"))
    assert r2.status_code == 401


def test_stream_headers_and_frames(client):
    """SSE 帧解析：id 单调 + data JSON + 无 heartbeat。limit=5 自然结束流。"""
    text = ""
    with client.stream(
        "GET", "/api/events/stream?limit=5", auth=_auth(), headers={"Last-Event-ID": "0"}
    ) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        assert r.headers["cache-control"] == "no-cache"
        text = r.read().decode("utf-8", "replace")
    assert "id:" in text and "data:" in text
    ids = []
    for line in text.splitlines():
        if line.startswith("id: "):
            ids.append(int(line[4:]))
        elif line.startswith("data: "):
            payload = json.loads(line[6:])
            assert payload.get("kind") != "heartbeat"
            assert "id" in payload and "task_id" in payload
    assert len(ids) == 5, "limit=5 应恰好发 5 条事件后自然结束"
    assert ids == sorted(ids), "事件 id 必须单调递增"


def test_stream_last_event_id_resume(client):
    """Last-Event-ID 续传：返回的事件 id 必须全部大于游标。"""
    # 先取当前最大事件 id（通过普通 events 接口探测）
    ev = client.get("/api/events?limit=1", auth=_auth()).json()
    cursor = ev[0]["id"] if ev else 0
    text = ""
    with client.stream(
        "GET",
        "/api/events/stream?limit=3",
        auth=_auth(),
        headers={"Last-Event-ID": str(cursor)},
    ) as r:
        assert r.status_code == 200
        text = r.read().decode("utf-8", "replace")
    ids = [int(l[4:]) for l in text.splitlines() if l.startswith("id: ")]
    assert len(ids) == 3
    assert all(i > cursor for i in ids), "续传返回了游标之前的旧事件"


def test_stream_no_last_event_id_starts_from_tail(client, monkeypatch):
    """回归（t_03792579 根因 ①）：无 Last-Event-ID 的新客户端必须从事件尾部
    （db.max_event_id()）开始轮询，绝不能从 0 全量回放历史。

    修复前：last_id=0 → 每 2s 一批（50 条）爬完全表约 2.3 分钟，期间新事件
    永远滞后 → 完成任务不显示。修复后：首轮 after_id 必须是当前尾部。
    """
    import db as db_module

    captured = {}

    def fake_max_event_id(db_path=None):
        return 9000

    def fake_get_events_after(after_id=None, kinds=None, limit=100, db_path=None):
        captured["after_id"] = after_id
        # 只回一条"新"事件（id > 尾部），limit=1 让流自然结束
        return [{"id": 9001, "kind": "created", "task_id": "t_x"}]

    monkeypatch.setattr(db_module, "max_event_id", fake_max_event_id)
    monkeypatch.setattr(db_module, "get_events_after", fake_get_events_after)
    # 加速：跳过 2s 轮询间隔
    monkeypatch.setattr(app_module._time, "sleep", lambda _s: None)

    text = ""
    with client.stream("GET", "/api/events/stream?limit=1", auth=_auth()) as r:
        assert r.status_code == 200
        text = r.read().decode("utf-8", "replace")
    assert captured["after_id"] == 9000, (
        "无 Last-Event-ID 必须从 max_event_id 尾部开始（修复前从 0 重放）"
    )
    assert "id: 9001" in text and "t_x" in text


def test_stream_cursor_advances_past_noise_batch(client, monkeypatch):
    """回归（t_03792579 根因 ②）：游标必须在过滤之前推进——整批 heartbeat
    噪音事件不能卡死游标（否则 LIMIT 50 永远返回同一批 heartbeat，流永久冻结）。

    修复前：last_id 在 `if kind in NOISE: continue` 之后才推进 → 首批 50 条
    全 heartbeat 时游标不动，后续轮询重复返回同一批 → 永不发出新事件。
    修复后：第二批轮询的 after_id 必须已跨过噪音批（9000 → 9050）。
    """
    import db as db_module

    calls = []
    noise_batch = [
        {"id": 9001 + i, "kind": "heartbeat", "task_id": "t_h"} for i in range(50)
    ]
    real_event = {"id": 9051, "kind": "created", "task_id": "t_real"}

    def fake_get_events_after(after_id=None, kinds=None, limit=100, db_path=None):
        calls.append(after_id)
        # 第一批：50 条全 heartbeat；后续批：一条真实事件
        if len(calls) == 1:
            return noise_batch
        return [real_event]

    monkeypatch.setattr(db_module, "get_events_after", fake_get_events_after)
    monkeypatch.setattr(db_module, "max_event_id", lambda db_path=None: 9000)
    monkeypatch.setattr(app_module._time, "sleep", lambda _s: None)

    text = ""
    with client.stream(
        "GET",
        "/api/events/stream?limit=1",
        auth=_auth(),
        headers={"Last-Event-ID": "9000"},
    ) as r:
        assert r.status_code == 200
        text = r.read().decode("utf-8", "replace")
    assert len(calls) >= 2, "首批噪音后应继续轮询"
    assert calls[1] == 9050, (
        "游标必须跨过噪音批（修复前卡在 9000，第二批仍从同一位置拉取）"
    )
    # 最终必须发出噪音之后的那条真实事件
    assert "id: 9051" in text and "t_real" in text
    # 噪音事件本身绝不能出现在流里
    assert "t_h" not in text
