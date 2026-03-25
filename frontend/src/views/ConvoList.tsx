import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Archive, ArchiveRestore, MessageSquare, FolderOpen, Pencil } from "lucide-react";
import { FileFinder } from "../components/FileFinder";
import { createConvo, getProject, listConvos, listFiles, updateConvo, updateProject, type ConvoMeta, type Project } from "../api";
import { btnIcon, colors, input as inputStyle } from "../styles";

const iconBtnStyle: React.CSSProperties = {
  ...btnIcon,
  cursor: "pointer",
};

function hoverIn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = colors.bgSurfaceHover;
}

function hoverOut(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = colors.bgSurface;
}

const statusColors: Record<string, string> = {
  running: "#d4a030",
  error: "#cf4b6e",
  done: "#3ba776",
  idle: colors.textMuted,
};

function ConvoRow({ convo, projectId, dimmed, onAction, actionIcon, actionLabel }: {
  convo: ConvoMeta;
  projectId: string;
  dimmed?: boolean;
  onAction: () => void;
  actionIcon: React.ReactNode;
  actionLabel: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.bgSurface, opacity: dimmed ? 0.7 : 1 }}>
      <span style={{ width: 7, height: 7, minWidth: 7, borderRadius: 999, background: statusColors[convo.status] || statusColors.idle }} />
      <Link
        to={`/${projectId}/${convo.id}`}
        style={{ flex: 1, minWidth: 0, color: colors.text, textDecoration: "none", display: "flex", flexDirection: "column", gap: 2 }}
      >
        <span style={{ fontSize: "0.88rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{convo.title || "Untitled"}</span>
        <span style={{ fontSize: "0.75rem", color: colors.textMuted }}>{new Date(convo.updated_at).toLocaleDateString()}</span>
      </Link>
      <button
        onClick={onAction}
        aria-label={actionLabel}
        title={actionLabel}
        className="nav-icon-btn"
        style={{ ...iconBtnStyle, color: colors.textMuted }}
      >
        {actionIcon}
      </button>
    </div>
  );
}

export function ConvoList() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [projectNameValue, setProjectNameValue] = useState("");
  const [activeConvos, setActiveConvos] = useState<ConvoMeta[]>([]);
  const [archivedConvos, setArchivedConvos] = useState<ConvoMeta[]>([]);
  const [showFileFinder, setShowFileFinder] = useState(false);
  const [fileList, setFileList] = useState<string[] | null>(null);
  const [fileListLoading, setFileListLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([getProject(projectId), listConvos(projectId)])
      .then(([p, convos]) => {
        if (!cancelled) {
          setProject(p);
          setActiveConvos(convos.filter((c) => !c.archived_at));
          setArchivedConvos(convos.filter((c) => !!c.archived_at));
          setError(null);
        }
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.message || "Failed to load project");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const refreshFileList = React.useCallback(() => {
    if (!projectId) return;
    setFileListLoading(true);
    listFiles(projectId, { hidden: true })
      .then((res) => setFileList(res.files))
      .catch(() => setFileList([]))
      .finally(() => setFileListLoading(false));
  }, [projectId]);

  const toggleFileFinder = React.useCallback(() => {
    if (!fileList && !fileListLoading) refreshFileList();
    setShowFileFinder((v) => !v);
  }, [fileList, fileListLoading, refreshFileList]);

  const handleNewConversation = React.useCallback(async () => {
    if (!projectId) return;
    try {
      const convo = await createConvo(projectId);
      navigate(`/${projectId}/${convo.id}`);
    } catch (e: any) {
      setError(e.message || "Failed to create conversation");
    }
  }, [navigate, projectId]);

  const handleArchiveConvo = useCallback(async (convoId: string) => {
    try {
      const updated = await updateConvo(convoId, { archived_at: new Date().toISOString() });
      setActiveConvos((prev) => prev.filter((c) => c.id !== convoId));
      setArchivedConvos((prev) => [updated, ...prev]);
    } catch (e: any) {
      setError(e.message || "Failed to archive conversation");
    }
  }, []);

  const handleRestoreConvo = useCallback(async (convoId: string) => {
    try {
      const updated = await updateConvo(convoId, { archived_at: null });
      setArchivedConvos((prev) => prev.filter((c) => c.id !== convoId));
      setActiveConvos((prev) => [updated, ...prev]);
    } catch (e: any) {
      setError(e.message || "Failed to restore conversation");
    }
  }, []);

  const saveProjectRename = async () => {
    const trimmed = projectNameValue.trim();
    if (!trimmed || !projectId) {
      setEditingProject(false);
      return;
    }
    try {
      const updated = await updateProject(projectId, { name: trimmed });
      setProject(updated);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to rename project");
    } finally {
      setEditingProject(false);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "1.5rem", gap: "1rem", maxWidth: 760, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {editingProject ? (
            <input
              autoFocus
              value={projectNameValue}
              onChange={(e) => setProjectNameValue(e.target.value)}
              onBlur={saveProjectRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveProjectRename();
                if (e.key === "Escape") setEditingProject(false);
              }}
              style={{ ...inputStyle, fontSize: "1.5rem", fontWeight: 600, padding: "4px 8px", maxWidth: 320 }}
            />
          ) : (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: "1.5rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {loading ? "Loading…" : project?.name || "Project"}
              </h1>
              {project && (
                <button
                  onClick={() => {
                    setProjectNameValue(project.name);
                    setEditingProject(true);
                  }}
                  style={{ background: "none", border: "none", color: colors.textMuted, padding: 2, display: "inline-flex" }}
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>
          )}
          <p style={{ margin: "6px 0 0", color: colors.textMuted, fontSize: "0.92rem" }}>
            Open chats from the navigator on the left. Use these actions for quick starts in this project.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={toggleFileFinder} style={iconBtnStyle} data-tooltip="Open file" onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
            <FolderOpen size={16} />
          </button>
          <button onClick={() => { void handleNewConversation(); }} style={iconBtnStyle} data-tooltip="New conversation" onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
            <MessageSquare size={16} />
          </button>
        </div>
      </div>

      {error && <div style={{ color: colors.textMuted, fontSize: "0.85rem" }}>Error: {error}</div>}

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
        {activeConvos.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textMuted, fontWeight: 600 }}>Chats</div>
            {activeConvos.map((convo) => (
              <ConvoRow key={convo.id} convo={convo} projectId={projectId!} onAction={() => { void handleArchiveConvo(convo.id); }} actionIcon={<Archive size={14} />} actionLabel="Archive chat" />
            ))}
          </div>
        )}
        {archivedConvos.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textMuted, fontWeight: 600 }}>Archived</div>
            {archivedConvos.map((convo) => (
              <ConvoRow key={convo.id} convo={convo} projectId={projectId!} dimmed onAction={() => { void handleRestoreConvo(convo.id); }} actionIcon={<ArchiveRestore size={14} />} actionLabel="Restore chat" />
            ))}
          </div>
        )}
        {activeConvos.length === 0 && archivedConvos.length === 0 && !loading && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", border: `1px dashed ${colors.border}`, borderRadius: 16, background: colors.bgSurface, padding: "2rem" }}>
            <div style={{ maxWidth: 420, textAlign: "center" }}>
              <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 8 }}>No chats yet</div>
              <div style={{ color: colors.textMuted, fontSize: "0.92rem", lineHeight: 1.6 }}>
                Start a new conversation to get going.
              </div>
            </div>
          </div>
        )}
      </div>

      {showFileFinder && (
        <FileFinder
          files={fileList || []}
          loading={fileListLoading}
          touchedFiles={[]}
          onSelect={(path) => {
            navigate(`/${projectId}/file?path=${encodeURIComponent(path)}`);
            setShowFileFinder(false);
          }}
          onClose={toggleFileFinder}
        />
      )}
    </div>
  );
}
