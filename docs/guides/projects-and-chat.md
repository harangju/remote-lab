# Projects and Chat

## Authentication

Open your Remote Lab URL and enter your `WS_TOKEN` when prompted. The token is saved in your browser for later visits.

## Projects

Projects are the main unit of scope in Remote Lab.

Each project points to a directory on disk, and all agent tools are sandboxed to that directory. This keeps work focused and prevents one conversation from wandering across unrelated codebases.

You can:

- create a project by name and path
- point a project at an existing directory
- paste a GitHub URL to clone a repository into a new project
- switch back to the project list from the header

Typical examples:

- `/srv/projects/my-app`
- `/srv/projects/client-site`
- `/srv/projects/research-notes`

## Conversations

Each project can have multiple conversations.

Conversations persist on disk, so you can close the browser and continue later from the same laptop or a different device. Agent runs are decoupled from the WebSocket connection, which means work can continue server-side while you are disconnected.

When you reconnect, you can monitor the messages and tool activity that happened while you were away.

## Chat

Type a message and press Enter to send it.

Responses stream in real time. While the agent works, you may see text output, reasoning indicators, and tool activity appear incrementally.

## Tips for better results

- be specific about the task and the files involved
- say what outcome you want, not just what is broken
- keep unrelated work in separate projects
- use separate conversations when a task changes direction significantly

Examples:

- `Add input validation to signup flow in frontend/src/views/Signup.tsx`
- `Trace why the webhook retries are failing and propose a minimal fix`
- `Summarize the auth architecture in this repo and point out weak spots`
