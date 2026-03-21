import React, { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Terminal, FileText, Pencil, Search, Settings, ChevronDown, ChevronUp, Minimize2, Globe, ExternalLink } from "lucide-react";

import { CodeBlock } from "./components/CodeBlock";
import { btnPrimary, btnSubtle, colors, radius } from "./styles";
import type { ApprovalScope, StreamBlock } from "./chatState";

interface ToolCall {
  name: string;
  input?: string;
  output?: string;
  diff?: string;
  liveOutput?: string;
}

const toolIcons: Record<string, React.FC<{ size?: number }>> = {
  bash: Terminal, read_file: FileText, write_file: Pencil,
  edit_file: Pencil, glob: Search, grep: Search, compact: Minimize2,
  web_search: Globe,
};

const toolChipShell: React.CSSProperties = {
  background: colors.bgSurface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  color: colors.textMuted,
  fontSize: "0.78rem",
  overflow: "hidden",
};

function parseToolInput(input?: string): Record<string, any> | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") return parsed as Record<string, any>;
  } catch {}
  return null;
}

function toolSummary(name: string, input?: string): string | null {
  if (!input) return null;
  const parsed = parseToolInput(input);
  if (["read_file", "write_file", "edit_file"].includes(name)) {
    const path = typeof parsed?.path === "string" ? parsed.path : undefined;
    const pathMatch = input.match(/['"]?path['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
    return path || (pathMatch ? pathMatch[1] : input.slice(0, 60));
  }
  if (name === "bash") {
    const command = typeof parsed?.command === "string" ? parsed.command : input;
    return command.length > 60 ? command.slice(0, 57) + "..." : command;
  }
  if (name === "glob" || name === "grep") {
    const pattern = typeof parsed?.pattern === "string" ? parsed.pattern : undefined;
    const patMatch = input.match(/['"]?pattern['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
    return pattern || (patMatch ? patMatch[1] : input.slice(0, 60));
  }
  return input.length > 60 ? input.slice(0, 57) + "..." : input;
}

export function extractFilePath(name: string, input?: string): string | null {
  if (!input || !["read_file", "write_file", "edit_file"].includes(name)) return null;
  const parsed = parseToolInput(input);
  if (typeof parsed?.path === "string") return parsed.path;
  const pathMatch = input.match(/['"]?path['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
  return pathMatch ? pathMatch[1] : input.trim();
}

function extractShareUrl(name: string, input?: string): string | null {
  if (name !== "share" || !input) return null;
  const mdMatch = input.match(/\((https?:\/\/[^)\s]+)\)/);
  if (mdMatch) return mdMatch[1];
  const plainMatch = input.match(/https?:\/\/\S+/);
  return plainMatch ? plainMatch[0] : null;
}

type DiffToken = { text: string; kind: "equal" | "add" | "remove" };
type DiffLine = {
  type: "add" | "remove" | "context";
  lineNumber: number | null;
  tokens: DiffToken[];
};

type EditDiffPreview = {
  summary: string | null;
  lines: DiffLine[];
  truncated: boolean;
};

function buildEditDiffPreview(diff?: string): EditDiffPreview | null {
  if (!diff) return null;
  const lines = diff.split("\n");
  const previewLines: DiffLine[] = [];
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let additions = 0;
  let deletions = 0;
  let truncated = false;
  const maxRenderedRows = 40;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNumber = Number(match[1]);
        newLineNumber = Number(match[2]);
      }
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) {
      additions += 1;
      if (previewLines.length < maxRenderedRows) previewLines.push({ type: "add", lineNumber: newLineNumber || null, tokens: [{ text: line.slice(1), kind: "add" }] });
      else truncated = true;
      newLineNumber += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
      if (previewLines.length < maxRenderedRows) previewLines.push({ type: "remove", lineNumber: oldLineNumber || null, tokens: [{ text: line.slice(1), kind: "remove" }] });
      else truncated = true;
      oldLineNumber += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      if (previewLines.length < maxRenderedRows) previewLines.push({ type: "context", lineNumber: oldLineNumber || null, tokens: [{ text: line.slice(1), kind: "equal" }] });
      else truncated = true;
      oldLineNumber += 1;
      newLineNumber += 1;
    }
  }

  if (previewLines.length === 0) return null;
  const summaryBits: string[] = [];
  if (additions > 0) summaryBits.push(`+${additions}`);
  if (deletions > 0) summaryBits.push(`-${deletions}`);
  return { summary: summaryBits.length > 0 ? summaryBits.join(" ") : "edited", lines: previewLines, truncated };
}

export function ToolChip({ tool, live, defaultOpen = false, onOpenFile, onRespond, autonomousToolsEnabled }: {
  tool: ToolCall & { tool_call_id?: string; awaitingApproval?: boolean; approvalStatus?: "pending" | "approved" | "denied"; canAllowProject?: boolean; canTurnOnAuto?: boolean; approvedScope?: ApprovalScope };
  live?: boolean;
  defaultOpen?: boolean;
  onOpenFile?: (path: string) => void;
  onRespond?: (toolCallId: string, approved: boolean, scope?: ApprovalScope) => void;
  autonomousToolsEnabled?: boolean;
}) {
  const [manualOpen, setManualOpen] = useState(defaultOpen);
  const preRef = useRef<HTMLPreElement>(null);
  const Icon = toolIcons[tool.name] || Settings;
  const editDiff = tool.name === "edit_file" ? buildEditDiffPreview(tool.diff) : null;
  const hasDiffPreview = !!editDiff && editDiff.lines.length > 0;
  const hasDetail = !!(tool.input || tool.output || hasDiffPreview);
  const summary = editDiff?.summary ? `${toolSummary(tool.name, tool.input) || tool.name} (${editDiff.summary})` : toolSummary(tool.name, tool.input);
  const filePath = extractFilePath(tool.name, tool.input);
  const shareUrl = extractShareUrl(tool.name, tool.input) || extractShareUrl(tool.name, tool.output);
  const isFileOp = !!filePath;
  const isShareLink = !!shareUrl;
  const approvalPending = !!tool.awaitingApproval && tool.approvalStatus !== "approved" && tool.approvalStatus !== "denied";
  const approvalDenied = tool.approvalStatus === "denied";
  const approvalApproved = tool.approvalStatus === "approved";
  const autoTurnedOn = autonomousToolsEnabled || tool.approvedScope === "auto";
  const showStatusSlot = live || !!tool.output || approvalPending || approvalDenied || approvalApproved || (isFileOp && !!onOpenFile) || isShareLink;
  const isStreaming = !!(live && tool.liveOutput);
  const open = isStreaming || (tool.name === "edit_file" ? true : manualOpen);
  const displayContent = isStreaming ? tool.liveOutput : (tool.output || "");

  useEffect(() => {
    if (isStreaming && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [isStreaming, tool.liveOutput]);

  const handleOpenFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (filePath && onOpenFile) onOpenFile(filePath);
  };

  const handleOpenShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (shareUrl) window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ fontSize: "0.78rem", color: colors.textMuted, flexShrink: 0, maxWidth: "100%" }}>
      <button
        onClick={() => tool.name !== "edit_file" && hasDetail && setManualOpen(!manualOpen)}
        style={{ ...toolChipShell, padding: tool.name === "edit_file" && hasDiffPreview ? "0" : "4px 8px", cursor: tool.name !== "edit_file" && hasDetail ? "pointer" : "default", display: "inline-flex", alignItems: tool.name === "edit_file" && hasDiffPreview ? "stretch" : "center", gap: tool.name === "edit_file" && hasDiffPreview ? "0" : "6px", flexWrap: "nowrap", maxWidth: "100%", minWidth: 0, textAlign: "left", minHeight: tool.name === "edit_file" && hasDiffPreview ? undefined : "28px", width: tool.name === "edit_file" && hasDiffPreview ? "100%" : undefined }}
      >
        {tool.name === "edit_file" && hasDiffPreview && editDiff ? (
          <div style={{ width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 8px", borderBottom: `1px solid ${colors.border}`, minWidth: 0 }}>
              <span style={{ width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={13} /></span>
              <span style={{ fontFamily: "monospace", flexShrink: 0 }}>{tool.name}</span>
              {summary && <span style={{ fontFamily: "monospace", opacity: 0.7, flex: "1 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>}
              <span style={{ width: 12, height: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {tool.output ? <span style={{ opacity: 0.5, lineHeight: 1 }}>&#10003;</span> : isFileOp && onOpenFile ? <span onClick={handleOpenFile} style={{ display: "inline-flex", alignItems: "center", opacity: 0.5 }} data-tooltip="Open in panel"><ExternalLink size={12} /></span> : null}
              </span>
            </div>
            <div style={{ maxHeight: "220px", overflowY: "auto", fontFamily: "monospace", fontSize: "0.75rem" }}>
              {editDiff.lines.map((line, idx) => {
                const rowBg = line.type === "add" ? colors.successSoft : line.type === "remove" ? colors.dangerSoft : "transparent";
                const tokenBg = line.type === "add" ? `color-mix(in srgb, ${colors.success} 28%, transparent)` : line.type === "remove" ? `color-mix(in srgb, ${colors.danger} 28%, transparent)` : "transparent";
                const sigil = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
                const sigilColor = line.type === "add" ? colors.success : line.type === "remove" ? colors.danger : "transparent";
                return (
                  <div key={`${line.type}-${line.lineNumber}-${idx}`} style={{ display: "grid", gridTemplateColumns: "34px 12px minmax(0, 1fr)", alignItems: "start", columnGap: "6px", padding: "1px 8px", background: rowBg, color: colors.text }}>
                    <span style={{ color: colors.textMuted, textAlign: "right", userSelect: "none" }}>{line.lineNumber ?? ""}</span>
                    <span style={{ color: sigilColor, userSelect: "none" }}>{sigil}</span>
                    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                      {line.tokens.map((token, tokenIdx) => <span key={tokenIdx} style={token.kind === "equal" ? undefined : { background: tokenBg, borderRadius: "3px" }}>{token.text}</span>)}
                    </span>
                  </div>
                );
              })}
              {editDiff.truncated && <div style={{ padding: "4px 8px", color: colors.textMuted, fontSize: "0.72rem" }}>… diff truncated</div>}
            </div>
          </div>
        ) : (
          <>
            <span style={{ width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={13} /></span>
            <span style={{ fontFamily: "monospace", flexShrink: 0 }}>{tool.name}</span>
            {summary && <span style={{ fontFamily: "monospace", opacity: 0.7, flex: "1 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>}
            <span style={{ width: 12, height: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {live ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: colors.warning, display: "inline-block", animation: "pulse 1.5s infinite" }} /> : tool.output ? <span style={{ opacity: 0.5, lineHeight: 1 }}>&#10003;</span> : approvalPending ? <span style={{ opacity: 0.7, lineHeight: 1, color: colors.accent }} title="Waiting for approval">!</span> : approvalDenied ? <span style={{ opacity: 0.7, lineHeight: 1, color: colors.danger }} title="Denied">×</span> : approvalApproved ? <span style={{ opacity: 0.5, lineHeight: 1 }}>&#10003;</span> : isShareLink ? <span onClick={handleOpenShare} style={{ display: "inline-flex", alignItems: "center", opacity: 0.5 }} data-tooltip="Open published page"><ExternalLink size={12} /></span> : isFileOp && onOpenFile ? <span onClick={handleOpenFile} style={{ display: "inline-flex", alignItems: "center", opacity: 0.5 }} data-tooltip="Open in panel"><ExternalLink size={12} /></span> : showStatusSlot ? null : null}
            </span>
            <span style={{ width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: hasDetail ? 0.5 : 0 }}>
              {hasDetail && (open ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
            </span>
          </>
        )}
      </button>
      {approvalPending && tool.tool_call_id && onRespond && (
        <div style={{ ...toolChipShell, padding: "6px 10px", marginTop: "4px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => onRespond(tool.tool_call_id!, true, "once")} style={{ ...btnPrimary, fontSize: "0.75rem", padding: "4px 8px", borderRadius: radius.md }}>Allow once</button>
          {tool.canTurnOnAuto && (!autoTurnedOn ? <button onClick={() => onRespond(tool.tool_call_id!, true, "auto")} style={{ ...btnSubtle, padding: "4px 8px" }}>Turn on auto</button> : <span style={{ fontSize: "0.75rem", color: colors.accent, padding: "4px 2px" }}>Auto mode on</span>)}
          {tool.canAllowProject && <button onClick={() => onRespond(tool.tool_call_id!, true, "project")} style={{ ...btnSubtle, padding: "4px 8px" }}>Allow in project</button>}
          <button onClick={() => onRespond(tool.tool_call_id!, false, "once")} style={{ ...btnSubtle, padding: "4px 8px" }}>Deny</button>
        </div>
      )}
      {tool.name !== "edit_file" && open && (hasDetail || isStreaming) && (
        <div style={{ ...toolChipShell, marginTop: "4px", maxWidth: "100%" }}>
          {(isStreaming || (tool.input || tool.output)) && <pre ref={preRef} style={{ margin: 0, padding: "6px 10px", fontSize: "0.75rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word", maxWidth: "100%", maxHeight: isStreaming ? "5lh" : "200px", overflowX: "hidden", overflowY: "auto", color: colors.text }}>{isStreaming ? displayContent : (tool.input ? tool.input + (tool.output ? "\n---\n" : "") : "") + (tool.output || "")}</pre>}
        </div>
      )}
    </div>
  );
}

function makeMdComponents(onOpenSnippet?: (code: string, language: string) => void): Record<string, React.FC<any>> {
  return {
    pre: ({ children }: any) => {
      const codeChild = React.Children.toArray(children).find((child: any) => child?.props?.className?.startsWith("language-")) as any;
      if (codeChild) {
        const lang = codeChild.props.className.replace("language-", "");
        const code = String(codeChild.props.children).replace(/\n$/, "");
        return <CodeBlock code={code} language={lang} onOpen={onOpenSnippet ? (c, l) => onOpenSnippet(c, l) : undefined} />;
      }
      const text = extractTextContent(children);
      if (text) return <CodeBlock code={text} language="text" onOpen={onOpenSnippet ? (c, l) => onOpenSnippet(c, l) : undefined} />;
      return <pre style={{ background: colors.codeBg, borderRadius: radius.md, padding: "10px 12px", overflowX: "auto", fontSize: "0.82rem", margin: "6px 0" }}>{children}</pre>;
    },
    code: ({ children, className }: any) => {
      if (className?.startsWith("language-")) return <code className={className}>{children}</code>;
      return <code style={{ background: colors.codeBg, borderRadius: "3px", padding: "1px 4px", fontSize: "0.85em", fontFamily: "monospace" }}>{children}</code>;
    },
    a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: colors.accent }}>{children}</a>,
    table: ({ children }: any) => <div style={{ overflowX: "auto", margin: "6px 0" }}><table style={{ borderCollapse: "collapse", width: "100%", minWidth: "max-content", fontSize: "0.85rem" }}>{children}</table></div>,
    th: ({ children }: any) => <th style={{ border: `1px solid ${colors.border}`, padding: "4px 8px", textAlign: "left", background: colors.bg }}>{children}</th>,
    td: ({ children }: any) => <td style={{ border: `1px solid ${colors.border}`, padding: "4px 8px" }}>{children}</td>,
  };
}

function extractTextContent(children: any): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractTextContent).join("");
  if (children?.props?.children) return extractTextContent(children.props.children);
  return "";
}

export function compactSkillDescription(description: string, maxLength = 72): string {
  const singleLine = description.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 1).trimEnd()}…`;
}

export function MdContent({ text, onOpenSnippet }: { text: string; onOpenSnippet?: (code: string, language: string) => void }) {
  const components = useMemo(() => makeMdComponents(onOpenSnippet), [onOpenSnippet]);
  return <div style={{ lineHeight: 1.55 }} className="md-content"><Markdown remarkPlugins={[remarkGfm]} components={components}>{text}</Markdown></div>;
}
