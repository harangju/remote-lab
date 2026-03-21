import React from "react";
import { Link } from "react-router-dom";
import { Archive, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Leaf, TreePine, Flower2, Fish, Bird, Wheat, Sprout, Rabbit, Turtle, Squirrel, Grape, Citrus, Bug, Shell, Orbit, Mountain, Waves, CloudSun, Snowflake, Flame, Gem, Feather } from "lucide-react";
import type { ConvoMeta } from "../api";
import { btnIcon, colors } from "../styles";

const headerIconBtnStyle: React.CSSProperties = {
  ...btnIcon,
  cursor: "pointer",
};

const railIdentityIcons = [
  Leaf,
  TreePine,
  Flower2,
  Fish,
  Bird,
  Wheat,
  Sprout,
  Rabbit,
  Turtle,
  Squirrel,
  Grape,
  Citrus,
  Bug,
  Shell,
  Orbit,
  Mountain,
  Waves,
  CloudSun,
  Snowflake,
  Flame,
  Gem,
  Feather,
];

function railIdentityIcon(convoId: string) {
  let hash = 0;
  for (let i = 0; i < convoId.length; i += 1) hash = (hash * 31 + convoId.charCodeAt(i)) >>> 0;
  return railIdentityIcons[hash % railIdentityIcons.length] || Leaf;
}

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

function headerHoverIn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = colors.bgSurfaceHover;
}

function headerHoverOut(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = colors.bgSurface;
}

export function ChatConvoRail({
  railWidth,
  railCollapsed,
  rowHeight,
  projectId,
  convId,
  visibleConvos,
  panelFilePath,
  archivingConvoId,
  onToggleCollapsed,
  onNewConversation,
  onNavigateConvo,
  onArchiveConvo,
}: {
  railWidth: number;
  railCollapsed: boolean;
  rowHeight: number;
  projectId?: string;
  convId?: string;
  visibleConvos: ConvoMeta[];
  panelFilePath?: string | null;
  archivingConvoId: string | null;
  onToggleCollapsed: () => void;
  onNewConversation: () => void;
  onNavigateConvo: (convoId: string) => void;
  onArchiveConvo: (convoId: string) => void;
}) {
  return (
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
          onClick={onToggleCollapsed}
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
          onClick={onNewConversation}
          aria-label="New chat"
          data-tooltip={railCollapsed ? "New chat" : undefined}
          style={{
            width: "100%",
            height: `${rowHeight}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "0 12px",
            borderRadius: "10px",
            border: `1px solid ${colors.border}`,
            background: colors.bgSurface,
            color: colors.text,
            fontSize: "0.84rem",
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
          onMouseEnter={headerHoverIn}
          onMouseLeave={headerHoverOut}
        >
          <span style={{ width: 18, minWidth: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <MessageSquarePlus size={16} strokeWidth={2} />
          </span>
          {!railCollapsed && <span style={{ whiteSpace: "nowrap" }}>New chat</span>}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: railCollapsed ? "8px 6px" : "8px" }}>
        {visibleConvos.map((convo) => {
          const tone = railStatusTone(convo);
          const statusColor = railStatusColor(tone);
          const isActive = convo.id === convId;
          const IdentityIcon = railIdentityIcon(convo.id);
          const isArchived = Boolean(convo.archived_at);
          const sublabel = isArchived
            ? "archived"
            : convo.status === "running"
              ? "running"
              : timeAgo(convo.last_event_at || convo.updated_at);
          return (
            <div
              key={convo.id}
              style={{ position: "relative", marginBottom: "4px", height: `${rowHeight}px` }}
              className={!railCollapsed && !isActive ? "chat-convo-rail-row" : undefined}
            >
              <button
                onClick={() => onNavigateConvo(convo.id)}
                aria-label={convo.title || "Untitled conversation"}
                title={railCollapsed ? (convo.title || "Untitled") : undefined}
                style={{
                  width: "100%",
                  height: "100%",
                  minHeight: `${rowHeight}px`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: undefined,
                  gap: "10px",
                  padding: railCollapsed ? "0 10px" : "0 36px 0 10px",
                  borderRadius: "10px",
                  border: "none",
                  background: isActive ? colors.bgSurface : "transparent",
                  color: colors.text,
                  textAlign: "left",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <span style={{ width: 18, minWidth: 18, position: "relative", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <IdentityIcon size={16} style={{ color: isActive ? colors.text : colors.textMuted, flexShrink: 0, opacity: isArchived ? 0.7 : 1 }} />
                  <span style={{ position: "absolute", top: -1, right: -2, width: 7, height: 7, borderRadius: "50%", background: isArchived ? colors.textMuted : statusColor, boxShadow: `0 0 0 2px ${isActive ? colors.bgSurface : colors.bg}` }} />
                </span>
                {!railCollapsed && (
                  <span style={{ minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px", overflow: "hidden" }}>
                    <span style={{ fontSize: "0.84rem", fontWeight: isActive ? 600 : 500, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {convo.title || "Untitled"}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: isArchived ? colors.textMuted : statusColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: "lowercase" }}>
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
                    onArchiveConvo(convo.id);
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
  );
}
