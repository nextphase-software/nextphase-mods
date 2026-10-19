# nextphase-pipeline-view

A live view of where your current piece of work stands: which stage it is in, what is happening now, and, most of all, **whether a decision is waiting for you**. It suits any staged workflow you run with Claude, such as plan → build → review → ship, with points where Claude must stop and ask you.

It shows a pane (`/pipeline`), a status-line entry and a notification when it is your turn. It shows only what your project reports, sends nothing anywhere and never estimates progress.

## How it works

The plugin knows nothing about your project. Every 10 seconds it runs a small program of your project's, its **collector**, and draws the JSON that program prints. This repository ships a starter collector that reads a plain status file; Claude keeps that file up to date as the work moves. Write your own collector when you want the pane to read real logs or tools.

```
.claude/pipeline-status.json  ──►  collector  ──►  JSON snapshot  ──►  pane, status line, notifications
(Claude updates it)                (your project's)                    (this plugin)
```

## Set it up in about five minutes

You need a Claude Code build that loads plugin hook modules (early access). It was built and tested with Claude Code 2.1.299; older builds, such as 2.1.233, refuse to load it. The starter collector needs Python 3.

**1. Install the plugin** (once, for every project):

```sh
claude plugin marketplace add nextphase-software/nextphase-mods
claude plugin install nextphase-pipeline-view@nextphase
```

The install may note that one option, **Collector command**, is not set. It is optional; leave it.

**2. Add the starter collector to your project.** From the project's root:

```sh
mkdir -p tools .claude
curl -fsSL -o tools/status-collector.py https://raw.githubusercontent.com/nextphase-software/nextphase-mods/main/plugins/nextphase-pipeline-view/examples/status-collector.py
curl -fsSL -o .claude/pipeline-status.json https://raw.githubusercontent.com/nextphase-software/nextphase-mods/main/plugins/nextphase-pipeline-view/examples/pipeline-status.json
```

Read `tools/status-collector.py` before going on; it is about 90 lines.

**3. Tell the plugin which collector to run.** Create `.claude/nextphase-pipeline-view.json`:

```json
{ "collector": "tools/status-collector.py" }
```

A relative path is resolved from the project folder. A `.py` collector runs with `python3 -I`; anything else runs as a program.

**4. Describe your stages** in `.claude/pipeline-status.json`:

```json
{
  "id": "M3",
  "title": "Checkout page",
  "stages": ["Plan", "Build", "Review", "Ship"],
  "gates": { "Review": "Approve the review", "Ship": "Approve the release" },
  "stage": "Build",
  "stage_started": "2026-10-19T14:05:00+00:00",
  "now": "writing the payment form",
  "your_turn": null,
  "done": false,
  "log": [{ "at": "14:05", "text": "Plan approved" }]
}
```

| Field | What to put there |
| --- | --- |
| `id`, `title` | A short name for the piece of work, and its title |
| `stages` | Your stages, in order |
| `gates` | The stages where Claude must stop for your decision, each with a short label. Optional |
| `stage` | The stage you are in now, one of `stages` |
| `stage_started` | When that stage began, as an ISO date and time. Optional; the pane then shows the time spent |
| `now` | What is happening, in a few words |
| `your_turn` | The decision you owe, in plain words, or `null` when nothing is needed from you |
| `done` | `true` once the work is finished |
| `log` | Recent events, `{ "at": "HH:MM", "text": "…" }`; the pane shows the five newest |

**5. Ask Claude to keep it current.** Add this to your project's `CLAUDE.md`:

```markdown
## Pipeline status
Keep `.claude/pipeline-status.json` current as the work moves:
- On entering a stage, set `stage`, `stage_started` (now, ISO) and `now`, and add a `log` line with the time.
- When you stop for my decision, set `your_turn` to the question in plain words. Never set it while work is still running.
- After I answer, set `your_turn` back to null and log the answer.
- When the work is finished, set `done` to true.
```

**6. Open the pane and approve the collector.** In Claude Code, run `/reload-plugins`, then `/pipeline`. The pane shows the command your project asks to run. Read it, then type:

```
/pipeline allow
```

The view starts at once and refreshes every 10 seconds.

## Approving a collector

A collector is a program, and a project you clone could name any program. So a collector named in a project's `.claude/nextphase-pipeline-view.json` **never runs until you approve it**:

- `/pipeline allow` approves the command and the exact contents of its program file, for this project folder.
- If either changes later, for example after a `git pull`, the plugin stops running it and asks again.
- `/pipeline revoke` withdraws the approval.
- Only you can approve, from your own prompt. Another plugin, a scheduled task or another session cannot.

The plugin's own **Collector command** option (`/plugin configure nextphase-pipeline-view@nextphase`) is a fallback for projects without their own file. You set it yourself, so it needs no approval.

## What you see

- **The top line** says whether you owe a decision: a **Your turn** box naming it, or "Nothing needed from you right now" with what is happening.
- **The stage strip:** `✓` done, `●` now, `◇` a gate ahead, `○` to do, `–` skipped, then the next decision. **Show stages** lists every stage.
- **Implementer and review boxes**, only when your collector reports them (see below).
- **Latest:** the five newest log lines, newest first.
- **Freshness:** when the snapshot was taken. If the collector stops working, the last good snapshot stays, marked "Not updating" with the reason.
- **The status line**, for example `M3 · 2 Build`, or `M3 · 3 Review · your turn: Approve the review` when a decision is owed.
- **A notification** (a toast where a notification cannot be shown) when a decision becomes owed, an implementer run finishes or fails, the review finishes, browser tests start failing, or the work is closed.

## Commands

| Command | Effect |
| --- | --- |
| `/pipeline` | Opens the pane |
| `/pipeline allow` | Approves this project's collector as it is now |
| `/pipeline revoke` | Withdraws that approval |

`/nextphase-pipeline-view` is the same command under the plugin's full name.

## Writing your own collector

Any program that prints one JSON object on standard output and exits 0. It runs in the project folder with a 20-second limit. Every field but `ok` is optional.

| Field | Meaning |
| --- | --- |
| `ok` | `true` when there is something to show; with `false`, `message` says why |
| `id`, `title` | The work item's identifier and name |
| `stage`, `stage_name`, `in_stage` | The current stage's number and name, and the time spent in it, such as `"12m 03s"` |
| `done` | `true` once the work is finished |
| `waiting` | What is happening now, in plain words |
| `your_turn` | The decision the person owes now, in plain words; `null` when nothing is owed. Without this field, a gate whose `gate_state` is `waiting` counts as owed |
| `stages` | A list of `{ n, name, state, gate, gate_state }`. `state` is `done`, `now`, `todo` or `skipped`; `gate` is a label or `null`; `gate_state` is `passed`, `not needed`, `waiting`, `ahead`, `not recorded` or `null` |
| `implementer` | The latest run of an agent doing the work: `{ name, label, thread, model, effort, running, failed, finished, finished_at, elapsed, last_event_ago, latest }`. `name` is who ran, such as `"Codex"` (default "Implementer"); `finished_at` is `"HH:MM"`. `codex` is read as an older name for this field |
| `review` | The latest validation run: `{ name, steps, total, exit_codes, current, e2e, e2e_summary, done }`. `total` is the number of steps planned, when known; `exit_codes` maps an exit code to how many steps ended with it; `e2e` is `"done/total"` browser tests and `e2e_summary` their result line |
| `container` | Where the implementer runs and its state, shown as written, such as `"VM running"` |
| `events` | Recent log lines, `[{ "at": "HH:MM", "text": "…" }]` |
| `collected_at` | When the snapshot was taken, `"HH:MM:SS"` |

The types are in [`types/index.d.ts`](types/index.d.ts). Report only what your files or tools record; the pane never fills gaps.

## Where it works

The terminal and the Claude Code desktop app; both are covered by its tests. Other surfaces have not been tested.

## Remove

```sh
claude plugin uninstall nextphase-pipeline-view@nextphase
```

Your project files stay as they are; delete `.claude/nextphase-pipeline-view.json` to stop a project naming a collector.

## Checks

From a clone of this repository:

```sh
claude plugin validate .
claude plugin test plugins/nextphase-pipeline-view
```

## Licence

[MIT](../../LICENSE).
