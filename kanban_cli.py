"""Wrapper around the `hermes kanban` CLI.

Every mutating operation goes through this module — the web app never writes
to the SQLite database directly. The CLI lives at `hermes` on PATH (a venv
shim into the hermes-agent install).

CLI signature notes (verified with `hermes kanban <verb> --help`):
- `assign` / `reassign` take the profile as a positional arg (not --assignee).
- `block`, `schedule`, `promote`, `request-changes` require a reason positional.
- `attach-rm` takes a global attachment id, not a per-task flag.
- Commands with `--json` support: list, show, create, stats, promote.
"""
import os
import subprocess

HERMES_BIN = os.environ.get("HERMES_BIN", "hermes")
TIMEOUT = int(os.environ.get("KANBAN_CLI_TIMEOUT", "60"))


class CLIError(Exception):
    def __init__(self, message, returncode=None):
        super().__init__(message)
        self.returncode = returncode


def run_cli(args, timeout=TIMEOUT):
    """Run `hermes kanban <args>` as a subprocess and return the CompletedProcess."""
    return subprocess.run(
        [HERMES_BIN, "kanban"] + args,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def run_checked(args, timeout=TIMEOUT):
    proc = run_cli(args, timeout=timeout)
    if proc.returncode != 0:
        detail = (proc.stderr or "").strip() or (proc.stdout or "").strip()
        raise CLIError(detail or "hermes kanban %s failed (exit %d)" % (args[0], proc.returncode), proc.returncode)
    return proc


def summary(proc):
    return (proc.stdout or "").strip() or (proc.stderr or "").strip() or "ok"


# --- task lifecycle ---------------------------------------------------------

def create(title, body=None, assignee=None, priority=None, parents=None,
           workspace=None, triage=False, created_by="web"):
    args = ["create", title, "--created-by", created_by, "--json"]
    if body:
        args += ["--body", body]
    if assignee:
        args += ["--assignee", assignee]
    if priority is not None:
        args += ["--priority", str(priority)]
    for pid in parents or []:
        args += ["--parent", pid]
    if workspace:
        args += ["--workspace", workspace]
    if triage:
        args.append("--triage")
    return run_checked(args)


def complete(task_id):
    return run_checked(["complete", task_id])


def block(task_id, reason=None):
    return run_checked(["block", task_id, reason or "via web"])


def unblock(task_id, reason=None):
    args = ["unblock", task_id]
    if reason:
        args += ["--reason", reason]
    return run_checked(args)


def schedule(task_id, reason=None):
    return run_checked(["schedule", task_id, reason or "scheduled via web"])


def promote(task_id, reason=None):
    return run_checked(["promote", task_id, reason or "via web"])


def request_review(task_id):
    return run_checked(["request-review", task_id])


def reopen_review(task_id, reason=None):
    args = ["reopen-review", task_id]
    if reason:
        args += ["--reason", reason]
    return run_checked(args)


def request_changes(task_id, reason=None):
    return run_checked(["request-changes", task_id, reason or "changes requested"])


def archive(task_id):
    return run_checked(["archive", task_id])


def reclaim(task_id, reason=None):
    args = ["reclaim", task_id]
    if reason:
        args += ["--reason", reason]
    return run_checked(args)


# --- assignment -------------------------------------------------------------

def assign(task_id, assignee):
    return run_checked(["assign", task_id, assignee])


def reassign(task_id, assignee):
    return run_checked(["reassign", task_id, assignee])


# --- dependencies -----------------------------------------------------------

def link(parent_id, child_id):
    return run_checked(["link", parent_id, child_id])


def unlink(parent_id, child_id):
    return run_checked(["unlink", parent_id, child_id])


# --- comments / model -------------------------------------------------------

def comment(task_id, body, author="web"):
    return run_checked(["comment", task_id, body, "--author", author])


def set_model(task_id, model=None, provider=None):
    args = ["set-model", task_id, model or "none"]
    if provider:
        args += ["--provider", provider]
    return run_checked(args)


# --- attachments ------------------------------------------------------------

def attach(task_id, path):
    return run_checked(["attach", task_id, path])


def attach_rm(attachment_id):
    return run_checked(["attach-rm", str(attachment_id)])
