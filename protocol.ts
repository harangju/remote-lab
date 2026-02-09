export type ChatEvent =
  | { type: "auth-ok" }
  | { type: "text-delta"; delta: string }
  | { type: "tool-use"; name: string; input: unknown }
  | { type: "tool-result"; name: string; output: string }
  | { type: "done"; cost: number; turns: number; session_id: string }
  | { type: "error"; message: string; recoverable: boolean }
