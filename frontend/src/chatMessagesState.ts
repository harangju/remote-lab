import type { StreamBlock } from "./chatState";

export interface LiveMessageRow {
  role: "assistant";
  blocks: StreamBlock[];
  agent_id?: string;
  agent_name?: string;
  agent_color?: string;
  live?: boolean;
}

export function buildLiveMessageRows(
  connected: boolean,
  streamBlocks: StreamBlock[],
  activeAgent: { id: string; name: string; color?: string } | null,
): LiveMessageRow[] {
  const reconnectPreview = !connected && streamBlocks.length > 0 ? [{
    role: "assistant" as const,
    blocks: streamBlocks,
    agent_id: activeAgent?.id,
    agent_name: activeAgent?.name,
    agent_color: activeAgent?.color,
  }] : [];

  const liveRows = connected && streamBlocks.length > 0 ? [{
    role: "assistant" as const,
    blocks: streamBlocks,
    agent_id: activeAgent?.id,
    agent_name: activeAgent?.name,
    agent_color: activeAgent?.color,
    live: true,
  }] : [];

  return [...reconnectPreview, ...liveRows];
}
