import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { FileText, Pencil, FolderOpen, Sparkles, Archive, MessageSquarePlus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { listConvos, createConvo, updateConvo, type ConvoMeta } from "../api";
import { btnIcon, colors, input as inputStyle } from "../styles";
import { FilePanel } from "../components/FilePanel";
import { FileFinder } from "../components/FileFinder";
import { usePanel } from "../hooks/usePanel";
import { extractFilePath } from "../chatUi";
import { ChatComposer } from "../chatComposer";
import { ChatMessages } from "../chatMessages";
import { useChatSession } from "../hooks/useChatSession";

const headerIconBtnStyle: React.CSSProperties = {
  ...btnIcon,
  cursor: "pointer",
};

function headerHoverIn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = colors.bgSurfaceHover;
}

function headerHoverOut(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = colors.bgSurface;
}

function formatTokenCount(value: number, digits = 1): string {
  if (value >= 1_000_000) return `${parseFloat((value / 1_000_000).toFixed(digits))}m`;
  if (value >= 1_000) return `${parseFloat((value / 1_000).toFixed(digits))}k`;
  return `${value}`;
}

function ContextDonut({ tokens, limit }: { tokens: number; limit: number }) {
  if (!limit) return null;
  const pct = Math.min(tokens / limit, 1);
  const r = 7;
  const circ = 2 * Math.PI * r;
  const filled = circ * pct;
  const color = pct > 0.8 ? colors.warning : colors.textMuted;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", cursor: "default" }} data-tooltip={`${formatTokenCount(tokens)} / ${formatTokenCount(limit, 0)} tokens (${Math.round(pct * 100)}%)`}>
      <svg width="18" height="18" viewBox="0 0 18 18" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="9" cy="9" r={r} fill="none" stroke={colors.border} strokeWidth="2.5" />
        <circle cx="9" cy="9" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round" />
      </svg>
    </div>
  );
}

const CHAT_HEADER_MAX_WIDTH = "72rem";
const CONVO_RAIL_WIDTH = 240;
const CONVO_RAIL_COLLAPSED_WIDTH = 52;
const CHAT_CONVO_RAIL_COLLAPSED_STORAGE_KEY = "remote-lab:chat-convo-rail-collapsed";
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH_RATIO = 0.75;
const PANEL_DEFAULT_WIDTH_RATIO = 0.36;
const PANEL_RESIZE_HIT_WIDTH = 14;
const PANEL_RESIZE_VISIBLE_WIDTH = 4;
const PANEL_RESIZE_ACTIVATION_DELTA = 3;
const CHAT_PANEL_RATIO_STORAGE_KEY = "remote-lab:chat-panel-width-ratio";

type RailStatusTone = "running" | "done" | "error" | "idle";

function timeAgo(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "recently";
  const diff = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "1m ago";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function railStatusTone(convo: ConvoMeta): RailStatusTone {
  if (convo.status === "running") return "running";
  if (convo.status === "error") return "error";
  if (convo.status === "done") return "done";
  return "idle";
}

function railStatusColor(tone: RailStatusTone): string {
  if (tone === "running") return colors.badgeRunning;
  if (tone === "error") return colors.badgeError;
  if (tone === "done") return colors.badgeDone;
  return colors.badgeIdle;
}

export function Chat() {
  const { projectId, convId } = useParams<{ projectId: string; convId: string }>();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [projectConvos, setProjectConvos] = useState<ConvoMeta[]>([]);
  const [archivingConvoId, setArchivingConvoId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(CHAT_CONVO_RAIL_COLLAPSED_STORAGE_KEY) === "true";
  });
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
  } = useChatSession(projectId, convId);

  const syncFileQuery = useCallback((path: string | null, replace = false) => {
    if (!projectId || !convId) return;
    navigate(path ? `/${projectId}/${convId}?path=${encodeURIComponent(path)}` : `/${projectId}/${convId}`, { replace });
  }, [convId, navigate, projectId]);

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
  }, [panel.file?.path, panel.dirty, panel.openFile, panel.forceClose, projectId, convId, navigate, setInput]);

  const handleOpenFile = useCallback((path: string) => {
    if (panel.dirty && !window.confirm("You have unsaved changes. Discard and open another file?")) return;
    syncFileQuery(path);
    panel.openFile(path);
  }, [panel.dirty, panel.openFile, syncFileQuery]);

  const handleClosePanel = useCallback(() => {
    if (panel.dirty && !window.confirm("You have unsaved changes. Discard?")) return;
    syncFileQuery(null);
    panel.forceClose();
  }, [panel.dirty, panel.forceClose, syncFileQuery]);

  const handleToggleEdit = useCallback(() => {
    if (panel.editMode && panel.dirty) {
      if (!window.confirm("You have unsaved changes. Discard?")) return;
      panel.cancelEdit();
    } else {
      panel.setEditMode(!panel.editMode);
    }
  }, [panel.dirty, panel.editMode, panel.cancelEdit, panel.setEditMode]);

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
  }, [convId, navigate, projectId, setError]);

  const handleNewConversation = useCallback(async () => {
    if (!projectId) return;
    try {
      const convo = await createConvo(projectId);
      navigate(`/${projectId}/${convo.id}`);
    } catch (e: any) {
      setError(e.message || "Failed to create conversation");
    }
  }, [navigate, projectId, setError]);

  const archiveConvoFromRail = useCallback(async (targetConvoId: string) => {
    try {
      setArchivingConvoId(targetConvoId);
      await updateConvo(targetConvoId, { archived_at: new Date().toISOString() });
      setProjectConvos((prev) => prev.filter((convo) => convo.id !== targetConvoId));
    } catch (e: any) {
      setError(e.message || "Failed to archive conversation");
    } finally {
      setArchivingConvoId((current) => (current === targetConvoId ? null : current));
    }
  }, [setError]);

  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CHAT_CONVO_RAIL_COLLAPSED_STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const primaryMod = e.metaKey || e.ctrlKey;
      if (primaryMod && !e.shiftKey && key === "p") {
        e.preventDefault();
        panel.toggleFileFinder();
        return;
      }
      if (primaryMod && e.shiftKey && key === "m") {
        e.preventDefault();
        void handleNewConversation();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNewConversation, panel.toggleFileFinder]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    const loadConvos = async () => {
      try {
        const next = await listConvos(projectId);
        const normalized = next.map((convo) => ({
          ...convo,
          last_event_at: convo.last_event_at || convo.updated_at,
        }));
        if (!cancelled) setProjectConvos(normalized.filter((convo) => !convo.archived_at));
      } catch {}
    };

    void loadConvos();
    const interval = window.setInterval(() => {
      if (!document.hidden) void loadConvos();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectId]);

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
    const onMouseMove = (event: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX - event.clientX;
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

  const visibleConvos = useMemo(() => projectConvos.slice(0, 12), [projectConvos]);
  const railWidth = railCollapsed ? CONVO_RAIL_COLLAPSED_WIDTH : CONVO_RAIL_WIDTH;

  return (
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden" }}>
      <div style={{
        width: `${railWidth}px`,
        flexShrink: 0,
        borderRight: `1px solid ${colors.border}`,
        background: colors.bg,
        display: "none",
        flexDirection: "column",
        minWidth: 0,
        transition: "width 140ms ease",
      }} className="chat-convo-rail">
        <div style={{ padding: railCollapsed ? "8px" : "8px 12px", height: "52px", borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", justifyContent: railCollapsed ? "center" : "space-between", gap: "8px", boxSizing: "border-box" }}>
          {!railCollapsed && <div style={{ fontSize: "0.78rem", fontWeight: 600, color: colors.textMuted }}>Chats</div>}
          <button
            onClick={toggleRailCollapsed}
            aria-label={railCollapsed ? "Expand chats" : "Collapse chats"}
            style={{ ...headerIconBtnStyle, color: colors.textMuted, flexShrink: 0 }}
            onMouseEnter={headerHoverIn}
            onMouseLeave={headerHoverOut}
          >
            {railCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
        <div style={{ padding: railCollapsed ? "8px 6px" : "8px", borderBottom: `1px solid ${colors.border}` }}>
          <button
            onClick={() => { void handleNewConversation(); }}
            aria-label="New chat"
            data-tooltip={railCollapsed ? "New chat" : undefined}
            style={railCollapsed ? {
              ...headerIconBtnStyle,
              width: "100%",
            } : {
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "10px 12px",
              borderRadius: "10px",
              border: `1px solid ${colors.border}`,
              background: colors.bgSurface,
              color: colors.text,
              fontSize: "0.84rem",
              fontWeight: 500,
            }}
            onMouseEnter={railCollapsed ? headerHoverIn : undefined}
            onMouseLeave={railCollapsed ? headerHoverOut : undefined}
          >
            <MessageSquarePlus size={15} />
            {!railCollapsed && <span>New chat</span>}
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: railCollapsed ? "8px 6px" : "8px" }}>
          {visibleConvos.map((convo) => {
            const tone = railStatusTone(convo);
            const statusColor = railStatusColor(tone);
            const isActive = convo.id === convId;
            const sublabel = convo.status === "running"
              ? "running"
              : timeAgo(convo.last_event_at || convo.updated_at);
            return (
              <div
                key={convo.id}
                style={{ position: "relative", marginBottom: "4px" }}
                className={!railCollapsed && !isActive ? "chat-convo-rail-row" : undefined}
              >
                <button
                  onClick={() => navigate(`/${projectId}/${convo.id}${panel.file ? `?path=${encodeURIComponent(panel.file.path)}` : ""}`)}
                  aria-label={convo.title || "Untitled conversation"}
                  title={railCollapsed ? (convo.title || "Untitled") : undefined}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: railCollapsed ? "center" : "flex-start",
                    justifyContent: railCollapsed ? "center" : undefined,
                    gap: railCollapsed ? 0 : "10px",
                    padding: railCollapsed ? "10px 0" : "10px 36px 10px 10px",
                    borderRadius: "10px",
                    border: "none",
                    background: isActive ? colors.bgSurface : "transparent",
                    color: colors.text,
                    textAlign: railCollapsed ? "center" : "left",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, flexShrink: 0, marginTop: railCollapsed ? 0 : 5 }} />
                  {!railCollapsed && (
                    <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontSize: "0.84rem", fontWeight: isActive ? 600 : 500, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {convo.title || "Untitled"}
                      </span>
                      <span style={{ fontSize: "0.72rem", color: statusColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: "lowercase" }}>
                        {sublabel}
                      </span>
                    </span>
                  )}
                </button>
                {!railCollapsed && !isActive && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void archiveConvoFromRail(convo.id);
                    }}
                    disabled={archivingConvoId === convo.id}
                    aria-label="Archive chat"
                    style={{
                      ...headerIconBtnStyle,
                      position: "absolute",
                      top: "50%",
                      right: "8px",
                      transform: "translateY(-50%)",
                      opacity: archivingConvoId === convo.id ? 0.65 : 0,
                      transition: "opacity 140ms ease",
                    }}
                    className="chat-convo-rail-archive"
                    onMouseEnter={headerHoverIn}
                    onMouseLeave={headerHoverOut}
                  >
                    <Archive size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <div style={{ borderBottom: `1px solid ${colors.border}`, flexShrink: 0, position: "relative", zIndex: 2 }}>
          <div style={{ padding: "8px 1.5rem", minHeight: "51px", maxWidth: CHAT_HEADER_MAX_WIDTH, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <Link to={`/${projectId}`} style={{ ...headerIconBtnStyle, color: colors.textMuted, textDecoration: "none" }} data-tooltip="Conversations" aria-label="Conversations" onMouseEnter={headerHoverIn} onMouseLeave={headerHoverOut}>
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
                    style={{ ...inputStyle, fontWeight: 600, fontSize: "1rem", borderRadius: "4px", padding: "1px 6px", minWidth: 0, maxWidth: "20rem" }}
                  />
                ) : (
                  <>
                    <span title={title} style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                    <button onClick={startEdit} data-tooltip="Rename" style={{ background: "none", border: "none", padding: "2px", color: colors.textMuted, display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                      <Pencil size={14} />
                    </button>
                  </>
                )}
              </div>
              <span data-tooltip={connected ? "Connected" : "Disconnected"} style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? colors.success : colors.textMuted, display: "inline-block" }} />
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                {meta && meta.context_limit > 0 && <ContextDonut tokens={meta.context_tokens} limit={meta.context_limit} />}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button onClick={archiveConversation} data-tooltip="Archive conversation" aria-label="Archive conversation" style={{ ...headerIconBtnStyle, color: colors.textMuted }} onMouseEnter={headerHoverIn} onMouseLeave={headerHoverOut}>
                    <Archive size={15} />
                  </button>
                  <button
                    onClick={toggleAutonomy}
                    disabled={savingAutonomy}
                    data-tooltip={autonomousToolsEnabled ? "Disable auto mode" : "Enable auto mode"}
                    style={{
                      ...headerIconBtnStyle,
                      background: autonomousToolsEnabled ? colors.successSoft : colors.bgSurface,
                      border: autonomousToolsEnabled ? `1px solid color-mix(in srgb, ${colors.success} 35%, ${colors.border})` : `1px solid ${colors.border}`,
                      color: autonomousToolsEnabled ? colors.accent : colors.textMuted,
                      cursor: savingAutonomy ? "default" : "pointer",
                      opacity: savingAutonomy ? 0.6 : 1,
                    }}
                    onMouseEnter={(e) => { if (!savingAutonomy && !autonomousToolsEnabled) headerHoverIn(e); }}
                    onMouseLeave={(e) => { if (!autonomousToolsEnabled) headerHoverOut(e); }}
                  >
                    <Sparkles size={15} />
                  </button>
                  <button onClick={panel.toggleFileFinder} data-tooltip="Find file (⌘P)" style={{ ...headerIconBtnStyle, color: colors.textMuted }} onMouseEnter={headerHoverIn} onMouseLeave={headerHoverOut}>
                    <FolderOpen size={15} />
                  </button>
                  {panel.file && (
                    <button onClick={() => navigate(`/${projectId}/file?path=${encodeURIComponent(panel.file.path)}`)} data-tooltip="File only" style={{ ...headerIconBtnStyle, color: colors.textMuted }} onMouseEnter={headerHoverIn} onMouseLeave={headerHoverOut}>
                      <FileText size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

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

      {panel.file && (
        <>
          <div
            onMouseDown={onDragStart}
            style={{ width: `${PANEL_RESIZE_HIT_WIDTH}px`, marginLeft: `${-Math.floor(PANEL_RESIZE_HIT_WIDTH / 2)}px`, marginRight: `${-Math.floor(PANEL_RESIZE_HIT_WIDTH / 2)}px`, cursor: "col-resize", background: "transparent", flexShrink: 0, position: "relative", zIndex: 10, touchAction: "none" }}
          >
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(50% - ${PANEL_RESIZE_VISIBLE_WIDTH / 2}px)`, width: `${PANEL_RESIZE_VISIBLE_WIDTH}px`, borderRadius: 999, background: panelResizeActive ? `color-mix(in srgb, ${colors.accent} 55%, ${colors.border})` : colors.border, opacity: panelResizeActive ? 1 : 0.45, boxShadow: panelResizeActive ? `0 0 0 1px color-mix(in srgb, ${colors.accent} 22%, transparent)` : "none" }} />
          </div>
          <div className="artifact-panel-wrap" style={{ width: `${panelWidth}px`, flexShrink: 0, height: "calc(var(--vh, 1vh) * 100)", overflow: "hidden", pointerEvents: panelResizeActive ? "none" : undefined }}>
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

      {panel.showFileFinder && <FileFinder files={panel.fileList || []} loading={panel.fileListLoading} touchedFiles={touchedFiles} onSelect={handleOpenFile} onClose={panel.toggleFileFinder} />}
    </div>
  );
}
