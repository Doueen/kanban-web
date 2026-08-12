"""pytest 骨架（M1-6 E11）：kanban_cli.py 参数构造。

不真实执行 CLI —— monkeypatch subprocess.run 捕获 argv，钉住参数构造。
"""
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import kanban_cli  # noqa: E402


@pytest.fixture()
def fake_run(monkeypatch):
    """Capture argv; return success with empty output unless body raises."""
    captured = {}

    def _run(args, capture_output=True, text=True, timeout=None):
        captured["args"] = args
        captured["timeout"] = timeout
        return subprocess.CompletedProcess(args, 0, stdout='{"ok":true}', stderr="")

    monkeypatch.setattr(subprocess, "run", _run)
    return captured


def test_run_cli_prepends_hermes_kanban(fake_run):
    kanban_cli.run_cli(["list", "--json"])
    assert fake_run["args"][:2] == ["hermes", "kanban"]
    assert fake_run["args"][2:] == ["list", "--json"]


def test_create_builds_full_argv(fake_run):
    kanban_cli.create(
        "标题", body="b", assignee="alice", priority=3,
        parents=["t_p1", "t_p2"], workspace="dir:/x", triage=True,
    )
    assert fake_run["args"] == [
        "hermes", "kanban", "create", "标题", "--created-by", "web", "--json",
        "--body", "b", "--assignee", "alice", "--priority", "3",
        "--parent", "t_p1", "--parent", "t_p2",
        "--workspace", "dir:/x", "--triage",
    ]


def test_create_minimal_argv(fake_run):
    kanban_cli.create("标题")
    assert fake_run["args"] == [
        "hermes", "kanban", "create", "标题", "--created-by", "web", "--json",
    ]


@pytest.mark.parametrize(
    "verb_fn,expected",
    [
        (lambda: kanban_cli.complete("t_1"), ["complete", "t_1"]),
        (lambda: kanban_cli.block("t_1", "原因"), ["block", "t_1", "原因"]),
        (lambda: kanban_cli.block("t_1"), ["block", "t_1", "via web"]),
        (lambda: kanban_cli.unblock("t_1", "r"), ["unblock", "t_1", "--reason", "r"]),
        (lambda: kanban_cli.promote("t_1"), ["promote", "t_1", "via web"]),
        (lambda: kanban_cli.archive("t_1"), ["archive", "t_1"]),
        (lambda: kanban_cli.assign("t_1", "alice"), ["assign", "t_1", "alice"]),
        (lambda: kanban_cli.comment("t_1", "hi"), ["comment", "t_1", "hi", "--author", "web"]),
        (lambda: kanban_cli.boards_list(), ["boards", "list", "--json"]),
        (lambda: kanban_cli.boards_switch("b2"), ["boards", "switch", "b2"]),
    ],
)
def test_verb_argv_construction(fake_run, verb_fn, expected):
    verb_fn()
    assert fake_run["args"][2:] == expected


def test_run_checked_raises_cli_error_on_nonzero(monkeypatch):
    def _fail(args, capture_output=True, text=True, timeout=None):
        return subprocess.CompletedProcess(args, 1, stdout="", stderr="boom")

    monkeypatch.setattr(subprocess, "run", _fail)
    with pytest.raises(kanban_cli.CLIError) as exc:
        kanban_cli.run_checked(["list"])
    assert "boom" in str(exc.value)
    assert exc.value.returncode == 1


def test_summary_joins_stdout_stderr(monkeypatch):
    def _run(args, capture_output=True, text=True, timeout=None):
        return subprocess.CompletedProcess(args, 0, stdout="out", stderr="err")

    monkeypatch.setattr(subprocess, "run", _run)
    assert kanban_cli.summary(kanban_cli.run_cli(["x"])) == "out"
