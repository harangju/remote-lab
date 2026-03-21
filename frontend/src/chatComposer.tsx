import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Terminal, FileText, Square, Paperclip, X, Mic, ArrowUp } from "lucide-react";
import { input as inputStyle, btnPrimary } from "./styles";
import { compactSkillDescription } from "./chatUi";
import type { AgentConfig, Skill } from "./api";
import { getMentionMatches, getSlashMatches } from "./chatComposerState";

export interface ComposerAttachment {
  file: File;
  previewUrl?: string;
}

export type MentionMatch =
  | { type: "agent"; agent: AgentConfig }
  | { type: "file"; path: string };

interface ChatComposerProps {
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  connected: boolean;
  uploadingAttachments: boolean;
  composerAttachments: ComposerAttachment[];
  addComposerFiles: (files: FileList | File[]) => void;
  removeComposerAttachment: (idx: number) => void;
  sendText: (text: string) => Promise<boolean>;
  voiceUiActive: boolean;
  voiceStatusText: string;
  voiceElapsedSec: number;
  stopVoiceCapture: () => void;
  startVoiceCapture: () => void | Promise<void>;
  stop: () => void;
  agents: AgentConfig[];
  projectFiles: string[];
  skills: Skill[];
  refreshMentionFiles: () => void | Promise<void>;
}

export function ChatComposer({
  input,
  setInput,
  busy,
  connected,
  uploadingAttachments,
  composerAttachments,
  addComposerFiles,
  removeComposerAttachment,
  sendText,
  voiceUiActive,
  voiceStatusText,
  voiceElapsedSec,
  stopVoiceCapture,
  startVoiceCapture,
  stop,
  agents,
  projectFiles,
  skills,
  refreshMentionFiles,
}: ChatComposerProps) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const mentionMatches = useMemo((): MentionMatch[] => getMentionMatches(mentionQuery, agents, projectFiles), [mentionQuery, agents, projectFiles]);

  const slashMatches = useMemo((): Skill[] => getSlashMatches(slashQuery, skills), [slashQuery, skills]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const pos = e.target.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const atMatch = before.match(/@([\w./\-]*)$/);
    if (atMatch) {
      if (mentionQuery === null) void refreshMentionFiles();
      setMentionQuery(atMatch[1]);
      setMentionIdx(0);
    } else {
      setMentionQuery(null);
    }
    const slashMatch = before.match(/(?:^|\s)\/(\w*)$/);
    if (slashMatch) {
      setSlashQuery(slashMatch[1]);
      setSlashIdx(0);
    } else {
      setSlashQuery(null);
    }
  };

  const insertMention = (match: MentionMatch) => {
    const pos = inputRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, pos);
    const after = input.slice(pos);
    const atIdx = before.lastIndexOf("@");
    const label = match.type === "agent" ? match.agent.id : match.path;
    const newVal = before.slice(0, atIdx) + `@${label} ` + after;
    setInput(newVal);
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const insertSlashCommand = (skill: Skill) => {
    const pos = inputRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, pos);
    const after = input.slice(pos);
    const slashMatch = before.match(/(?:^|\s)\/(\w*)$/);
    if (!slashMatch) return;
    const slashToken = slashMatch[0];
    const prefix = before.slice(0, before.length - slashToken.length);
    const spacer = slashToken.startsWith(" ") ? " " : "";
    const newVal = `${prefix}${spacer}/${skill.name} ${after}`;
    setInput(newVal);
    setSlashQuery(null);
    requestAnimationFrame(() => {
      const cursor = prefix.length + spacer.length + skill.name.length + 2;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && slashQuery === null && mentionQuery === null) {
      e.preventDefault();
      const text = input.trim();
      if (text || composerAttachments.length > 0) {
        setMentionQuery(null);
        setSlashQuery(null);
        sendText(text).then((ok) => { if (ok) setInput(""); });
      }
      return;
    }
    if (slashQuery !== null && slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, slashMatches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        insertSlashCommand(slashMatches[slashIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashQuery(null);
        return;
      }
    }
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => Math.min(i + 1, mentionMatches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        insertMention(mentionMatches[mentionIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setMentionQuery(null);
    setSlashQuery(null);
    const text = input.trim();
    sendText(text).then((ok) => { if (ok) setInput(""); });
  };

  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
  const isBashMode = input.startsWith("!");
  const inputPlaceholder = busy || uploadingAttachments
    ? uploadingAttachments ? "Uploading attachments..." : "Waiting for response..."
    : isMobile
      ? "Message..."
      : "Type a message... (@ for agents/files, / for commands)";

  const formatVoiceElapsed = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  return (
    <div style={{ flexShrink: 0, padding: "0 1.5rem 12px" }}>
      <div style={{ position: "relative", maxWidth: "64rem", width: "100%", margin: "0 auto" }}>
        {slashQuery !== null && slashMatches.length > 0 && (
          <div style={{ position: "absolute", bottom: "100%", left: 14, marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "4px 0", minWidth: 240, maxHeight: 300, overflowY: "auto", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", zIndex: 100 }}>
            {slashMatches.map((s, i) => (
              <div key={s.name} onMouseDown={(e) => { e.preventDefault(); insertSlashCommand(s); }} style={{ padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem", background: i === slashIdx ? "var(--bg-user)" : "transparent" }}>
                <span style={{ fontWeight: 600, fontFamily: "monospace" }}>/{s.name}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "1 1 auto" }}>{compactSkillDescription(s.description)}</span>
              </div>
            ))}
          </div>
        )}
        {mentionQuery !== null && mentionMatches.length > 0 && (() => {
          const agentMatches = mentionMatches.filter((m): m is MentionMatch & { type: "agent" } => m.type === "agent");
          const fileMatches = mentionMatches.filter((m): m is MentionMatch & { type: "file" } => m.type === "file");
          let idx = 0;
          return (
            <div style={{ position: "absolute", bottom: "100%", left: 14, marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "4px 0", minWidth: 220, maxHeight: 300, overflowY: "auto", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", zIndex: 100 }}>
              {agentMatches.length > 0 && fileMatches.length > 0 && <div style={{ padding: "4px 12px 2px", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Agents</div>}
              {agentMatches.map((m) => {
                const i = idx++;
                return <div key={`a-${m.agent.id}`} onMouseDown={(e) => { e.preventDefault(); insertMention(m); }} style={{ padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", background: i === mentionIdx ? "var(--bg-user)" : "transparent" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: m.agent.color || "var(--text-muted)", flexShrink: 0 }} /><span style={{ fontWeight: 600 }}>@{m.agent.id}</span><span style={{ color: "var(--text-muted)" }}>{m.agent.name}</span></div>;
              })}
              {fileMatches.length > 0 && agentMatches.length > 0 && <div style={{ padding: "4px 12px 2px", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", borderTop: "1px solid var(--border)", marginTop: 2 }}>Files</div>}
              {fileMatches.length > 0 && agentMatches.length === 0 && mentionQuery !== "" && <div style={{ padding: "4px 12px 2px", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Files</div>}
              {fileMatches.map((m) => {
                const i = idx++;
                const parts = m.path.split("/");
                const filename = parts.pop() || m.path;
                const dir = parts.join("/");
                return <div key={`f-${m.path}`} onMouseDown={(e) => { e.preventDefault(); insertMention(m); }} style={{ padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.85rem", background: i === mentionIdx ? "var(--bg-user)" : "transparent" }}><FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} /><span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{dir && <span style={{ color: "var(--text-muted)" }}>{dir}/</span>}{filename}</span></div>;
              })}
            </div>
          );
        })()}
        <form onSubmit={send} onDrop={(e) => { e.preventDefault(); setDragDepth(0); setDragActive(false); if (e.dataTransfer.files?.length) addComposerFiles(e.dataTransfer.files); }} onDragOver={(e) => { e.preventDefault(); setDragActive(true); }} onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; if (dragDepth === 0) setDragActive(false); }} style={{ display: "flex", gap: "8px", padding: "10px 14px", background: dragActive ? "color-mix(in srgb, var(--bg-surface) 82%, var(--accent) 18%)" : (isBashMode ? "var(--bg-bash-composer)" : "var(--bg-surface)"), border: `1px solid ${dragActive ? "var(--accent)" : (isBashMode ? "var(--border-bash-composer)" : "var(--border)")}`, borderRadius: "12px", flexDirection: "column", boxShadow: dragActive ? "0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)" : "none", transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease", position: "relative" }}>
          {voiceUiActive && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "8px 10px", borderRadius: "10px", border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--border))", background: "color-mix(in srgb, var(--accent) 14%, var(--bg))" }}><div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: "pulse 1.2s infinite", flexShrink: 0 }} /><span style={{ fontSize: "0.85rem", fontWeight: 500, minWidth: 0 }}>{voiceStatusText}</span><span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "monospace" }}>{formatVoiceElapsed(voiceElapsedSec)}</span></div><button type="button" onClick={stopVoiceCapture} style={{ background: "color-mix(in srgb, var(--bg) 76%, var(--accent) 24%)", color: "var(--text)", border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))", borderRadius: "999px", padding: "5px 10px", fontSize: "0.78rem", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" }}><Square size={12} fill="currentColor" /> Stop voice</button></div>}
          {dragActive && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", minHeight: "44px", border: "1px dashed var(--accent)", borderRadius: "10px", background: "color-mix(in srgb, var(--accent) 8%, transparent)", color: "var(--accent)", fontSize: "0.85rem", fontWeight: 500 }}><Paperclip size={16} /> Drop files here</div>}
          {composerAttachments.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>{composerAttachments.map((attachment, idx) => <div key={`${attachment.file.name}-${idx}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", background: "var(--bg)", borderRadius: 8, padding: attachment.previewUrl ? 4 : "6px 8px" }}>{attachment.previewUrl ? <img src={attachment.previewUrl} alt={attachment.file.name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} /> : <FileText size={14} />}<span style={{ fontSize: "0.78rem", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.file.name}</span><button type="button" onClick={() => removeComposerAttachment(idx)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "inline-flex", padding: 0 }}><X size={14} /></button></div>)}</div>}
          <div style={{ display: "flex", gap: "8px" }}>
            {isBashMode ? <span data-tooltip="Bash mode" style={{ color: "var(--border-bash-composer)", display: "inline-flex", alignItems: "center", padding: "4px 2px", flexShrink: 0 }}><Terminal size={16} /></span> : <button type="button" onClick={() => fileInputRef.current?.click()} style={{ background: "none", border: "none", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", cursor: "pointer", padding: "4px 2px", flexShrink: 0 }} data-tooltip="Attach files"><Paperclip size={16} /></button>}
            <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) addComposerFiles(e.target.files); e.currentTarget.value = ""; }} />
            <textarea ref={inputRef} rows={1} readOnly={voiceUiActive} style={{ ...inputStyle, background: "transparent", border: "none", resize: "none", overflowY: "auto", lineHeight: "1.5", minHeight: "24px", maxHeight: "200px" }} placeholder={inputPlaceholder} value={input} onChange={handleInputChange} onKeyDown={handleInputKeyDown} onPaste={(e) => { const files = Array.from(e.clipboardData.files || []); if (files.length > 0) addComposerFiles(files); }} autoFocus />
            {!busy && !voiceUiActive && <button type="button" onClick={() => { void startVoiceCapture(); }} style={{ background: "color-mix(in srgb, var(--accent) 12%, var(--bg))", color: "var(--text)", border: "1px solid color-mix(in srgb, var(--accent) 32%, var(--border))", borderRadius: "999px", width: "34px", height: "34px", minWidth: "34px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }} data-tooltip="Start voice input"><Mic size={15} /></button>}
            {busy ? <button type="button" onClick={stop} style={{ ...btnPrimary, width: "34px", height: "34px", minWidth: "34px", borderRadius: "999px", background: "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, cursor: "pointer", flexShrink: 0 }} data-tooltip="Stop"><Square size={14} fill="currentColor" /></button> : <button type="submit" style={{ ...btnPrimary, width: "34px", height: "34px", minWidth: "34px", borderRadius: "999px", opacity: !connected || (!input.trim() && composerAttachments.length === 0) || uploadingAttachments ? 0.5 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }} disabled={!connected || (!input.trim() && composerAttachments.length === 0) || uploadingAttachments} data-tooltip="Send"><ArrowUp size={16} /></button>}
          </div>
        </form>
      </div>
    </div>
  );
}
