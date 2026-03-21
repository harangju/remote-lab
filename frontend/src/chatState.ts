import type { AgentConfig, Attachment, ConvoDetail } from "./api";

export type ApprovalScope = "once" | "project" | "auto";

export type StreamBlock =
  | { type: "text"; content: string }
  | {
      type: "tool";
      name: string;
      input?: string;
      output?: string;
      diff?: string;
      liveOutput?: string;
      tool_call_id?: string;
      run_id?: string;
      awaitingApproval?: boolean;
      approvalStatus?: "pending" | "approved" | "denied";
      canAllowProject?: boolean;
      canTurnOnAuto?: boolean;
      approvedScope?: ApprovalScope;
    }
  | { type: "system"; content: string; tone?: "error" | "info" };

export interface DisplayMessage {
  role: "user" | "assistant" | "system";
  blocks: StreamBlock[];
  agent_id?: string;
  agent_name?: string;
  agent_color?: string;
  message_id?: string;
  pending?: boolean;
  attachments?: Attachment[];
  bashMode?: boolean;
  defaultExpandedTools?: boolean;
}

export interface MetaInfo {
  turns: number;
  context_tokens: number;
  context_limit: number;
}

export function blockIdentity(block: StreamBlock): string {
  if (block.type === "tool") return `tool:${block.run_id || ""}:${block.tool_call_id || block.name}:${block.input || ""}:${block.output || ""}`;
  if (block.type === "text") return `text:${block.content}`;
  return `system:${block.tone || "info"}:${block.content}`;
}

export function messageIdentity(message: DisplayMessage): string {
  return `${message.role}:${message.agent_id || ""}:${message.message_id || ""}:${message.blocks.map(blockIdentity).join("|")}`;
}


export function buildDisplayMessages(detail: ConvoDetail, agentList: AgentConfig[]): { messages: DisplayMessage[]; meta: MetaInfo | null; title: string; autonomousToolsEnabled: boolean } {
  const msgs: DisplayMessage[] = [];
  let pendingBlocks: StreamBlock[] = [];
  const toolIndexById = new Map<string, number>();

  const flushPending = () => {
    if (pendingBlocks.length > 0) {
      msgs.push({ role: "assistant", blocks: [...pendingBlocks] });
      pendingBlocks = [];
      toolIndexById.clear();
    }
  };

  for (const m of detail.messages) {
    const mAny = m as any;
    const type = mAny.type;

    if (type === "tool-call") {
      pendingBlocks.push({ type: "tool", name: mAny.name, input: mAny.input, tool_call_id: mAny.tool_call_id || undefined, run_id: mAny.run_id || undefined });
      if (mAny.tool_call_id) toolIndexById.set(mAny.tool_call_id, pendingBlocks.length - 1);
      continue;
    }

    if (type === "tool-confirm") {
      const pendingTool: StreamBlock = {
        type: "tool",
        name: mAny.name,
        input: mAny.args,
        tool_call_id: mAny.tool_call_id || undefined,
        run_id: mAny.run_id || undefined,
        awaitingApproval: true,
        approvalStatus: "pending",
        canAllowProject: mAny.can_allow_project !== false,
        canTurnOnAuto: mAny.can_turn_on_auto !== false,
      };
      if (!mAny.tool_call_id) {
        pendingBlocks.push(pendingTool);
        continue;
      }
      const idx = toolIndexById.get(mAny.tool_call_id);
      if (idx != null && pendingBlocks[idx]?.type === "tool") {
        const existing = pendingBlocks[idx];
        pendingBlocks[idx] = {
          ...existing,
          ...pendingTool,
          input: pendingTool.input ?? existing.input,
        };
      } else {
        pendingBlocks.push(pendingTool);
        toolIndexById.set(mAny.tool_call_id, pendingBlocks.length - 1);
      }
      continue;
    }

    if (type === "tool-output") {
      if (!mAny.tool_call_id) continue;
      const idx = toolIndexById.get(mAny.tool_call_id);
      if (idx != null && pendingBlocks[idx]?.type === "tool") {
        const existing = pendingBlocks[idx];
        pendingBlocks[idx] = { ...existing, liveOutput: `${existing.liveOutput || ""}${mAny.output || ""}` };
      }
      continue;
    }

    if (type === "tool-result") {
      if (!mAny.tool_call_id) {
        flushPending();
        pendingBlocks.push({ type: "tool", name: mAny.name, input: mAny.input, output: mAny.output, diff: typeof mAny.diff === "string" ? mAny.diff : undefined, run_id: mAny.run_id || undefined });
        continue;
      }
      const idx = toolIndexById.get(mAny.tool_call_id);
      if (idx != null && pendingBlocks[idx]?.type === "tool") {
        const existing = pendingBlocks[idx];
        pendingBlocks[idx] = { ...existing, output: mAny.output ?? existing.liveOutput ?? existing.output, input: mAny.input ?? existing.input, diff: typeof mAny.diff === "string" ? mAny.diff : existing.diff, liveOutput: undefined };
      } else {
        pendingBlocks.push({ type: "tool", name: mAny.name, input: mAny.input, output: mAny.output, diff: typeof mAny.diff === "string" ? mAny.diff : undefined, tool_call_id: mAny.tool_call_id || undefined, run_id: mAny.run_id || undefined });
      }
      continue;
    }

    if (type === "run-done") {
      // Run boundary — flush any orphaned tool blocks from cancelled/errored runs
      flushPending();
      continue;
    }

    if (type === "run-error" || type === "system") {
      flushPending();
      msgs.push({ role: "system", blocks: [{ type: "system", content: mAny.message || mAny.content || "", tone: type === "run-error" ? "error" : "info" }] });
      continue;
    }

    if (type === "compacted") {
      flushPending();
      msgs.push({ role: "system", blocks: [{ type: "system", content: mAny.output || mAny.message || mAny.content || "Conversation compacted", tone: "info" }] });
      continue;
    }

    if (type === "skill-result") {
      flushPending();
      msgs.push({ role: "system", blocks: [{ type: "system", content: mAny.output || "", tone: "info" }] });
      continue;
    }

    if (type === "user-message" || mAny.role === "user") {
      flushPending();
      msgs.push({
        role: "user",
        blocks: [{ type: "text", content: typeof mAny.content === "string" ? mAny.content : JSON.stringify(mAny.content) }],
        message_id: typeof mAny.message_id === "string" ? mAny.message_id : undefined,
        pending: false,
        attachments: Array.isArray(mAny.attachments) ? mAny.attachments : undefined,
        bashMode: !!mAny.bash_mode,
      });
      continue;
    }

    if (type === "assistant-message" || mAny.role === "assistant") {
      const content = typeof mAny.content === "string" ? mAny.content : JSON.stringify(mAny.content);
      const blocks: StreamBlock[] = [...pendingBlocks];
      if (content) blocks.push({ type: "text", content });
      if (blocks.length > 0) {
        const agentId = mAny.agent_id;
        const agentCfg = agentId ? agentList.find((a: AgentConfig) => a.id === agentId) : undefined;
        msgs.push({
          role: "assistant", blocks,
          agent_id: agentId,
          agent_name: agentCfg?.name,
          agent_color: agentCfg?.color,
        });
      }
      pendingBlocks = [];
      toolIndexById.clear();
      continue;
    }

    if (mAny.role === "tool") {
      pendingBlocks.push({ type: "tool", name: mAny.name, input: mAny.input, output: mAny.output, diff: typeof mAny.diff === "string" ? mAny.diff : undefined, tool_call_id: mAny.tool_call_id || undefined, run_id: mAny.run_id || undefined });
      if (mAny.tool_call_id) toolIndexById.set(mAny.tool_call_id, pendingBlocks.length - 1);
    }
  }

  flushPending();

  return {
    messages: msgs,
    meta: detail.context_limit > 0 ? {
      turns: 0,
      context_tokens: detail.context_tokens,
      context_limit: detail.context_limit,
    } : null,
    title: detail.title || "Untitled",
    autonomousToolsEnabled: !!detail.autonomous_tools_enabled,
  };
}
