import React, { Suspense, lazy } from "react";
import { X, Pencil, Save, RotateCcw, Copy, Check, XCircle } from "lucide-react";
import type { PanelFile } from "../hooks/usePanel";

// Lazy-load CodeMirror — only fetched when the panel first renders
const CodeMirrorEditor = lazy(() =>
  import("./CodeMirrorEditor").then((m) => ({ default: m.CodeMirrorEditor }))
);

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
}

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

const btnActiveStyle: React.CSSProperties = {
  ...btnStyle,
  background: "var(--accent)",
  color: "#fff",
};

export function FilePanel({
  file, editMode, dirty, saving, externalChange,
  onToggleEdit, onContentChange, onSave, onCancel, onClose,
  onReload, onDismissExternal,
}: FilePanelProps) {
  const [copied, setCopied] = React.useState(false);

  const copy = () => {
    navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "var(--bg)",
      borderLeft: "1px solid var(--border)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "8px 10px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        minHeight: "40px",
      }}>
        {/* File path */}
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

        {/* Dirty indicator */}
        {dirty && (
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "var(--accent)",
            display: "inline-block",
            flexShrink: 0,
          }} data-tooltip="Unsaved changes" />
        )}

        {/* Action buttons */}
        {editMode ? (
          <>
            <button
              onClick={onSave}
              disabled={saving || !dirty}
              style={{
                ...btnActiveStyle,
                opacity: (saving || !dirty) ? 0.5 : 1,
              }}
              data-tooltip="Save (⌘S)"
            >
              <Save size={13} />
              <span>{saving ? "Saving..." : "Save"}</span>
            </button>
            <button onClick={onCancel} style={btnStyle} data-tooltip="Cancel edit">
              <XCircle size={13} />
            </button>
          </>
        ) : (
          <button onClick={onToggleEdit} style={btnStyle} data-tooltip="Edit file">
            <Pencil size={13} />
            <span>Edit</span>
          </button>
        )}

        <button onClick={copy} style={btnStyle} data-tooltip={copied ? "Copied!" : "Copy"}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>

        <button onClick={onClose} style={btnStyle} data-tooltip="Close panel">
          <X size={14} />
        </button>
      </div>

      {/* External change banner */}
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

      {/* Editor */}
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
