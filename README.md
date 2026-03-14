# remote-lab

**Remote Lab — a self-hosted, self-hackable, agentic chat+file workspace.**

Remote Lab is for people who want AI to work in a **real environment**, not in a disposable chat or a job queue.

It gives you a persistent workspace where you can chat with agents, inspect and edit files, steer long-running work, coordinate multi-agent workflows with `@mentions`, and even improve Remote Lab from inside Remote Lab.

The detailed docs live at your docs site, e.g. [yourname.github.io/remote-lab](https://yourname.github.io/remote-lab/).

## Why this exists

Most AI tools split into a few camps:

- **chat apps** — conversational, but disconnected from your files and machine
- **local coding tools** — powerful, but tied to one session on one computer
- **agent runners** — persistent, but often feel like job queues or message-bot wrappers

Remote Lab tries to combine the best parts:

- **conversational like Claude/ChatGPT**
- **acts on real files like Claude Code**
- **persistent and remote like self-hosted agent systems**

## What makes it useful

### 1. It’s a real workspace, not just a chat

You don’t just send prompts. You chat, inspect files, edit files, and watch work happen in one place.

That makes it useful for more than coding:

- writing
- research
- docs
- repo maintenance
- debugging
- ops work
- any other file-based work

### 2. It keeps running after you leave

Remote Lab is built for **asynchronous work**.

Give an agent something to do, close the browser, come back later, and continue from the same conversation. You can review what happened, redirect it, or send it off again.

### 3. It works on your actual machine

Agents can operate on your real project directory with real shell tools.

That means:

- real files
- real git repos
- real bash
- real outputs you can keep, diff, commit, or publish

### 4. It’s conversational, but not chat-only

The interface is a hybrid: chat for direction, files for inspection and editing.

That’s the sweet spot between:

- a pure chat box with no access to the work
- a traditional app UI with no flexible conversation layer
- Slack/Telegram-style control loops that are fine for notifications but awkward for real work

Remote Lab also supports multi-agent workflows via `@mentions`, and optional voice input via Deepgram, so you can speak into the draft before sending.

### 5. It’s self-hosted and minimal

Remote Lab is meant to be personal infrastructure.

- runs on a cheap VPS
- no database
- flat-file storage
- small dependency footprint
- simple enough to understand and modify

### 6. It’s self-hackable

One of the coolest parts is that you can improve Remote Lab **from inside itself**.

You can use Remote Lab to edit Remote Lab, test changes, and iterate on the system while working in it.

## Docs map

- [Overview](https://yourname.github.io/remote-lab/)
- [Getting Started](https://yourname.github.io/remote-lab/getting-started/)
- [Projects and Chat](https://yourname.github.io/remote-lab/guides/projects-and-chat/)
- [Files and Tools](https://yourname.github.io/remote-lab/guides/files-and-tools/)
- [Agents and Mentions](https://yourname.github.io/remote-lab/guides/agents-and-mentions/)
- [Self-Hacking](https://yourname.github.io/remote-lab/guides/self-hacking/)
- [Deployment](https://yourname.github.io/remote-lab/reference/deployment/)
- [Architecture](https://yourname.github.io/remote-lab/reference/architecture/)
- [Operations](https://yourname.github.io/remote-lab/reference/operations/)

## What’s included

- persistent agent conversations
- chat UI with streaming responses
- file panel/editor
- project-scoped bash and file tools
- multi-agent workflows with `@mentions`
- mobile-friendly remote access
- optional live voice input with Deepgram
- built-in docs publishing
- flat-file storage, no database
- self-hosted deployment on your own VPS
