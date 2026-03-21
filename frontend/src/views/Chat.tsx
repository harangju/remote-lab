import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { FileText, Pencil, FolderOpen, Sparkles, Archive } from "lucide-react";
import { updateConvo } from "../api";
import { btnIcon } from "../styles";

const headerIconBtnStyle: React.CSSProperties = {
  ...btnIcon,
  cursor: "pointer",
};

function headerHoverIn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "color-mix(in srgb, var(--bg-surface) 88%, var(--accent) 12%)";
}

function headerHoverOut(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = "var(--bg-surface)";
}
import { FilePanel } from "../components/FilePanel";
import { FileFinder } from "../components/FileFinder";
import { usePanel } from "../hooks/usePanel";
import { extractFilePath } from "../chatUi";
import { ChatComposer } from "../chatComposer";
import { ChatMessages } from "../chatMessages";
import { useChatSession } from "../hooks/useChatSession";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ContextDonut — small SVG ring showing context window usage
// ---------------------------------------------------------------------------

function formatTokenCount(value: number, digits = 1): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${parseFloat(millions.toFixed(digits))}m`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${parseFloat(thousands.toFixed(digits))}k`;
  }
  return `${value}`;
}

function ContextDonut({ tokens, limit }: { tokens: number; limit: number }) {
  if (!limit) return null;
  const pct = Math.min(tokens / limit, 1);
  const r = 7;
  const circ = 2 * Math.PI * r;
  const filled = circ * pct;
  const color = pct > 0.8 ? "#d9a754" : "var(--text-muted)";
  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", cursor: "default" }}
      data-tooltip={`${formatTokenCount(tokens)} / ${formatTokenCount(limit, 0)} tokens (${Math.round(pct * 100)}%)`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
        <circle
          cx="9" cy="9" r={r}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolChip — collapsible tool call display
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Chat component
// Live file-change sync test marker 2
// ---------------------------------------------------------------------------

const CHAT_HEADER_MAX_WIDTH = "64rem";
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH_RATIO = 0.75;
const PANEL_DEFAULT_WIDTH_RATIO = 0.36;
const PANEL_RESIZE_HIT_WIDTH = 14;
const PANEL_RESIZE_VISIBLE_WIDTH = 4;
const PANEL_RESIZE_ACTIVATION_DELTA = 3;
const CHAT_PANEL_RATIO_STORAGE_KEY = "remote-lab:chat-panel-width-ratio";

export function Chat() {
  const { projectId, convId } = useParams<{ projectId: string; convId: string }>();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  // Panel hook
  const panel = usePanel(projectId);

  const {
    messages,
    streamBlocks,
    waitingForModel,
    input,
    setInput,
    busy,
    meta,
    autonomousToolsEnabled,
    savingAutonomy,
    error,
    connected,
    title,
    setTitle,
    agents,
    projectFiles,
    skills,
    activeAgent,
    hasMoreHistory,
    loadingOlder,
    composerAttachments,
    uploadingAttachments,
    voiceUiActive,
    voiceElapsedSec,
    voiceError,
    voiceStatusText,
    messageListRef,
    pendingScrollMessageIdRef,
    lastSentMessageRef,
    latestUserMessageRef,
    bottomSlackPx,
    refreshMentionFiles,
    loadOlderHistory,
    addComposerFiles,
    removeComposerAttachment,
    handleToolApproval,
    sendText,
    resend,
    stop,
    stopVoiceCapture,
    startVoiceCapture,
    toggleAutonomy,
    setError,
    setProjectFiles,
  } = useChatSession(projectId, convId);

  const syncFileQuery = useCallback((path: string | null, replace = false) => {
    if (!projectId || !convId) return;
    const nextUrl = path
      ? `/${projectId}/${convId}?path=${encodeURIComponent(path)}`
      : `/${projectId}/${convId}`;
    navigate(nextUrl, { replace });
  }, [convId, navigate, projectId]);

  // Collect touched files from conversation for FileFinder
  const touchedFiles = useMemo(() => {
    const paths = new Set<string>();
    const allBlocks = [...messages.flatMap((m) => m.blocks), ...streamBlocks];
    for (const b of allBlocks) {
      if (b.type === "tool") {
        const p = extractFilePath(b.name, b.input);
        if (p) paths.add(p);
      }
    }
    return Array.from(paths);
  }, [messages, streamBlocks]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = params.get("path");
    const prefill = params.get("prefill");
    if (path) {
      if (!panel.file || panel.file.path !== path) panel.openFile(path);
    } else if (panel.file && !panel.dirty) {
      panel.forceClose();
    }
    if (prefill) {
      setInput(prefill);
      params.delete("prefill");
      const nextUrl = params.toString() ? `/${projectId}/${convId}?${params.toString()}` : `/${projectId}/${convId}`;
      navigate(nextUrl, { replace: true });
    }
  }, [panel, projectId, convId, navigate]);

  /** Open a file in the panel, with dirty guard. */
  const handleOpenFile = useCallback((path: string) => {
    if (panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard and open another file?")) return;
    }
    syncFileQuery(path);
    panel.openFile(path);
  }, [panel, syncFileQuery]);

  /** Open a code snippet in the panel (from inline code blocks). */
  const handleOpenSnippet = useCallback((code: string, language: string) => {
    if (panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard and view snippet?")) return;
    }
    // For snippets, we set the file directly — no backend fetch needed
    // We do this by calling openFile with a synthetic approach
    // Actually, let's just use the panel state directly
    panel.forceClose();
    // Small delay to allow state to clear, then open
    setTimeout(() => {
      panel.openFile(`snippet.${language}`);
    }, 0);
    // Actually, snippets don't exist on disk. Let's handle this differently.
    // For now, skip snippet opening in the panel — the CodeBlock already has
    // copy and expand features. The panel is for real files.
  }, [panel]);

  /** Close panel with dirty guard. */
  const handleClosePanel = useCallback(() => {
    if (panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard?")) return;
    }
    syncFileQuery(null);
    panel.forceClose();
  }, [panel, syncFileQuery]);

  /** Toggle edit mode with dirty guard when turning off. */
  const handleToggleEdit = useCallback(() => {
    if (panel.editMode && panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard?")) return;
      panel.cancelEdit();
    } else {
      panel.setEditMode(!panel.editMode);
    }
  }, [panel]);

  const startEdit = () => {
    setEditValue(title);
    setEditing(true);
  };

  const saveTitle = async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title && convId) {
      try {
        await updateConvo(convId, { title: trimmed });
        setTitle(trimmed);
      } catch {}
    }
    setEditing(false);
  };

  const archiveConversation = useCallback(async () => {
    if (!convId) return;
    try {
      await updateConvo(convId, { archived_at: new Date().toISOString() });
      navigate(`/${projectId}`);
    } catch (e: any) {
      setError(e.message || "Failed to archive conversation");
    }
  }, [convId, navigate, projectId]);

  // Keyboard shortcut: Cmd+P for file finder
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        panel.toggleFileFinder();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [panel]);

  // Resizable panel width
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 500;
    const maxWidth = Math.floor(window.innerWidth * PANEL_MAX_WIDTH_RATIO);
    const storedRatio = Number(window.localStorage.getItem(CHAT_PANEL_RATIO_STORAGE_KEY));
    const ratio = Number.isFinite(storedRatio) && storedRatio > 0
      ? Math.min(PANEL_MAX_WIDTH_RATIO, Math.max(PANEL_MIN_WIDTH / window.innerWidth, storedRatio))
      : PANEL_DEFAULT_WIDTH_RATIO;
    return Math.max(PANEL_MIN_WIDTH, Math.min(maxWidth, Math.round(window.innerWidth * ratio)));
  });
  const [panelResizeActive, setPanelResizeActive] = useState(false);
  const dragging = useRef(false);
  const dragActivatedRef = useRef(false);
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragActivatedRef.current = false;
    const startX = e.clientX;
    const startWidth = panelWidth;
    const maxWidth = Math.floor(window.innerWidth * PANEL_MAX_WIDTH_RATIO);
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX - e.clientX;
      if (!dragActivatedRef.current && Math.abs(delta) < PANEL_RESIZE_ACTIVATION_DELTA) return;
      dragActivatedRef.current = true;
      setPanelResizeActive(true);
      const nextWidth = Math.max(PANEL_MIN_WIDTH, Math.min(maxWidth, startWidth + delta));
      setPanelWidth(nextWidth);
      window.localStorage.setItem(CHAT_PANEL_RATIO_STORAGE_KEY, String(nextWidth / window.innerWidth));
    };
    const onMouseUp = () => {
      dragging.current = false;
      dragActivatedRef.current = false;
      setPanelResizeActive(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [panelWidth]);

  useEffect(() => {
    if (!panel.file || typeof window === "undefined") return;
    const onResize = () => {
      const maxWidth = Math.floor(window.innerWidth * PANEL_MAX_WIDTH_RATIO);
      const storedRatio = Number(window.localStorage.getItem(CHAT_PANEL_RATIO_STORAGE_KEY));
      const ratio = Number.isFinite(storedRatio) && storedRatio > 0
        ? Math.min(PANEL_MAX_WIDTH_RATIO, Math.max(PANEL_MIN_WIDTH / window.innerWidth, storedRatio))
        : Math.min(PANEL_MAX_WIDTH_RATIO, Math.max(PANEL_MIN_WIDTH / window.innerWidth, PANEL_DEFAULT_WIDTH_RATIO));
      setPanelWidth(Math.max(PANEL_MIN_WIDTH, Math.min(maxWidth, Math.round(window.innerWidth * ratio))));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [panel.file]);

  return (
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden" }}>
      {/* Chat column */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
      }}>
        {/* Header */}
        <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0, position: "relative", zIndex: 2 }}>
        <div style={{ padding: "8px 1.5rem", minHeight: "51px", maxWidth: CHAT_HEADER_MAX_WIDTH, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <Link
              to={`/${projectId}`}
              style={{
                ...headerIconBtnStyle,
                color: "var(--text-muted)",
                textDecoration: "none",
              }}
              data-tooltip="Conversations"
              aria-label="Conversations"
              onMouseEnter={headerHoverIn}
              onMouseLeave={headerHoverOut}
            >
              <span style={{ fontSize: "1rem", lineHeight: 1 }}>&larr;</span>
            </Link>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", minWidth: 0, flexShrink: 1 }}>
              {editing ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  style={{
                    fontWeight: 600,
                    fontSize: "1rem",
                    background: "var(--bg-surface)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    padding: "1px 6px",
                    outline: "none",
                    minWidth: 0,
                    maxWidth: "20rem",
                  }}
                />
              ) : (
                <>
                  <span title={title} style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                  <button
                    onClick={startEdit}
                    data-tooltip="Rename"
                    style={{
                      background: "none",
                      border: "none",
                      padding: "2px",
                      color: "var(--text-muted)",
                      display: "inline-flex",
                      alignItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                </>
              )}
            </div>
            <span
              data-tooltip={connected ? "Connected" : "Disconnected"}
              style={{
                width: 8, height: 8, borderRadius: "50%",
                background: connected ? "#4d9375" : "#9b9a97",
                display: "inline-block",
              }}
            />
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
              {meta && meta.context_limit > 0 && (
                <ContextDonut tokens={meta.context_tokens} limit={meta.context_limit} />
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  onClick={archiveConversation}
                  data-tooltip="Archive conversation"
                  aria-label="Archive conversation"
                  style={{
                    ...headerIconBtnStyle,
                    color: "var(--text-muted)",
                  }}
                  onMouseEnter={headerHoverIn}
                  onMouseLeave={headerHoverOut}
                >
                  <Archive size={15} />
                </button>
                <button
                  onClick={toggleAutonomy}
                  disabled={savingAutonomy}
                  data-tooltip={autonomousToolsEnabled ? "Disable auto mode" : "Enable auto mode"}
                  style={{
                    ...headerIconBtnStyle,
                    background: autonomousToolsEnabled ? "rgba(77, 147, 117, 0.12)" : "var(--bg-surface)",
                    border: autonomousToolsEnabled ? "1px solid rgba(77, 147, 117, 0.35)" : "1px solid var(--border)",
                    color: autonomousToolsEnabled ? "var(--accent)" : "var(--text-muted)",
                    cursor: savingAutonomy ? "default" : "pointer",
                    opacity: savingAutonomy ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => { if (!savingAutonomy && !autonomousToolsEnabled) headerHoverIn(e); }}
                  onMouseLeave={(e) => { if (!autonomousToolsEnabled) headerHoverOut(e); }}
                >
                  <Sparkles size={15} />
                </button>
                <button
                  onClick={panel.toggleFileFinder}
                  data-tooltip="Find file (⌘P)"
                  style={{
                    ...headerIconBtnStyle,
                    color: "var(--text-muted)",
                  }}
                  onMouseEnter={headerHoverIn}
                  onMouseLeave={headerHoverOut}
                >
                  <FolderOpen size={15} />
                </button>
                {panel.file && (
                  <button
                    onClick={() => navigate(`/${projectId}/file?path=${encodeURIComponent(panel.file!.path)}`)}
                    data-tooltip="File only"
                    style={{
                      ...headerIconBtnStyle,
                      color: "var(--text-muted)",
                    }}
                    onMouseEnter={headerHoverIn}
                    onMouseLeave={headerHoverOut}
                  >
                    <FileText size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        </div>

        {/* Messages */}
        <ChatMessages
          projectId={projectId}
          messages={messages}
          streamBlocks={streamBlocks}
          activeAgent={activeAgent}
          connected={connected}
          waitingForModel={waitingForModel}
          error={error}
          voiceError={voiceError}
          hasMoreHistory={hasMoreHistory}
          loadingOlder={loadingOlder}
          bottomSlackPx={bottomSlackPx}
          autonomousToolsEnabled={autonomousToolsEnabled}
          messageListRef={messageListRef}
          pendingScrollMessageIdRef={pendingScrollMessageIdRef}
          lastSentMessageRef={lastSentMessageRef}
          latestUserMessageRef={latestUserMessageRef}
          onLoadOlderHistory={() => { void loadOlderHistory(); }}
          onOpenFile={handleOpenFile}
          onToolApproval={handleToolApproval}
          resend={resend}
        />

        {/* Input */}
        <ChatComposer
          input={input}
          setInput={setInput}
          busy={busy}
          connected={connected}
          uploadingAttachments={uploadingAttachments}
          composerAttachments={composerAttachments}
          addComposerFiles={addComposerFiles}
          removeComposerAttachment={removeComposerAttachment}
          sendText={sendText}
          voiceUiActive={voiceUiActive}
          voiceStatusText={voiceStatusText}
          voiceElapsedSec={voiceElapsedSec}
          stopVoiceCapture={stopVoiceCapture}
          startVoiceCapture={startVoiceCapture}
          stop={stop}
          agents={agents}
          projectFiles={projectFiles}
          skills={skills}
          refreshMentionFiles={refreshMentionFiles}
        />
      </div>

      {/* Resize handle + File panel */}
      {panel.file && (
        <>
        <div
          onMouseDown={onDragStart}
          style={{
            width: `${PANEL_RESIZE_HIT_WIDTH}px`,
            marginLeft: `${-Math.floor(PANEL_RESIZE_HIT_WIDTH / 2)}px`,
            marginRight: `${-Math.floor(PANEL_RESIZE_HIT_WIDTH / 2)}px`,
            cursor: "col-resize",
            background: "transparent",
            flexShrink: 0,
            position: "relative",
            zIndex: 10,
            touchAction: "none",
          }}
          onMouseEnter={(e) => {
            if (!panelResizeActive) e.currentTarget.style.background = "transparent";
          }}
          onMouseLeave={(e) => {
            if (!dragging.current && !panelResizeActive) e.currentTarget.style.background = "transparent";
          }}
        >
          <div style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `calc(50% - ${PANEL_RESIZE_VISIBLE_WIDTH / 2}px)`,
            width: `${PANEL_RESIZE_VISIBLE_WIDTH}px`,
            borderRadius: 999,
            background: panelResizeActive
              ? "color-mix(in srgb, var(--accent) 55%, var(--border))"
              : "var(--border)",
            opacity: panelResizeActive ? 1 : 0.45,
            boxShadow: panelResizeActive ? "0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent)" : "none",
          }} />
        </div>
        <div
          className="artifact-panel-wrap"
          style={{
            width: `${panelWidth}px`,
            flexShrink: 0,
            height: "calc(var(--vh, 1vh) * 100)",
            overflow: "hidden",
            pointerEvents: panelResizeActive ? "none" : undefined,
          }}
        >
          <FilePanel
            file={panel.file}
            editMode={panel.editMode}
            dirty={panel.dirty}
            saving={panel.saving}
            saveError={panel.saveError}
            externalChange={panel.externalChange}
            onToggleEdit={handleToggleEdit}
            onContentChange={panel.updateContent}
            onSave={panel.saveFile}
            onCancel={panel.cancelEdit}
            onClose={handleClosePanel}
            onReload={panel.reloadFile}
            onDismissExternal={panel.dismissExternalChange}
            onOpenFileFinder={panel.toggleFileFinder}
          />
        </div>
        </>
      )}

      {/* File finder overlay */}
      {panel.showFileFinder && (
        <FileFinder
          files={panel.fileList || []}
          loading={panel.fileListLoading}
          touchedFiles={touchedFiles}
          onSelect={handleOpenFile}
          onClose={panel.toggleFileFinder}
        />
      )}
    </div>
  );
}
