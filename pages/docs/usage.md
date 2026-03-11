# Usage

## Authentication

Open `https://lab.yourdomain.com` and enter your `WS_TOKEN` when prompted. The token is saved in your browser for subsequent visits.

## Projects

Projects scope the agent to a specific directory on disk. All tools are sandboxed there.

- **Create**: Click **New Project**, set a name and path (e.g., `/srv/my-app`), or paste a GitHub URL to clone
- **Switch**: Click the project name in the header to go back to the list

## Conversations

Each project can have multiple conversations. They persist on disk — close your browser and pick up later.

## Chat

Type a message and press Enter. The agent streams its response in real-time.

### Tools

The agent uses tools to complete your requests. Tool chips appear in the chat showing what it's doing:

| Tool | What it does |
|------|-------------|
| `bash` | Run shell commands |
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `edit_file` | Find-and-replace in files |
| `glob` | Find files by pattern |
| `grep` | Search file contents |

Click a tool chip to see the full input and output.

### File panel

Click any filename in the chat to open it in the side panel with a full code editor.

### File finder

Press ++cmd+p++ (or ++ctrl+p++) to fuzzy-search for files in the project.

### Agents

Projects come with default agents (orchestrator, worker, reviewer). Agents can @mention each other to collaborate. You can also create custom agents per project.

## Context compaction

When the conversation approaches the model's context limit, older messages are automatically summarized. The full history is still saved on disk.

## Tips

- **Be specific** — "Add input validation to `src/components/Signup.tsx`" beats "fix the form"
- **Iterate** — the agent remembers the full conversation
- **Check the tools** — expand tool chips to verify what the agent did
- **Use projects** — separate codebases into separate projects to keep the agent focused
