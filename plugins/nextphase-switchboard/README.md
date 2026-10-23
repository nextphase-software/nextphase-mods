# NextPhase Switchboard

A side pane that lists every Claude Code plugin installed for you, split into mods (plugins whose hooks file names a hooks module) and plain plugins, each with an on/off toggle.

Type `/nextphase-switchboard` (short form `/switchboard`) to open it. Pressing a toggle runs `claude plugin enable` or `claude plugin disable` for that plugin (it applies in every chat), then reloads plugins in the current chat so the change shows at once. Mods come back live; a plain plugin's skills may need a new chat. Press Refresh to read the list again after installing or removing a plugin.
