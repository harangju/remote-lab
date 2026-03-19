# Remote Lab

**Remote Lab — a persistent, mobile-friendly, self-hosted AI workspace for real files and real tools.**

I wanted something like Claude Code, but:

- **persistent** — keeps running after you leave, and you can reconnect later to monitor progress
- **mobile-friendly** — a real chat UI you can use from your phone, plus optional voice input
- **connected to real projects** — files, bash, and actual project directories
- **editable** — inspect and edit files in the same interface
- **private** — runs on your own server
- **hackable from within itself** — use the tool to improve the tool
- **not locked to one model** — choose the provider that fits

Existing tools each got part of this right, but not the whole workflow.

- **chat apps** are easy to use, but usually do not have real system access
- **terminal coding agents** are powerful, but are not great on mobile and usually assume an active session
- **remote agent systems** can be persistent, but don't have great UI and system access

Remote Lab is an attempt to combine those missing pieces in one place.

## Features

### Persistent

Keep an agent running after you leave. Close the browser, come back later, reconnect to the same conversation, and monitor what happened while you were away.

### Mobile-friendly

Use a real chat UI from your phone, not just a terminal session. Optional voice input lets you speak into the draft before sending.

### System access

Agents can work on real project directories with real tools:

- files
- bash
- git repos
- real outputs you can keep, diff, commit, or publish

### File editing

Inspect and edit files in the same interface you use to chat with the agent.

### Shareable output

Publish Markdown or HTML artifacts directly from the workspace when you want to share results.

### Private / self-hosted

Remote Lab is meant to be personal infrastructure.

- runs on your own VPS
- no database
- flat-file storage
- simple enough to inspect and modify

### Hackable from within itself

One of the most interesting parts is that you can improve Remote Lab from inside Remote Lab.

You can use it to edit its own code, test changes, and iterate on the system while working in it.

### Model / provider agnostic

Remote Lab supports multiple providers and lets you switch models globally or per agent.

### Multi-agent delegation

Coordinate work between specialized agents with `@mentions` inside the same workspace.

## Core ideas

- **Projects are the unit of scope** — each project points at a real directory on disk, and agent tools are sandboxed there.
- **Conversations are persistent** — close the browser, come back later, and continue where you left off.
- **Agent runs are decoupled from your browser session** — reconnecting lets you catch up on work that kept running.
- **Agents can collaborate** — route work explicitly with `@mentions` or let agents delegate to each other.
- **The system stays simple** — flat files instead of a database, minimal infrastructure, easy to inspect and modify.

## Where to go next

- Start with [Getting Started](getting-started.md) for the fastest path to a working install.
- Read [Projects and Chat](guides/projects-and-chat.md) for the basic interaction model.
- Read [Files and Tools](guides/files-and-tools.md) and [Agents and Mentions](guides/agents-and-mentions.md) for advanced workflows.
- Use [Deployment](reference/deployment.md), [Architecture](reference/architecture.md), and [Operations](reference/operations.md) as reference docs.
