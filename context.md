# Current context

- Add a first-class bash mode triggered when a chat message begins with `!` as the very first character.
- This should route through the existing `bash` tool behavior behind the scenes, preserving approval/autonomy rules and streaming tool output.
- Semantics:
  - `!cmd` runs the exact command.
  - bare `!` or whitespace-only after `!` returns a recoverable empty-command error.
  - `\!foo` sends a literal chat message beginning with `!`.
- UI should indicate bash mode in the composer with a subtle terminal tint/border, and sent bash-mode user messages should render distinctly in history.
