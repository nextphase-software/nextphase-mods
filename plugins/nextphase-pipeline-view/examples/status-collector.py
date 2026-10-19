#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Starter collector for nextphase-pipeline-view.

Reads a small status file you (or Claude) keep up to date, by default
.claude/pipeline-status.json, and prints the snapshot the pane draws.
Python 3 standard library only. Copy it into your project, for example as
tools/status-collector.py, and name it in .claude/nextphase-pipeline-view.json.

The status file:
  {
    "id": "M3",                       # short name of the work item
    "title": "Checkout page",
    "stages": ["Plan", "Build", "Review", "Ship"],
    "gates": {"Review": "Approve the review", "Ship": "Approve the release"},
    "stage": "Build",                 # the stage you are in now
    "stage_started": "2026-10-19T14:05:00+00:00",   # optional
    "now": "writing the payment form",              # what is happening, in a few words
    "your_turn": null,                # the decision owed to you, or null
    "done": false,
    "log": [{"at": "14:05", "text": "Plan approved"}]
  }
"""
import datetime
import json
import sys
from pathlib import Path

STATUS = Path(sys.argv[1] if len(sys.argv) > 1 else ".claude/pipeline-status.json")


def since(iso, now):
    try:
        start = datetime.datetime.fromisoformat(iso)
        if start.tzinfo is None:
            start = start.astimezone()
        s = max(0, int((now - start).total_seconds()))
        return f"{s // 3600}h {s % 3600 // 60:02d}m" if s >= 3600 else f"{s // 60}m {s % 60:02d}s"
    except (TypeError, ValueError):
        return None


def main():
    now = datetime.datetime.now().astimezone()
    if not STATUS.exists():
        print(json.dumps({"ok": False, "message": f"No status file yet: create {STATUS}."}))
        return
    try:
        st = json.loads(STATUS.read_text(encoding="utf-8"))
    except ValueError as err:
        print(json.dumps({"ok": False, "message": f"{STATUS} is not valid JSON: {err}"}))
        return
    names = [str(n) for n in st.get("stages") or []]
    if not names:
        print(json.dumps({"ok": False, "message": f'{STATUS} lists no "stages".'}))
        return
    gates = st.get("gates") or {}
    done = bool(st.get("done"))
    current = names.index(st["stage"]) + 1 if st.get("stage") in names else 1
    if done:
        current = len(names)
    turn = st.get("your_turn") or None
    stages = []
    for n, name in enumerate(names, 1):
        gate = gates.get(name)
        state = "done" if done or n < current else "now" if n == current else "todo"
        gate_state = None
        if gate:
            gate_state = "passed" if state == "done" else "waiting" if n == current and turn else "ahead"
        stages.append({"n": n, "name": name, "state": state, "gate": gate, "gate_state": gate_state})
    snapshot = {
        "ok": True,
        "id": st.get("id") or STATUS.stem,
        "title": st.get("title") or "",
        "stage": current,
        "stage_name": names[current - 1],
        "in_stage": since(st.get("stage_started"), now),
        "done": done,
        "waiting": st.get("now"),
        "your_turn": turn,
        "stages": stages,
        "events": [{"at": str(e.get("at", "")), "text": str(e.get("text", ""))} for e in (st.get("log") or [])[-8:]],
        "collected_at": now.strftime("%H:%M:%S"),
    }
    print(json.dumps(snapshot, ensure_ascii=False))


if __name__ == "__main__":
    main()
