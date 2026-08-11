"""Wrapper around the `hermes kanban` CLI.

Every mutating operation goes through this module — the web app never writes
to the SQLite database directly. The CLI lives at `hermes` on PATH (a venv
shim into the hermes-agent install).

CLI signature notes (verified with `hermes kanban <verb> --help`):
- `assign` / `reassign` take the profile as a positional arg (not --assignee).
- `block`, `schedule`, `promote`, `request-changes` require a reason positional.
- `attach-rm` takes a global attachment id, not a per-task flag.
- Commands with `--json` support: list, show, create, stats, promote, boards,
  notify-list, diagnostics, assignees, repair, specify, decompose.
- AI-powered verbs (specify / decompose / swarm) can take minutes — they use
  LONG_TIMEOUT (default 300s).
"""
import os
import subprocess

HERMES_BIN = os.environ.get("HERMES_BIN", "hermes")
TIMEOUT = int(os.environ.get("KANBAN_CLI_TIMEOUT", "60"))
LONG_TIMEOUT = int(os.environ.get("KANBAN_CLI_LONG_TIMEOUT", "300"))


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


# --- boards -----------------------------------------------------------------

def boards_list(include_archived=False):
    args = ["boards", "list", "--json"]
    if include_archived:
        args.append("--all")
    return run_checked(args)


def boards_show():
    return run_checked(["boards", "show"])


def boards_create(slug, name=None, description=None, icon=None, color=None):
    args = ["boards", "create", slug]
    if name:
        args += ["--name", name]
    if description:
        args += ["--description", description]
    if icon:
        args += ["--icon", icon]
    if color:
        args += ["--color", color]
    return run_checked(args)


def boards_switch(slug):
    return run_checked(["boards", "switch", slug])


def boards_rename(slug, name):
    return run_checked(["boards", "rename", slug, name])


def boards_set_workdir(slug, path=None):
    args = ["boards", "set-default-workdir", slug]
    if path:
        args.append(path)
    return run_checked(args)


def boards_rm(slug, delete=False):
    args = ["boards", "rm", slug]
    if delete:
        args.append("--delete")
    return run_checked(args)


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


# --- task extended (v2) -----------------------------------------------------

def edit(task_id, result, summary=None, metadata=None):
    args = ["edit", task_id, "--result", result]
    if summary:
        args += ["--summary", summary]
    if metadata:
        args += ["--metadata", metadata]
    return run_checked(args)


def specify(task_id):
    return run_checked(["specify", task_id], timeout=LONG_TIMEOUT)


def decompose(task_id):
    return run_checked(["decompose", task_id], timeout=LONG_TIMEOUT)


def claim(task_id, ttl=None):
    args = ["claim", task_id]
    if ttl is not None:
        args += ["--ttl", str(ttl)]
    return run_checked(args)


def heartbeat(task_id, note=None):
    args = ["heartbeat", task_id]
    if note:
        args += ["--note", note]
    return run_checked(args)


def context(task_id):
    return run_checked(["context", task_id])


def log(task_id, tail=None):
    args = ["log", task_id]
    if tail is not None:
        args += ["--tail", str(tail)]
    return run_checked(args)


# --- notifications ----------------------------------------------------------

def notify_list(task_id=None):
    args = ["notify-list", "--json"]
    if task_id:
        args.append(task_id)
    return run_checked(args)


def notify_subscribe(task_id, platform, chat_id, chat_type=None, thread_id=None,
                     user_id=None, notifier_profile=None):
    args = ["notify-subscribe", task_id, "--platform", platform, "--chat-id", chat_id]
    if chat_type:
        args += ["--chat-type", chat_type]
    if thread_id:
        args += ["--thread-id", thread_id]
    if user_id:
        args += ["--user-id", user_id]
    if notifier_profile:
        args += ["--notifier-profile", notifier_profile]
    return run_checked(args)


def notify_unsubscribe(task_id, platform, chat_id, thread_id=None):
    args = ["notify-unsubscribe", task_id, "--platform", platform, "--chat-id", chat_id]
    if thread_id:
        args += ["--thread-id", thread_id]
    return run_checked(args)


# --- swarm / global ---------------------------------------------------------

def swarm(goal, workers, verifier, synthesizer, priority=None, created_by="web"):
    args = ["swarm", goal, "--verifier", verifier, "--synthesizer", synthesizer,
            "--created-by", created_by, "--json"]
    for w in workers:
        args += ["--worker", w]
    if priority is not None:
        args += ["--priority", str(priority)]
    return run_checked(args, timeout=LONG_TIMEOUT)


def diagnostics(severity=None, task=None):
    args = ["diagnostics", "--json"]
    if severity:
        args += ["--severity", severity]
    if task:
        args += ["--task", task]
    return run_checked(args)


def gc(event_retention_days=None, log_retention_days=None):
    args = ["gc"]
    if event_retention_days is not None:
        args += ["--event-retention-days", str(event_retention_days)]
    if log_retention_days is not None:
        args += ["--log-retention-days", str(log_retention_days)]
    return run_checked(args)


def repair():
    return run_checked(["repair", "--json"])


def assignees():
    return run_checked(["assignees", "--json"])
