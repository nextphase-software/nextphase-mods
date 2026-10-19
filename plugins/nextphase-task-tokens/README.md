# nextphase-task-tokens

See what each task costs in tokens, right above the prompt. A **task** is everything Claude does between your prompt and its reply: every model call, including subagents, and every tool call.

Install it and it works. There is nothing to configure.

## What you see

- **The band**, one line above the prompt after each task: the task's new tokens, a bar showing their kinds, how much of your 5-hour and weekly allowance is used, the number of calls and subagents, how long it took, and how full the context window is.
- **The card**, the band expanded (`/tokens expand`): each kind of token, the context re-read from the cache, which models answered, each subagent's share, each tool's estimated share, and when each allowance window resets.
- **The pane** (`/tokens`): the same card, plus the session's total and your last 10 tasks.

### How to read the numbers

- **New tokens** are what the task added: output (thinking included), context written to the cache, and uncached input.
- **Re-read** is the conversation served again from the cache on every call. It is shown apart because it is usually much larger and would drown out the rest.
- **Tool figures** are estimates from the size of each tool's result, marked with `~`. Every other count is exactly what the API reported.
- **Allowance** figures appear only when Claude Code reports them, which depends on your plan. Without them, the band leaves them out.
- A task that a Fable model answered, in the main loop or a subagent, carries a **✦ Fable** mark.

## Install

You need a Claude Code build that loads plugin hook modules (early access). It was built and tested with Claude Code 2.1.299; older builds, such as 2.1.233, refuse to load it.

```sh
claude plugin marketplace add nextphase-software/nextphase-mods
claude plugin install nextphase-task-tokens@nextphase
```

In an open session, run `/reload-plugins` to load it. The band appears after your next task.

## Commands

| Command | Effect |
| --- | --- |
| `/tokens` | Opens the pane |
| `/tokens off`, `/tokens on` | Hides or shows the band |
| `/tokens expand`, `/tokens collapse` | Expands the band into the card, or back to one line |

`/nextphase-task-tokens` is the same command under the plugin's full name. Your choices are kept across sessions; reinstalling the plugin resets them.

## Where it works

The terminal and the Claude Code desktop app; both are covered by its tests. Other surfaces have not been tested.

## Privacy

It reads only the usage figures Claude Code already has for your session. It stores nothing but your on/off choices, and sends nothing anywhere.

## Remove

```sh
claude plugin uninstall nextphase-task-tokens@nextphase
```

## Checks

From a clone of this repository:

```sh
claude plugin test plugins/nextphase-task-tokens
```

## Licence

[MIT](../../LICENSE).
