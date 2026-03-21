import type { AgentConfig, Skill } from "./api";
import type { MentionMatch } from "./chatComposer";

export function getMentionMatches(mentionQuery: string | null, agents: AgentConfig[], projectFiles: string[]): MentionMatch[] {
  if (mentionQuery === null) return [];
  const q = mentionQuery.toLowerCase();
  const results: MentionMatch[] = [];
  for (const a of agents) {
    if (a.id.toLowerCase().startsWith(q) || a.name.toLowerCase().startsWith(q)) {
      results.push({ type: "agent", agent: a });
    }
  }
  if (projectFiles.length > 0) {
    const fileMatches: string[] = [];
    for (const f of projectFiles) {
      const lower = f.toLowerCase();
      const basename = lower.split("/").pop() || lower;
      if (lower.startsWith(q) || basename.startsWith(q) || lower.includes(q)) {
        fileMatches.push(f);
      }
      if (fileMatches.length >= 10) break;
    }
    for (const f of fileMatches) {
      results.push({ type: "file", path: f });
    }
  }
  if (q === "" && results.length > 20) return results.slice(0, 20);
  return results;
}

export function getSlashMatches(slashQuery: string | null, skills: Skill[]): Skill[] {
  if (slashQuery === null) return [];
  const q = slashQuery.toLowerCase();
  return skills.filter((s) => s.name.toLowerCase().startsWith(q));
}
