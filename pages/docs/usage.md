# Usage

## Authentication

Open `https://lab.yourdomain.com` and enter your `WS_TOKEN` when prompted. The token is saved in your browser for subsequent visits.

## Projects

Projects scope agent work to a specific directory on disk. All tools are sandboxed to that directory.

- **Create**: Click **New Project**, set a name and path (e.g., `/srv/my-app`), or paste a GitHub URL to clone a repo
- **Switch**: Click the project name in the header to go back to the list

## Conversations

Each project can have multiple conversations. They persist on disk — close your browser and pick up later. The agent keeps running server-side even if you disconnect; when you reconnect, you'll see everything that happened while you were away.

## Chat

Type a message and press Enter. The agent streams its response in real-time.

### Tools

When the agent uses tools, you'll see collapsible tool chips in the chat:

| Tool | What it does |
|------|-------------|
| `bash` | Run shell commands |
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `edit_file` | Find-and-replace in files |
| `glob` | Find files by pattern |
| `grep` | Search file contents |
| `web_search` | Search the web (requires Brave API key) |

Click a tool chip to see the full input and output.

### File panel

Click any filename in the chat to open it in the side panel with a full CodeMirror editor. Press ++cmd+p++ (or ++ctrl+p++) to fuzzy-search for files in the project.

### @mentions and multi-agent

Projects can have multiple agents, each with their own model, system prompt, and tools. Type `@` in the chat input to see available agents and mention one by name to route your message to it.

Agents can also @mention each other, enabling autonomous multi-step workflows — for example, an orchestrator agent that delegates tasks to worker agents and a reviewer agent.

### Context compaction

When the conversation approaches the model's context limit, older messages are automatically summarized. You'll see a compaction indicator when this happens. The full history is always saved on disk.

## Tips

- **Be specific** — "Add input validation to `src/components/Signup.tsx`" beats "fix the form"
- **Use @mentions** — route to the right agent for the job
- **Check the tools** — expand tool chips to verify what the agent did
- **Use projects** — separate codebases into separate projects to keep agents focused
