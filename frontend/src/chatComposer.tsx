import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Terminal, FileText, Square, Paperclip, X, Mic, ArrowUp } from "lucide-react";
import { btnPrimary, colors, controlSize, input as inputStyle, overlayPanel, overlayHeader, radius, shadow } from "./styles";
import { compactSkillDescription } from "./chatUi";
import type { AgentConfig, Skill } from "./api";
import { bashComplete } from "./api";
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
  focusKey?: string | number;
  projectId?: string;
}

const pickerPanelStyle: React.CSSProperties = {
  ...overlayPanel,
  position: "absolute",
  bottom: "100%",
  left: 14,
  marginBottom: 4,
  padding: "4px 0",
  boxShadow: shadow.overlay,
  zIndex: 100,
};

const pickerSectionLabel: React.CSSProperties = {
  padding: "4px 12px 2px",
  fontSize: "0.7rem",
  color: colors.textMuted,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const pickerRow = (selected: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: "0.85rem",
  background: selected ? "var(--bg-user)" : "transparent",
});

const roundActionButton: React.CSSProperties = {
  width: controlSize.icon,
  height: controlSize.icon,
  minWidth: controlSize.icon,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  flexShrink: 0,
  borderRadius: radius.pill,
};

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
  focusKey,
  projectId,
}: ChatComposerProps) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const [bashCompletions, setBashCompletions] = useState<string[]>([]);
  const [bashCompFrom, setBashCompFrom] = useState(0);
  const [bashCompPrefix, setBashCompPrefix] = useState("");
  const [bashCompIdx, setBashCompIdx] = useState(0);
  const bashCompTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bashListRef = useRef<HTMLDivElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);

  const fetchBashCompletions = useCallback((text: string, cursorPos: number) => {
    if (bashCompTimer.current) clearTimeout(bashCompTimer.current);
    if (!projectId || !text.startsWith("!")) {
      setBashCompletions([]);
      return;
    }
    // Strip the leading "!" for the completion query
    const bashInput = text.slice(1);
    const bashPos = cursorPos - 1;
    if (bashPos < 0) { setBashCompletions([]); return; }
    bashCompTimer.current = setTimeout(async () => {
      try {
        const res = await bashComplete(projectId, bashInput, bashPos);
        if (res.completions.length > 0) {
          setBashCompletions(res.completions);
          setBashCompFrom(res.from + 1); // +1 to account for leading "!"
          setBashCompPrefix(res.prefix);
          setBashCompIdx(0);
        } else {
          setBashCompletions([]);
        }
      } catch {
        setBashCompletions([]);
      }
    }, 150);
  }, [projectId]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    if (focusKey === undefined || focusKey === null || busy || voiceUiActive) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [busy, focusKey, voiceUiActive]);

  const mentionMatches = useMemo((): MentionMatch[] => getMentionMatches(mentionQuery, agents, projectFiles), [mentionQuery, agents, projectFiles]);
  const slashMatches = useMemo((): Skill[] => getSlashMatches(slashQuery, skills), [slashQuery, skills]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const pos = e.target.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    // Bash completions in bash mode
    if (val.startsWith("!")) {
      fetchBashCompletions(val, pos);
    } else {
      setBashCompletions([]);
    }
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

  const insertBashCompletion = (completion: string) => {
    const after = input.slice((inputRef.current?.selectionStart ?? input.length));
    const newVal = input.slice(0, bashCompFrom) + completion + (completion.endsWith("/") ? "" : " ") + after;
    setInput(newVal);
    setBashCompletions([]);
    requestAnimationFrame(() => {
      const cursor = bashCompFrom + completion.length + (completion.endsWith("/") ? 0 : 1);
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor, cursor);
      // If completed to a directory, trigger new completions
      if (completion.endsWith("/")) {
        fetchBashCompletions(newVal, cursor);
      }
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    const isNextPickerItem = e.key === "ArrowDown" || (ctrlOrCmd && e.key.toLowerCase() === "n");
    const isPrevPickerItem = e.key === "ArrowUp" || (ctrlOrCmd && e.key.toLowerCase() === "p");

    // Bash completions
    if (bashCompletions.length > 0) {
      if (isNextPickerItem) {
        e.preventDefault();
        setBashCompIdx((i) => Math.min(i + 1, bashCompletions.length - 1));
        return;
      }
      if (isPrevPickerItem) {
        e.preventDefault();
        setBashCompIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        insertBashCompletion(bashCompletions[bashCompIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setBashCompletions([]);
        return;
      }
    } else if (e.key === "Tab" && input.startsWith("!") && input.length > 1) {
      // Tab with no completions showing — trigger fetch immediately
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? input.length;
      fetchBashCompletions(input, pos);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = input.trim();
      if (text || composerAttachments.length > 0) {
        setMentionQuery(null);
        setSlashQuery(null);
        setBashCompletions([]);
        sendText(text).then((ok) => { if (ok) setInput(""); });
      }
      return;
    }
    if (slashQuery !== null && slashMatches.length > 0) {
      if (isNextPickerItem) {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, slashMatches.length - 1));
        return;
      }
      if (isPrevPickerItem) {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab") {
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
      if (isNextPickerItem) {
        e.preventDefault();
        setMentionIdx((i) => Math.min(i + 1, mentionMatches.length - 1));
        return;
      }
      if (isPrevPickerItem) {
        e.preventDefault();
        setMentionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab") {
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
    setBashCompletions([]);
    const text = input.trim();
    sendText(text).then((ok) => { if (ok) setInput(""); });
  };

  useEffect(() => {
    const rows = slashListRef.current?.querySelectorAll<HTMLElement>("[data-selectable-row='true']");
    rows?.[slashIdx]?.scrollIntoView({ block: "nearest" });
  }, [slashIdx, slashMatches.length]);

  useEffect(() => {
    const rows = mentionListRef.current?.querySelectorAll<HTMLElement>("[data-selectable-row='true']");
    rows?.[mentionIdx]?.scrollIntoView({ block: "nearest" });
  }, [mentionIdx, mentionMatches.length]);

  useEffect(() => {
    const rows = bashListRef.current?.querySelectorAll<HTMLElement>("[data-selectable-row='true']");
    rows?.[bashCompIdx]?.scrollIntoView({ block: "nearest" });
  }, [bashCompIdx, bashCompletions.length]);

  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
  const isBashMode = input.startsWith("!");
  const inputPlaceholder = busy || uploadingAttachments
    ? uploadingAttachments ? "Uploading attachments..." : "Waiting for response..."
    : isMobile ? "Message..." : "Type a message... (@ for agents/files, / for commands)";

  const formatVoiceElapsed = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  return (
    <div style={{ flexShrink: 0, padding: "0 1.5rem 12px" }}>
      <div style={{ position: "relative", maxWidth: "72rem", width: "100%", margin: "0 auto" }}>
        {slashQuery !== null && slashMatches.length > 0 && (
          <div ref={slashListRef} style={{ ...pickerPanelStyle, minWidth: 240, maxHeight: 300 }}>
            {slashMatches.map((s, i) => (
              <div data-selectable-row="true" key={s.name} onMouseDown={(e) => { e.preventDefault(); insertSlashCommand(s); }} style={pickerRow(i === slashIdx)}>
                <span style={{ fontWeight: 600, fontFamily: "monospace" }}>/{s.name}</span>
                <span style={{ color: colors.textMuted, fontSize: "0.8rem", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "1 1 auto" }}>{compactSkillDescription(s.description)}</span>
              </div>
            ))}
          </div>
        )}
        {bashCompletions.length > 0 && (
          <div ref={bashListRef} style={{ ...pickerPanelStyle, minWidth: 220, maxHeight: 300, overflow: "auto" }}>
            <div style={pickerSectionLabel}>
              <Terminal size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              Completions
            </div>
            {bashCompletions.map((c, i) => (
              <div data-selectable-row="true" key={c} onMouseDown={(e) => { e.preventDefault(); insertBashCompletion(c); }} style={pickerRow(i === bashCompIdx)}>
                <span style={{ fontFamily: "monospace", fontSize: "0.83rem" }}>{c}</span>
              </div>
            ))}
          </div>
        )}
        {mentionQuery !== null && mentionMatches.length > 0 && (() => {
          const agentMatches = mentionMatches.filter((m): m is MentionMatch & { type: "agent" } => m.type === "agent");
          const fileMatches = mentionMatches.filter((m): m is MentionMatch & { type: "file" } => m.type === "file");
          let idx = 0;
          return (
            <div ref={mentionListRef} style={{ ...pickerPanelStyle, minWidth: 220, maxHeight: 300 }}>
              {agentMatches.length > 0 && fileMatches.length > 0 && <div style={pickerSectionLabel}>Agents</div>}
              {agentMatches.map((m) => {
                const i = idx++;
                return <div data-selectable-row="true" key={`a-${m.agent.id}`} onMouseDown={(e) => { e.preventDefault(); insertMention(m); }} style={pickerRow(i === mentionIdx)}><span style={{ width: 8, height: 8, borderRadius: "50%", background: m.agent.color || colors.textMuted, flexShrink: 0 }} /><span style={{ fontWeight: 600 }}>@{m.agent.id}</span><span style={{ color: colors.textMuted }}>{m.agent.name}</span></div>;
              })}
              {fileMatches.length > 0 && agentMatches.length > 0 && <div style={{ ...pickerSectionLabel, borderTop: `1px solid ${colors.border}`, marginTop: 2 }}>Files</div>}
              {fileMatches.length > 0 && agentMatches.length === 0 && mentionQuery !== "" && <div style={pickerSectionLabel}>Files</div>}
              {fileMatches.map((m) => {
                const i = idx++;
                const parts = m.path.split("/");
                const filename = parts.pop() || m.path;
                const dir = parts.join("/");
                return <div data-selectable-row="true" key={`f-${m.path}`} onMouseDown={(e) => { e.preventDefault(); insertMention(m); }} style={pickerRow(i === mentionIdx)}><FileText size={14} style={{ color: colors.textMuted, flexShrink: 0 }} /><span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{dir && <span style={{ color: colors.textMuted }}>{dir}/</span>}{filename}</span></div>;
              })}
            </div>
          );
        })()}
        <form onSubmit={send} onDrop={(e) => { e.preventDefault(); setDragDepth(0); setDragActive(false); if (e.dataTransfer.files?.length) addComposerFiles(e.dataTransfer.files); }} onDragOver={(e) => { e.preventDefault(); setDragActive(true); }} onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; if (dragDepth === 0) setDragActive(false); }} style={{ display: "flex", gap: "8px", padding: "10px 14px", background: dragActive ? `color-mix(in srgb, ${colors.bgSurface} 82%, ${colors.accent} 18%)` : (isBashMode ? "var(--bg-bash-composer)" : colors.bgSurface), border: `1px solid ${dragActive ? colors.accent : (isBashMode ? "var(--border-bash-composer)" : colors.border)}`, borderRadius: "12px", flexDirection: "column", boxShadow: dragActive ? shadow.focus : "none", transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease", position: "relative" }}>
          {voiceUiActive && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "8px 10px", borderRadius: radius.xl, border: `1px solid color-mix(in srgb, ${colors.accent} 35%, ${colors.border})`, background: `color-mix(in srgb, ${colors.accent} 14%, ${colors.bg})` }}><div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: colors.accent, display: "inline-block", animation: "pulse 1.2s infinite", flexShrink: 0 }} /><span style={{ fontSize: "0.85rem", fontWeight: 500, minWidth: 0 }}>{voiceStatusText}</span><span style={{ fontSize: "0.8rem", color: colors.textMuted, fontFamily: "monospace" }}>{formatVoiceElapsed(voiceElapsedSec)}</span></div><button type="button" onClick={stopVoiceCapture} style={{ background: `color-mix(in srgb, ${colors.bg} 76%, ${colors.accent} 24%)`, color: colors.text, border: `1px solid color-mix(in srgb, ${colors.accent} 40%, ${colors.border})`, borderRadius: radius.pill, padding: "5px 10px", fontSize: "0.78rem", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" }}><Square size={12} fill="currentColor" /> Stop voice</button></div>}
          {dragActive && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", minHeight: "44px", border: `1px dashed ${colors.accent}`, borderRadius: radius.xl, background: `color-mix(in srgb, ${colors.accent} 8%, transparent)`, color: colors.accent, fontSize: "0.85rem", fontWeight: 500 }}><Paperclip size={16} /> Drop files here</div>}
          {composerAttachments.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>{composerAttachments.map((attachment, idx) => <div key={`${attachment.file.name}-${idx}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${colors.border}`, background: colors.bg, borderRadius: radius.lg, padding: attachment.previewUrl ? 4 : "6px 8px" }}>{attachment.previewUrl ? <img src={attachment.previewUrl} alt={attachment.file.name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: radius.md }} /> : <FileText size={14} />}<span style={{ fontSize: "0.78rem", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.file.name}</span><button type="button" onClick={() => removeComposerAttachment(idx)} style={{ background: "none", border: "none", color: colors.textMuted, display: "inline-flex", padding: 0 }}><X size={14} /></button></div>)}</div>}
          <div style={{ display: "flex", gap: "8px" }}>
            {isBashMode ? <span data-tooltip="Bash mode" style={{ color: "var(--border-bash-composer)", display: "inline-flex", alignItems: "center", padding: "4px 2px", flexShrink: 0 }}><Terminal size={16} /></span> : <button type="button" onClick={() => fileInputRef.current?.click()} style={{ background: "none", border: "none", color: colors.textMuted, display: "inline-flex", alignItems: "center", padding: "4px 2px", flexShrink: 0 }} data-tooltip="Attach files"><Paperclip size={16} /></button>}
            <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) addComposerFiles(e.target.files); e.currentTarget.value = ""; }} />
            <textarea ref={inputRef} rows={1} readOnly={voiceUiActive} style={{ ...inputStyle, background: "transparent", border: "none", resize: "none", overflowY: "auto", lineHeight: "1.5", minHeight: "24px", maxHeight: "200px" }} placeholder={inputPlaceholder} value={input} onChange={handleInputChange} onKeyDown={handleInputKeyDown} onPaste={(e) => { const files = Array.from(e.clipboardData.files || []); if (files.length > 0) addComposerFiles(files); }} autoFocus />
            {!busy && !voiceUiActive && <button type="button" onClick={() => { void startVoiceCapture(); }} style={{ ...roundActionButton, background: `color-mix(in srgb, ${colors.accent} 12%, ${colors.bg})`, color: colors.text, border: `1px solid color-mix(in srgb, ${colors.accent} 32%, ${colors.border})` }} data-tooltip="Start voice input"><Mic size={15} /></button>}
            {busy ? <button type="button" onClick={stop} style={{ ...btnPrimary, ...roundActionButton, background: colors.textMuted, cursor: "pointer" }} data-tooltip="Stop"><Square size={14} fill="currentColor" /></button> : <button type="submit" style={{ ...btnPrimary, ...roundActionButton, opacity: !connected || (!input.trim() && composerAttachments.length === 0) || uploadingAttachments ? 0.5 : 1 }} disabled={!connected || (!input.trim() && composerAttachments.length === 0) || uploadingAttachments} data-tooltip="Send"><ArrowUp size={16} /></button>}
          </div>
        </form>
      </div>
    </div>
  );
}
