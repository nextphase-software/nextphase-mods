# NextPhase plugins for Claude Code

Two plugins from [NextPhase Software](https://github.com/nextphase-software) that add live views to Claude Code. Both work only with data on your machine and send nothing anywhere.

| Plugin | What it adds | Setup |
| --- | --- | --- |
| [`nextphase-task-tokens`](plugins/nextphase-task-tokens) | A line above the prompt, and a pane, showing what each task cost in tokens: by kind, model, subagent and tool, with your 5-hour and weekly allowance | None: install and it works |
| [`nextphase-pipeline-view`](plugins/nextphase-pipeline-view) | A pane, a status-line entry and notifications showing which stage your work is in and whether a decision is waiting for you | About five minutes per project: a status file, a starter collector and a few lines in `CLAUDE.md`. Its README walks through it |

## Requirements

- **A Claude Code build that loads plugin hook modules.** This plugin surface is early access and may change between releases. Both plugins were built and tested with Claude Code 2.1.299; older builds, such as 2.1.233, refuse to load them. Run `claude --version` to check yours.
- **Python 3**, only for the pipeline view's starter collector.

## Install

Add the marketplace once, then install the plugins you want:

```sh
claude plugin marketplace add nextphase-software/nextphase-mods
claude plugin install nextphase-task-tokens@nextphase
claude plugin install nextphase-pipeline-view@nextphase
```

Inside Claude Code, the same works as `/plugin marketplace add nextphase-software/nextphase-mods`, then `/plugin install <name>@nextphase`. Run `/reload-plugins` to load a newly installed plugin into an open session.

Each plugin's README covers what it shows, its commands and its settings.

## Safety

- **Task tokens** reads only the usage figures Claude Code already has for your session.
- **The pipeline view** runs a program your project names, so a repository you clone could name anything. It never runs a project's program until you approve it with `/pipeline allow`, and it asks again whenever that program changes. Read the program before you approve it.

## Remove

```sh
claude plugin uninstall nextphase-task-tokens@nextphase
claude plugin uninstall nextphase-pipeline-view@nextphase
claude plugin marketplace remove nextphase
```

## Develop

Clone the repository and add the clone as a marketplace: `claude plugin marketplace add ./nextphase-mods`. A marketplace added from a folder is read live, so after an edit `/reload-plugins` picks it up. Check a plugin with:

```sh
claude plugin validate .
claude plugin test plugins/<name>
```

Issues and pull requests are welcome.

## Licence

[MIT](LICENSE).
