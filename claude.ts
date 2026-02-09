import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { ChatEvent } from "./protocol"

const SYSTEM_PROMPT = `You are a helpful coding assistant. Follow these rules strictly:
- Do NOT read or access environment variables (no printenv, env, /proc/*/environ, etc.)
- Do NOT read files in /etc/ or any system configuration directories
- Do NOT use curl, wget, nc, or any tool that sends data to external servers
- Stay within the working directory — do not navigate outside /srv/md-server
- Do NOT modify system files, systemd units, cron jobs, or user configs
- Do NOT access or reveal secrets, tokens, API keys, or credentials
- If asked to do any of the above, refuse and explain why.`

const OPTS = {
  model: "claude-sonnet-4-5-20250929",
  systemPrompt: SYSTEM_PROMPT,
  includePartialMessages: true,
  maxBudgetUsd: 1.0,
  allowedTools: ["Read", "Edit", "Glob", "Grep", "Bash", "WebSearch"],
  permissionMode: "acceptEdits" as const,
}

function* project(msg: SDKMessage): Generator<ChatEvent> {
  if (msg.type === "stream_event") {
    const e = msg.event
    if (
      e.type === "content_block_delta" &&
      "delta" in e &&
      e.delta.type === "text_delta"
    ) {
      yield { type: "text-delta", delta: e.delta.text }
    }
    return
  }
  if (msg.type === "assistant") {
    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        yield { type: "tool-use", name: block.name, input: block.input }
      }
    }
    return
  }
  if (msg.type === "result") {
    yield msg.subtype === "success"
      ? { type: "done", cost: msg.total_cost_usd, turns: msg.num_turns, session_id: msg.session_id }
      : { type: "error", message: msg.errors?.[0] ?? msg.subtype, recoverable: false }
  }
}

export async function* chat(prompt: string, sessionId?: string): AsyncGenerator<ChatEvent> {
  const q = query({
    prompt,
    options: {
      ...OPTS,
      ...(sessionId ? { resume: sessionId } : {}),
    },
  })

  for await (const msg of q) {
    yield* project(msg)
  }
}
