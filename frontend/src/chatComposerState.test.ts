import { expect, test } from "bun:test";
import type { AgentConfig, Skill } from "./api";
import { getMentionMatches, getSlashMatches } from "./chatComposerState";

const agents: AgentConfig[] = [
  { id: "worker", name: "Worker", color: "#4d9375", is_default: true },
  { id: "reviewer", name: "Reviewer", color: "#d9a754", is_default: false },
];

const skills: Skill[] = [
  { name: "docx", description: "Word documents" },
  { name: "pdf", description: "PDF tools" },
  { name: "pptx", description: "Slide decks" },
];

test("getMentionMatches returns matching agents before files", () => {
  const matches = getMentionMatches("wo", agents, ["docs/worker-notes.md", "src/main.tsx"]);
  expect(matches[0]).toEqual({ type: "agent", agent: agents[0] });
  expect(matches[1]).toEqual({ type: "file", path: "docs/worker-notes.md" });
});

test("getMentionMatches matches files by basename and substring", () => {
  const matches = getMentionMatches("main", agents, ["src/main.tsx", "docs/guide.md"]);
  expect(matches).toEqual([{ type: "file", path: "src/main.tsx" }]);
});

test("getMentionMatches returns empty for null query", () => {
  expect(getMentionMatches(null, agents, ["src/main.tsx"])).toEqual([]);
});

test("getSlashMatches filters skills by prefix", () => {
  expect(getSlashMatches("pd", skills).map((s) => s.name)).toEqual(["pdf"]);
});

test("getSlashMatches returns empty for null query", () => {
  expect(getSlashMatches(null, skills)).toEqual([]);
});
