import { test, expect } from "bun:test";

import type { AgentConfig, ConvoDetail } from "./api";
import { buildDisplayMessages, mergeAssistantMessages, messageIdentity, type DisplayMessage } from "./chatState";

const agents: AgentConfig[] = [
  { id: "worker", name: "Worker", color: "#4d9375", is_default: true },
  { id: "reviewer", name: "Reviewer", color: "#d9a754", is_default: false },
];

function makeDetail(messages: any[]): ConvoDetail {
  return {
    id: "convo1",
    project_id: "project1",
    title: "Test convo",
    status: "done",
    created_at: "2025-01-01T00:00:00",
    updated_at: "2025-01-01T00:00:00",
    archived_at: null,
    autonomous_tools_enabled: true,
    context_tokens: 42,
    context_limit: 100,
    has_more: false,
    next_before: null,
    messages,
  };
}

test("buildDisplayMessages reconstructs tool approvals and assistant labels", () => {
  const detail = makeDetail([
    { type: "user-message", role: "user", content: "please help", message_id: "m1", attachments: [{ path: "note.txt", name: "note.txt", mime_type: "text/plain", size: 4, kind: "file" }], bash_mode: true },
    { type: "tool-call", role: "tool", name: "bash", input: '{"command":"git status"}', tool_call_id: "tc1", run_id: "run1" },
    { type: "tool-confirm", name: "bash", args: '{"command":"git status"}', tool_call_id: "tc1", run_id: "run1", can_allow_project: true, can_turn_on_auto: true },
    { type: "tool-output", output: "On branch main\n", tool_call_id: "tc1" },
    { type: "tool-result", name: "bash", output: "done", tool_call_id: "tc1", run_id: "run1" },
    { type: "assistant-message", role: "assistant", content: "All good", agent_id: "worker" },
  ]);

  const rebuilt = buildDisplayMessages(detail, agents);
  expect(rebuilt.title).toBe("Test convo");
  expect(rebuilt.autonomousToolsEnabled).toBe(true);
  expect(rebuilt.meta).toEqual({ turns: 0, context_tokens: 42, context_limit: 100 });
  expect(rebuilt.messages).toHaveLength(2);

  const user = rebuilt.messages[0];
  expect(user.role).toBe("user");
  expect(user.message_id).toBe("m1");
  expect(user.bashMode).toBe(true);
  expect(user.attachments?.[0].path).toBe("note.txt");

  const assistant = rebuilt.messages[1];
  expect(assistant.role).toBe("assistant");
  expect(assistant.agent_name).toBe("Worker");
  expect(assistant.blocks[0]).toMatchObject({
    type: "tool",
    name: "bash",
    tool_call_id: "tc1",
    output: "done",
    approvalStatus: "pending",
  });
  expect(assistant.blocks[1]).toEqual({ type: "text", content: "All good" });
});

test("buildDisplayMessages keeps tool-only results as assistant blocks", () => {
  const detail = makeDetail([
    { type: "tool-result", name: "share", output: "Shared to /demo", run_id: "run2" },
    { type: "assistant-message", role: "assistant", content: "" },
  ]);

  const rebuilt = buildDisplayMessages(detail, agents);
  expect(rebuilt.messages).toHaveLength(1);
  expect(rebuilt.messages[0].blocks[0]).toMatchObject({
    type: "tool",
    name: "share",
    output: "Shared to /demo",
  });
});

test("mergeAssistantMessages merges by tool_call_id and preserves pending user messages", () => {
  const rebuilt: DisplayMessage[] = [
    {
      role: "assistant",
      blocks: [{ type: "tool", name: "bash", input: '{"command":"git status"}', tool_call_id: "tc1", run_id: "run1" }],
    },
  ];
  const pending: DisplayMessage[] = [
    {
      role: "user",
      message_id: "pending1",
      pending: true,
      blocks: [{ type: "text", content: "draft" }],
    },
    {
      role: "assistant",
      blocks: [{ type: "tool", name: "bash", output: "done", tool_call_id: "tc1", run_id: "run1" }],
    },
  ];

  const merged = mergeAssistantMessages(rebuilt, pending);
  expect(merged).toHaveLength(2);
  expect(merged[0].blocks).toHaveLength(1);
  expect(merged[0].blocks[0]).toMatchObject({ type: "tool", tool_call_id: "tc1", output: "done" });
  expect(merged[1].role).toBe("user");
  expect(merged[1].pending).toBe(true);
});

test("messageIdentity distinguishes messages by role, ids, and block content", () => {
  const a: DisplayMessage = { role: "assistant", blocks: [{ type: "text", content: "hello" }] };
  const b: DisplayMessage = { role: "assistant", blocks: [{ type: "text", content: "hello again" }] };
  expect(messageIdentity(a)).not.toBe(messageIdentity(b));
});
