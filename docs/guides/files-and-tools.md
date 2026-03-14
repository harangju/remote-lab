# Files and Tools

## Tool activity in chat

When the agent uses tools, you see collapsible tool chips in the conversation.

Open a chip to inspect the full input and output. This makes it easier to audit what the agent actually did.

## Available tools

| Tool | What it does |
|------|-------------|
| `bash` | Run shell commands |
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `edit_file` | Find-and-replace in files |
| `glob` | Find files by pattern |
| `grep` | Search file contents |
| `web_search` | Search the web |

Tool availability can vary by agent configuration.

## File panel

Click a filename in the chat to open it in the side panel.

The file panel includes a full CodeMirror editor for inspecting and editing files without leaving the conversation.

## File finder

Press `Cmd+P` on macOS or `Ctrl+P` on other platforms to fuzzy-search for files in the current project.

This is the fastest way to jump between files when exploring a larger codebase.

## Working style

Remote Lab works best when chat and files reinforce each other:

- use chat to describe the goal
- use tool output to verify what happened
- open files in the panel to inspect or refine changes
- ask the agent to explain diffs, tradeoffs, or architecture in context

## Safety and scope

Tools are scoped to the current project directory.

That means the agent can act on real files and real shells, but only within the project boundary configured for that project.

The built-in `/share <path>` skill is a narrow exception: it reads a Markdown or HTML file from the current project, then publishes a copy into Remote Lab's global `public/` web directory. That lets you publish from any project without granting the agent general cross-project file access.

Use a plain project-relative path such as `/share docs/page.html` or `/share slides/week1.md`. If you paste a file mention like `@slides/week1.md`, `/share` will ignore the leading `@`.

`/share` first tries the exact path you gave. If that file does not exist, it will look for a unique matching Markdown or HTML file in the current project. If multiple matches exist, it returns a short list so you can disambiguate.
