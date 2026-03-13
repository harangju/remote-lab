# Agents and Mentions

## Multiple agents per project

A project can define multiple agents.

Each agent can have its own:

- model
- system prompt
- tool set
- role in your workflow

This lets you create setups such as:

- a general-purpose coding agent
- a reviewer agent
- a docs agent
- an orchestrator that delegates to specialists

## Routing with `@mentions`

Type `@` in the chat input to see the agents available in the current project.

Mentioning an agent routes your message to that specific agent.

Examples:

- `@docs rewrite the setup guide for clarity`
- `@reviewer check this change for risky assumptions`
- `@backend trace why this endpoint is timing out`

## Agent-to-agent delegation

Agents can also `@mention` each other.

This enables multi-step workflows where one agent coordinates or hands off work to another.

For example:

1. an orchestrator breaks a task into parts
2. a coding agent makes the change
3. a reviewer agent audits the result
4. a docs agent updates documentation

## Model selection

Remote Lab supports multiple LLM providers.

A model can be selected globally for a conversation or overridden per agent. If an agent does not specify its own model, it falls back to the global model.

## When to use multiple agents

Use multiple agents when you want clearer specialization, review boundaries, or delegation. For straightforward tasks, a single good default agent is often enough.
