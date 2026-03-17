import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { X, Pencil, Save, RotateCcw, Copy, Check, FolderOpen, MessageSquare, Clock3, Download } from "lucide-react";
import type { PanelFile } from "../hooks/usePanel";
import { getToken } from "../api";
import { btnIcon } from "../styles";
import { ListModal } from "./ListModal";

// Lazy-load CodeMirror — only fetched when the panel first renders
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
  externalChange: boolean;
  onToggleEdit: () => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
  onReload: () => void;
  onDismissExternal: () => void;
  onOpenFileFinder?: () => void;
  onStartConversation?: () => void;
  conversationDisabled?: boolean;
  conversationOptions?: FileConversationOption[];
  conversationOptionsLabel?: string;
  conversationModal?: boolean;
  onOpenConversationOption?: (id: string) => void;
}

const iconBtnStyle: React.CSSProperties = {
  ...btnIcon,
  cursor: "pointer",
};

const btnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "4px 8px",
  color: "var(--text-muted)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  fontSize: "0.75rem",
  borderRadius: "4px",
};

const iconBtnActiveStyle: React.CSSProperties = {
  ...btnIcon,
  background: "var(--text)",
  border: "1px solid var(--text)",
  color: "var(--bg)",
  cursor: "pointer",
};

const iconBtnDangerStyle: React.CSSProperties = {
  ...btnIcon,
  background: "transparent",
  border: "1px solid color-mix(in srgb, var(--text-muted) 55%, var(--border))",
  color: "var(--text-muted)",
  cursor: "pointer",
};

function hoverIn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = "color-mix(in srgb, var(--bg-surface) 88%, var(--accent) 12%)";
}

function hoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = "var(--bg-surface)";
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

export function FilePanel({
  file, editMode, dirty, saving, externalChange,
  onToggleEdit, onContentChange, onSave, onCancel, onClose,
  onReload, onDismissExternal, onOpenFileFinder, onStartConversation, conversationDisabled,
  conversationOptions = [], conversationOptionsLabel = "Recent conversations using this file", conversationModal = false, onOpenConversationOption,
}: FilePanelProps) {
  const [copied, setCopied] = useState(false);
  const [showConversationMenu, setShowConversationMenu] = useState(false);
  const conversationMenuRef = useRef<HTMLDivElement | null>(null);

  const hasConversationChoices = !!onStartConversation || (conversationOptions.length > 0 && !!onOpenConversationOption);
  const visibleConversationOptions = useMemo(() => conversationOptions.slice(0, 4), [conversationOptions]);

  useEffect(() => {
    if (!showConversationMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!conversationMenuRef.current?.contains(event.target as Node)) {
        setShowConversationMenu(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [showConversationMenu]);

  const copy = () => {
    navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const token = getToken();
    if (!token) return;
    const rawPath = `/api/projects/${file.projectId}/file/raw?path=${encodeURIComponent(file.path)}`;
    const url = new URL(rawPath, window.location.origin);
    url.searchParams.set("token", token);
    const link = document.createElement("a");
    link.href = url.toString();
    link.download = file.path.split("/").pop() || "file";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "var(--bg)",
      borderLeft: "1px solid var(--border)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 10px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        minHeight: "40px",
        position: "relative",
        zIndex: 2,
        overflow: "visible",
      }}>
        <span style={{
          flex: 1,
          fontSize: "0.78rem",
          fontFamily: "monospace",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          direction: "rtl",
          textAlign: "left",
        }}>
          <bdi>{file.path}</bdi>
        </span>

        {dirty && (
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "var(--accent)",
            display: "inline-block",
            flexShrink: 0,
          }} data-tooltip="Unsaved changes" />
        )}

        {editMode ? (
          <>
            <button
              onClick={onSave}
              disabled={saving || !dirty}
              style={{
                ...iconBtnActiveStyle,
                opacity: (saving || !dirty) ? 0.5 : 1,
                cursor: (saving || !dirty) ? "default" : "pointer",
              }}
              data-tooltip={saving ? "Saving..." : "Save (⌘S)"}
            >
              <Save size={15} />
            </button>
            <button onClick={onCancel} style={iconBtnDangerStyle} data-tooltip="Cancel edit">
              <X size={16} />
            </button>
          </>
        ) : (
          <button onClick={onToggleEdit} style={iconBtnStyle} data-tooltip="Edit file" onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
            <Pencil size={15} />
          </button>
        )}

        {onOpenFileFinder && (
          <button onClick={onOpenFileFinder} style={iconBtnStyle} data-tooltip="Open file (⌘P)" onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
            <FolderOpen size={15} />
          </button>
        )}

        {hasConversationChoices && (
          <div ref={conversationMenuRef} style={{ position: "relative", display: "inline-flex" }}>
            <button
              onClick={() => !conversationDisabled && setShowConversationMenu((v) => !v)}
              disabled={conversationDisabled}
              style={{ ...iconBtnStyle, opacity: conversationDisabled ? 0.5 : 1, cursor: conversationDisabled ? "default" : "pointer" }}
              data-tooltip="Open conversation menu"
              onMouseEnter={(e) => { if (!conversationDisabled) hoverIn(e); }}
              onMouseLeave={hoverOut}
            >
              <MessageSquare size={15} />
            </button>
            {showConversationMenu && !conversationDisabled && (
              conversationModal ? (
                <ListModal title="Conversations for this file" onClose={() => setShowConversationMenu(false)}>
                  {onStartConversation && (
                    <button
                      onClick={() => {
                        setShowConversationMenu(false);
                        onStartConversation();
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        width: "100%",
                        padding: "8px 14px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text)",
                        fontSize: "0.82rem",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <MessageSquare size={15} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                      <span style={{ fontWeight: 500 }}>New conversation about this file</span>
                    </button>
                  )}
                  {visibleConversationOptions.length > 0 && (
                    <div style={{ padding: "6px 14px 4px", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", borderTop: onStartConversation ? "1px solid var(--border)" : "none" }}>
                      {conversationOptionsLabel}
                    </div>
                  )}
                  {visibleConversationOptions.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => {
                        setShowConversationMenu(false);
                        onOpenConversationOption?.(option.id);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        width: "100%",
                        padding: "8px 14px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text)",
                        fontSize: "0.82rem",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <Clock3 size={15} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {option.title || "Untitled"}
                        </span>
                        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{timeAgo(option.updated_at)}</span>
                      </span>
                    </button>
                  ))}
                </ListModal>
              ) : (
                <div style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  width: "min(360px, 82vw)",
                  maxHeight: "min(420px, 60vh)",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  zIndex: 20,
                }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border)",
                    fontSize: "0.82rem",
                    color: "var(--text-muted)",
                  }}>
                    <span>Conversations for this file</span>
                  </div>
                  <div style={{ overflowY: "auto", flex: 1 }}>
                    {onStartConversation && (
                      <button
                        onClick={() => {
                          setShowConversationMenu(false);
                          onStartConversation();
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          width: "100%",
                          padding: "8px 14px",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text)",
                          fontSize: "0.82rem",
                          textAlign: "left",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <MessageSquare size={15} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                        <span style={{ fontWeight: 500 }}>New conversation about this file</span>
                      </button>
                    )}
                    {visibleConversationOptions.length > 0 && (
                      <div style={{ padding: "6px 14px 4px", fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", borderTop: onStartConversation ? "1px solid var(--border)" : "none" }}>
                        {conversationOptionsLabel}
                      </div>
                    )}
                    {visibleConversationOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => {
                          setShowConversationMenu(false);
                          onOpenConversationOption?.(option.id);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          width: "100%",
                          padding: "8px 14px",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text)",
                          fontSize: "0.82rem",
                          textAlign: "left",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <Clock3 size={15} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {option.title || "Untitled"}
                          </span>
                          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{timeAgo(option.updated_at)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )}

        <button onClick={download} style={iconBtnStyle} data-tooltip="Download file" onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
          <Download size={15} />
        </button>

        <button onClick={copy} style={iconBtnStyle} data-tooltip={copied ? "Copied!" : "Copy"} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>

        <button onClick={onClose} style={iconBtnStyle} data-tooltip="Close panel" onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
          <X size={16} />
        </button>
      </div>

      {externalChange && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          background: "#d9a75422",
          borderBottom: "1px solid var(--border)",
          fontSize: "0.75rem",
          color: "var(--text)",
          flexShrink: 0,
        }}>
          <span style={{ flex: 1 }}>This file was modified by the agent.</span>
          <button onClick={onReload} style={{ ...btnStyle, fontSize: "0.72rem" }}>
            <RotateCcw size={12} /> Reload
          </button>
          <button onClick={onDismissExternal} style={{ ...btnStyle, fontSize: "0.72rem" }}>
            Dismiss
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "hidden" }}>
        <Suspense fallback={
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "var(--text-muted)",
            fontSize: "0.8rem",
          }}>Loading editor...</div>
        }>
          <CodeMirrorEditor
            code={file.content}
            language={file.language}
            readOnly={!editMode}
            onChange={onContentChange}
            onSave={onSave}
          />
        </Suspense>
      </div>
    </div>
  );
}
