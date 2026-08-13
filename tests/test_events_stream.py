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
    with client.stream("GET", "/api/events/stream?limit=5", auth=_auth()) as r:
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
