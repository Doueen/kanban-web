"""pytest：POST /api/scheduler/run 手动触发调度器 — 端到端契约测试。

覆盖主要成功与失败路径：
- 401 无凭证 / 错误凭证（无权限用户直接调接口被拒）
- 200 dry_run 预览（不 spawn）
- 200 空 body 真实触发（响应契约 status/ok/dry_run/task_ids/result）
- 200 max=N 限制 spawn 数
- 400 max 非整数；400 CLI 子进程错误
- 409 进程内并发锁（调度已在运行）；409 board 调度锁被占（其他 tick 进行中）
- 并发 6 请求 → 恰 1×200 + 5×409

铁律：不真实执行 hermes CLI —— monkeypatch kanban_cli.dispatch，
只验证 API 层行为与参数透传（argv 构造细节由 test_cli.py 覆盖）。
"""
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as app_module  # noqa: E402
import kanban_cli  # noqa: E402

APP = app_module.app  # 模块内 FastAPI 实例（模块名与实例同名，需显式取出）


@pytest.fixture(autouse=True)
def auth_env(monkeypatch):
    """固定测试凭据；默认放行 board 调度锁探测（真实环境若恰逢 gateway tick 会偶发 409）。"""
    monkeypatch.setattr(app_module, "WEB_USER", "tester")
    monkeypatch.setattr(app_module, "WEB_PASS", "t-pass")
    monkeypatch.setattr(app_module, "_board_dispatch_lock_busy", lambda: False)
    yield
    # 进程内锁必须释放，防止用例间串扰
    while app_module._SCHED_RUN_LOCK.locked():
        app_module._SCHED_RUN_LOCK.release()


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    with TestClient(APP) as c:
        yield c


@pytest.fixture()
def fake_dispatch(monkeypatch):
    """替换 kanban_cli.dispatch：记录参数，返回模拟成功的 dispatch JSON。"""
    calls = {}

    def _fake(dry_run=False, max_spawn=None):
        if calls.get("delay"):
            time.sleep(calls["delay"])
        calls["dry_run"] = dry_run
        calls["max_spawn"] = max_spawn
        payload = {
            "ok": True,
            "dry_run": dry_run,
            "reclaimed": [],
            "promoted": [],
            "spawned": [{"task_id": "t_test_a"}, {"task_id": "t_test_b"}],
            "skipped": [],
            "errors": [],
        }
        return subprocess.CompletedProcess(
            ["hermes", "kanban", "dispatch", "--json"], 0,
            stdout=json.dumps(payload), stderr="",
        )

    monkeypatch.setattr(kanban_cli, "dispatch", _fake)
    return calls


AUTH = ("tester", "t-pass")


def _post(client, body=None, auth=AUTH):
    return client.post("/api/scheduler/run", json=body, auth=auth)


# --- 权限：无权限用户直接调用接口被拒 ----------------------------------


def test_no_creds_401(client):
    r = client.post("/api/scheduler/run")
    assert r.status_code == 401


def test_wrong_creds_401(client):
    r = _post(client, auth=("tester", "wrong"))
    assert r.status_code == 401


# --- 成功路径 ---------------------------------------------------------


def test_dry_run_200_contract(client, fake_dispatch):
    r = _post(client, {"dry_run": True})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "triggered"
    assert body["ok"] is True
    assert body["dry_run"] is True
    assert body["task_ids"] == ["t_test_a", "t_test_b"]
    assert body["result"]["spawned"][0]["task_id"] == "t_test_a"
    assert fake_dispatch["dry_run"] is True
    assert fake_dispatch["max_spawn"] is None


def test_real_trigger_200_empty_body(client, fake_dispatch):
    """空 body = 真实触发：dry_run=False 透传，响应含完整 dispatch JSON。"""
    r = _post(client, None)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "triggered"
    assert body["dry_run"] is False
    assert body["task_ids"] == ["t_test_a", "t_test_b"]
    assert fake_dispatch["dry_run"] is False


def test_max_passthrough(client, fake_dispatch):
    r = _post(client, {"max": 2})
    assert r.status_code == 200
    assert r.json()["dry_run"] is False
    assert fake_dispatch["max_spawn"] == 2


# --- 失败路径 ---------------------------------------------------------


def test_max_non_integer_400(client, fake_dispatch):
    r = _post(client, {"max": "abc"})
    assert r.status_code == 400
    assert "integer" in r.json()["detail"]


def test_cli_error_400(client, monkeypatch):
    def _boom(**kwargs):
        raise kanban_cli.CLIError("hermes kanban dispatch failed (exit 1)")

    monkeypatch.setattr(kanban_cli, "dispatch", _boom)
    r = _post(client, None)
    assert r.status_code == 400
    assert "failed" in r.json()["detail"]


def test_inprocess_lock_409(client, fake_dispatch):
    """调度已在运行（进程内锁被占）→ 409，且不触发 CLI。"""
    assert app_module._SCHED_RUN_LOCK.acquire(blocking=False)
    try:
        r = _post(client, None)
    finally:
        app_module._SCHED_RUN_LOCK.release()
    assert r.status_code == 409
    assert "运行中" in r.json()["detail"]
    assert fake_dispatch == {}


def test_board_lock_busy_409(client, monkeypatch, fake_dispatch):
    """board 调度锁被其他 tick 占用 → 409。"""
    monkeypatch.setattr(app_module, "_board_dispatch_lock_busy", lambda: True)
    r = _post(client, None)
    assert r.status_code == 409
    assert "正忙" in r.json()["detail"]
    assert fake_dispatch == {}


def test_concurrent_6_requests_1x200_5x409(client, fake_dispatch):
    """并发 6 触发：进程内锁保证恰 1 个成功，其余 409（幂等拦截）。"""
    # fake dispatch 需真实占用锁一段时间，否则第一个请求释放锁后
    # 后续请求可能连续成功（微秒级完成 → 竞争不成立，偶发 2×200）。
    fake_dispatch["delay"] = 0.3
    results = []
    barrier = threading.Barrier(6)

    def worker():
        barrier.wait()
        r = _post(client, None)
        results.append(r.status_code)

    threads = [threading.Thread(target=worker) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count(200) == 1
    assert results.count(409) == 5
    assert fake_dispatch["dry_run"] is False
