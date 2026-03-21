import { expect, test } from "bun:test";
import type { StreamBlock } from "./chatState";
import { buildLiveMessageRows } from "./chatMessagesState";

const blocks: StreamBlock[] = [{ type: "text", content: "hello" }];
const agent = { id: "worker", name: "Worker", color: "#4d9375" };

test("buildLiveMessageRows returns reconnect preview when disconnected", () => {
  const rows = buildLiveMessageRows(false, blocks, agent);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ role: "assistant", agent_name: "Worker" });
  expect(rows[0].live).toBeUndefined();
});

test("buildLiveMessageRows returns live row when connected", () => {
  const rows = buildLiveMessageRows(true, blocks, agent);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ role: "assistant", agent_name: "Worker", live: true });
});

test("buildLiveMessageRows returns no rows when there are no blocks", () => {
  expect(buildLiveMessageRows(true, [], agent)).toEqual([]);
  expect(buildLiveMessageRows(false, [], agent)).toEqual([]);
});
