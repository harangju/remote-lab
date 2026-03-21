import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Pencil, Save, RotateCcw, Copy, Check, FolderOpen, MessageSquare, Clock3, Download, FileText } from "lucide-react";
import type { PanelFile } from "../hooks/usePanel";
import { getToken } from "../api";
import { btnIcon, colors, interactiveRow, overlayHeader, overlayPanel, radius, shadow } from "../styles";
import { ListModal } from "./ListModal";
import type { CodeMirrorEditorHandle } from "./CodeMirrorEditor";

const CodeMirrorEditor = lazy(() =>
  import("./CodeMirrorEditor").then((m) => ({ default: m.CodeMirrorEditor }))
);

export interface FileConversationOption {
  id: string;
  title: string;
  updated_at: string;
}

interface FilePanelProps {
  file: PanelFile;
  editMode: boolean;
  dirty: boolean;
  saving: boolean;
  saveError?: string | null;
  externalChange: boolean;
  onToggleEdit: () => void;
  onContentChange: (content: string) => void;
  onSave: (content?: string) => void | Promise<void>;
  onCancel: () => string;
  onClose: () => void;
  onReload: () => Promise<string | null>;
  onDismissExternal: () => void;
  onOpenFileFinder?: () => void;
  onStartConversation?: () => void;
  conversationDisabled?: boolean;
  conversationOptions?: FileConversationOption[];
  conversationOptionsLabel?: string;
  conversationModal?: boolean;
  onOpenConversationOption?: (id: string) => void;
}

const iconBtnStyle: React.CSSProperties = { ...btnIcon, cursor: "pointer" };
const btnStyle: React.CSSProperties = { background: "none", border: "none", padding: "4px 8px", color: colors.textMuted, display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", borderRadius: radius.sm };
const iconBtnActiveStyle: React.CSSProperties = { ...btnIcon, background: colors.text, border: `1px solid ${colors.text}`, color: colors.bg, cursor: "pointer" };
const iconBtnDangerStyle: React.CSSProperties = { ...btnIcon, background: "transparent", border: `1px solid color-mix(in srgb, ${colors.textMuted} 55%, ${colors.border})`, color: colors.textMuted, cursor: "pointer" };
const conversationPopoverStyle: React.CSSProperties = { ...overlayPanel, position: "absolute", top: "calc(100% + 8px)", right: 0, width: "min(360px, 82vw)", maxHeight: "min(420px, 60vh)", boxShadow: shadow.overlay, zIndex: 20 };

const docxPreviewStyle = `
  .docx-preview {
    max-width: 860px;
    margin: 0 auto;
    padding: 32px 40px 48px;
    color: var(--text);
    line-height: 1.6;
    font-size: 0.95rem;
  }
  .docx-preview p { margin: 0 0 0.9em; }
  .docx-preview h1, .docx-preview h2, .docx-preview h3, .docx-preview h4, .docx-preview h5, .docx-preview h6 {
    margin: 1.2em 0 0.45em;
    line-height: 1.25;
  }
  .docx-preview h1 { font-size: 1.7em; }
  .docx-preview h2 { font-size: 1.4em; }
  .docx-preview h3 { font-size: 1.15em; }
  .docx-preview ul, .docx-preview ol { margin: 0.5em 0 1em; padding-left: 1.5em; }
  .docx-preview li { margin: 0.2em 0; }
  .docx-preview table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.9rem; }
  .docx-preview th, .docx-preview td { border: 1px solid var(--border); padding: 8px 10px; vertical-align: top; }
  .docx-preview th { background: var(--bg-surface); text-align: left; }
  .docx-preview img { max-width: 100%; height: auto; }
  .docx-preview a { color: var(--accent); }
  .docx-preview blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid var(--border); color: var(--text-muted); }
`;

function hoverIn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = colors.bgSurfaceHover;
}

function hoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = colors.bgSurface;
}

function timeAgo(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "recently";
  const diff = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isDocx(path: string): boolean {
  return path.toLowerCase().endsWith(".docx");
}

function isPdf(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

function isHtml(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

export function FilePanel({
  file, editMode, dirty, saving, saveError, externalChange,
  onToggleEdit, onContentChange, onSave, onCancel, onClose,
  onReload, onDismissExternal, onOpenFileFinder, onStartConversation, conversationDisabled,
  conversationOptions = [], conversationOptionsLabel = "Recent conversations using this file", conversationModal = false, onOpenConversationOption,
}: FilePanelProps) {
  const editorRef = useRef<CodeMirrorEditorHandle | null>(null);
  const [copied, setCopied] = useState(false);
  const [showConversationMenu, setShowConversationMenu] = useState(false);
  const [docxHtml, setDocxHtml] = useState<string>("");
  const [docxMessages, setDocxMessages] = useState<string[]>([]);
  const [docxLoading, setDocxLoading] = useState(false);
  const [docxError, setDocxError] = useState<string | null>(null);
  const conversationMenuRef = useRef<HTMLDivElement | null>(null);

  const hasConversationChoices = !!onStartConversation || (conversationOptions.length > 0 && !!onOpenConversationOption);
  const visibleConversationOptions = useMemo(() => conversationOptions.slice(0, 4), [conversationOptions]);
  const docxFile = isDocx(file.path);
  const pdfFile = isPdf(file.path);
  const htmlFile = isHtml(file.path);
  const previewFile = docxFile || pdfFile || htmlFile;
  const embedToken = getToken();
  const embedPreviewUrl = previewFile && embedToken ? `/api/projects/${file.projectId}/file/embed?path=${encodeURIComponent(file.path)}&token=${encodeURIComponent(embedToken)}` : null;

  useEffect(() => {
    if (!showConversationMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!conversationMenuRef.current?.contains(event.target as Node)) setShowConversationMenu(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [showConversationMenu]);

  useEffect(() => {
    if (!docxFile) {
      setDocxHtml("");
      setDocxMessages([]);
      setDocxError(null);
      setDocxLoading(false);
      return;
    }
    const token = getToken();
    if (!token) {
      setDocxError("Missing auth token");
      setDocxLoading(false);
      return;
    }
    const controller = new AbortController();
    setDocxLoading(true);
    setDocxError(null);
    setDocxHtml("");
    setDocxMessages([]);

    (async () => {
      try {
        const response = await fetch(`/api/projects/${file.projectId}/file/raw?path=${encodeURIComponent(file.path)}`, {
          headers: {
            Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/octet-stream",
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Preview failed: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const mammoth = await import("mammoth/mammoth.browser");
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (controller.signal.aborted) return;
        setDocxHtml(result.value || "<p><em>This document appears to be empty.</em></p>");
        setDocxMessages(result.messages.map((message: { message: string }) => message.message).filter(Boolean));
      } catch (err: any) {
        if (controller.signal.aborted) return;
        console.error("DOCX preview failed", err);
        setDocxError(err?.message || "Could not preview this Word document.");
      } finally {
        if (!controller.signal.aborted) setDocxLoading(false);
      }
    })();

    return () => controller.abort();
  }, [docxFile, file.path, file.projectId]);

  const copy = useCallback(() => {
    const value = editorRef.current?.getValue() ?? file.content;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [file.content]);

  const handleSave = useCallback(() => {
    void onSave(editorRef.current?.getValue());
  }, [onSave]);

  const handleCancel = useCallback(() => {
    const original = onCancel();
    editorRef.current?.replaceContent(original, { addToHistory: false });
  }, [onCancel]);

  const handleReload = useCallback(async () => {
    const content = await onReload();
    if (content !== null) {
      editorRef.current?.replaceContent(content, { addToHistory: false });
    }
  }, [onReload]);

  useEffect(() => {
    editorRef.current?.replaceContent(file.content, { addToHistory: false });
  }, [file.path, file.content]);

  const download = async () => {
    const token = getToken();
    if (!token) {
      console.error("Download failed: missing auth token");
      return;
    }
    try {
      const response = await fetch(`/api/projects/${file.projectId}/file/raw?path=${encodeURIComponent(file.path)}`, {
        headers: {
          Accept: "application/octet-stream",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.path.split("/").pop() || "file";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error(err);
    }
  };

  const conversationActionRow = (icon: React.ReactNode, label: React.ReactNode, onClick: () => void) => (
    <button onClick={onClick} style={interactiveRow(false)} onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgSurface; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
      {icon}
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: colors.bg, borderLeft: `1px solid ${colors.border}` }}>
      <style>{docxPreviewStyle}</style>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderBottom: `1px solid ${colors.border}`, flexShrink: 0, minHeight: "40px", position: "relative", zIndex: 2, overflow: "visible" }}>
        <span style={{ flex: 1, fontSize: "0.78rem", fontFamily: "monospace", color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
          <bdi>{file.path}</bdi>
        </span>

        {dirty && <span style={{ width: 6, height: 6, borderRadius: "50%", background: colors.accent, display: "inline-block", flexShrink: 0 }} data-tooltip="Unsaved changes" />}

        {previewFile ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "0.72rem", color: colors.textMuted, padding: "0 2px", flexShrink: 0 }} data-tooltip={docxFile ? "Read-only Word preview" : htmlFile ? "Read-only HTML preview" : "Read-only PDF preview"}>
            <FileText size={14} />
            <span>Preview</span>
          </span>
        ) : editMode ? (
          <>
            <button onClick={handleSave} disabled={saving || !dirty} style={{ ...iconBtnActiveStyle, opacity: (saving || !dirty) ? 0.5 : 1, cursor: (saving || !dirty) ? "default" : "pointer" }} data-tooltip={saving ? "Saving..." : "Save (⌘S)"}><Save size={15} /></button>
            <button onClick={handleCancel} style={iconBtnDangerStyle} data-tooltip="Cancel edit"><X size={16} /></button>
          </>
        ) : (
          <button onClick={onToggleEdit} style={iconBtnStyle} data-tooltip="Edit file" onMouseEnter={hoverIn} onMouseLeave={hoverOut}><Pencil size={15} /></button>
        )}

        {onOpenFileFinder && <button onClick={onOpenFileFinder} style={iconBtnStyle} data-tooltip="Open file (⌘P)" onMouseEnter={hoverIn} onMouseLeave={hoverOut}><FolderOpen size={15} /></button>}

        {hasConversationChoices && (
          <div ref={conversationMenuRef} style={{ position: "relative", display: "inline-flex" }}>
            <button onClick={() => !conversationDisabled && setShowConversationMenu((v) => !v)} disabled={conversationDisabled} style={{ ...iconBtnStyle, opacity: conversationDisabled ? 0.5 : 1, cursor: conversationDisabled ? "default" : "pointer" }} data-tooltip="Open conversation menu" onMouseEnter={(e) => { if (!conversationDisabled) hoverIn(e); }} onMouseLeave={hoverOut}><MessageSquare size={15} /></button>
            {showConversationMenu && !conversationDisabled && (
              conversationModal ? (
                <ListModal title="Conversations for this file" onClose={() => setShowConversationMenu(false)}>
                  {onStartConversation && conversationActionRow(<MessageSquare size={15} style={{ flexShrink: 0, color: colors.textMuted }} />, <span style={{ fontWeight: 500 }}>New conversation about this file</span>, () => { setShowConversationMenu(false); onStartConversation(); })}
                  {visibleConversationOptions.length > 0 && <div style={{ padding: "6px 14px 4px", fontSize: "0.7rem", color: colors.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", borderTop: onStartConversation ? `1px solid ${colors.border}` : "none" }}>{conversationOptionsLabel}</div>}
                  {visibleConversationOptions.map((option) => (
                    <button key={option.id} onClick={() => { setShowConversationMenu(false); onOpenConversationOption?.(option.id); }} style={interactiveRow(false)} onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgSurface; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                      <Clock3 size={15} style={{ flexShrink: 0, color: colors.textMuted }} />
                      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.title || "Untitled"}</span><span style={{ fontSize: "0.72rem", color: colors.textMuted }}>{timeAgo(option.updated_at)}</span></span>
                    </button>
                  ))}
                </ListModal>
              ) : (
                <div style={conversationPopoverStyle}>
                  <div style={overlayHeader}><span>Conversations for this file</span></div>
                  <div style={{ overflowY: "auto", flex: 1 }}>
                    {onStartConversation && conversationActionRow(<MessageSquare size={15} style={{ flexShrink: 0, color: colors.textMuted }} />, <span style={{ fontWeight: 500 }}>New conversation about this file</span>, () => { setShowConversationMenu(false); onStartConversation(); })}
                    {visibleConversationOptions.length > 0 && <div style={{ padding: "6px 14px 4px", fontSize: "0.7rem", color: colors.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", borderTop: onStartConversation ? `1px solid ${colors.border}` : "none" }}>{conversationOptionsLabel}</div>}
                    {visibleConversationOptions.map((option) => (
                      <button key={option.id} onClick={() => { setShowConversationMenu(false); onOpenConversationOption?.(option.id); }} style={interactiveRow(false)} onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgSurface; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <Clock3 size={15} style={{ flexShrink: 0, color: colors.textMuted }} />
                        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.title || "Untitled"}</span><span style={{ fontSize: "0.72rem", color: colors.textMuted }}>{timeAgo(option.updated_at)}</span></span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )}

        <button onClick={download} style={iconBtnStyle} data-tooltip="Download file" onMouseEnter={hoverIn} onMouseLeave={hoverOut}><Download size={15} /></button>
        {!previewFile && <button onClick={copy} style={iconBtnStyle} data-tooltip={copied ? "Copied!" : "Copy"} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>}
        <button onClick={onClose} style={iconBtnStyle} data-tooltip="Close panel" onMouseEnter={hoverIn} onMouseLeave={hoverOut}><X size={16} /></button>
      </div>

      {(externalChange || saveError) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px 12px", background: saveError ? `color-mix(in srgb, ${colors.danger} 10%, transparent)` : colors.warningSoft, borderBottom: `1px solid ${colors.border}`, fontSize: "0.75rem", color: colors.text, flexShrink: 0 }}>
          {saveError && <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ flex: 1 }}>{saveError}</span><button onClick={() => { void handleReload(); }} style={{ ...btnStyle, fontSize: "0.72rem" }}><RotateCcw size={12} /> Reload</button></div>}
          {externalChange && <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ flex: 1 }}>This file was modified by the agent.</span>{!saveError && <button onClick={() => { void handleReload(); }} style={{ ...btnStyle, fontSize: "0.72rem" }}><RotateCcw size={12} /> Reload</button>}<button onClick={onDismissExternal} style={{ ...btnStyle, fontSize: "0.72rem" }}>Dismiss</button></div>}
        </div>
      )}

      <div style={{ flex: 1, overflow: "hidden" }}>
        {docxFile ? (
          <div style={{ height: "100%", overflowY: "auto", background: colors.bg }}>
            {docxLoading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: colors.textMuted, fontSize: "0.8rem" }}>Loading Word preview...</div>
            ) : docxError ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: "24px", color: colors.textMuted, fontSize: "0.85rem", textAlign: "center" }}><div style={{ maxWidth: 420 }}><div>Could not preview this Word document. Try downloading it instead.</div>{docxError && <div style={{ marginTop: 8, fontSize: "0.75rem", opacity: 0.8, wordBreak: "break-word" }}>{docxError}</div>}</div></div>
            ) : (
              <div>
                {docxMessages.length > 0 && <div style={{ margin: "16px 16px 0", padding: "10px 12px", border: `1px solid ${colors.border}`, borderRadius: radius.xl, background: colors.bgSurface, color: colors.textMuted, fontSize: "0.78rem" }}>Preview note: some Word formatting may not render exactly.</div>}
                <div className="docx-preview" dangerouslySetInnerHTML={{ __html: docxHtml }} />
              </div>
            )}
          </div>
        ) : pdfFile ? (
          embedPreviewUrl ? <iframe title={file.path} src={embedPreviewUrl} style={{ width: "100%", height: "100%", border: "none", background: colors.bg }} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: "24px", color: colors.textMuted, fontSize: "0.85rem", textAlign: "center" }}><div style={{ maxWidth: 420 }}><div>Could not preview this PDF. Try downloading it instead.</div><div style={{ marginTop: 8, fontSize: "0.75rem", opacity: 0.8, wordBreak: "break-word" }}>Missing auth token.</div></div></div>
        ) : htmlFile ? (
          embedPreviewUrl ? <iframe title={file.path} src={embedPreviewUrl} style={{ width: "100%", height: "100%", border: "none", background: colors.bg }} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: "24px", color: colors.textMuted, fontSize: "0.85rem", textAlign: "center" }}><div style={{ maxWidth: 420 }}><div>Could not preview this HTML file. Try downloading it instead.</div><div style={{ marginTop: 8, fontSize: "0.75rem", opacity: 0.8, wordBreak: "break-word" }}>Missing auth token.</div></div></div>
        ) : (
          <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: colors.textMuted, fontSize: "0.8rem" }}>Loading editor...</div>}>
            <CodeMirrorEditor ref={editorRef} code={file.content} language={file.language} readOnly={!editMode} onChange={onContentChange} onSave={handleSave} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
