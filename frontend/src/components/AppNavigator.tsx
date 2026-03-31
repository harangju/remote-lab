import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive, ArchiveRestore, Atom, Beaker, ChevronDown, ChevronRight, Compass,
  Cpu, Diamond, Flame, FlaskConical, FolderPlus, Gem, Globe, Hexagon, Leaf,
  Lightbulb, MessageSquarePlus, Microscope, Mountain, Orbit, PanelLeftClose,
  PanelLeftOpen, Rocket, Shell, Sparkles, Star, Target, Telescope, Terminal,
  TreePine, Waves, X, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createConvo, createProject, listConvos, listProjects, updateConvo, updateProject, type ConvoMeta, type Project } from "../api";
import { btnIcon, btnPrimary, colors, input as inputStyle, zIndex } from "../styles";
import { createPortal } from "react-dom";

const MOBILE_BREAKPOINT = 768;
const RAIL_WIDTH = 300;
const EXPANDED_STORAGE_KEY = "remote-lab:nav-expanded-projects";

const iconBtnStyle: React.CSSProperties = {
  ...btnIcon,
  cursor: "pointer",
};

// Deterministic lucide icons for projects
const projectIconSet: LucideIcon[] = [
  Beaker, Telescope, Target, Rocket, Lightbulb, Waves, TreePine,
  Gem, Sparkles, FlaskConical, Atom, Globe, Compass, Flame, Leaf,
  Mountain, Orbit, Shell, Diamond, Hexagon, Zap, Star, Cpu,
  Microscope, Terminal,
];

const statusColors: Record<string, string> = {
  running: "#d4a030",
  error: "#cf4b6e",
  done: "#3ba776",
  idle: colors.textMuted,
};

function timeAgo(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "recent";
  const diff = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isUrl(s: string) {
  return /^(https?:\/\/|git@)/.test(s.trim());
}

function repoNameFromUrl(url: string): string {
  const match = url.trim().replace(/\.git$/, "").match(/[/:]([^/:]+)$/);
  return match ? match[1] : "";
}

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
}

function getProjectIcon(projectId: string): LucideIcon {
  return projectIconSet[hashId(projectId) % projectIconSet.length];
}

function statusColor(status: string): string {
  return statusColors[status] || statusColors.idle;
}

function ProjectBadge({ project }: { project: Project }) {
  const Icon = getProjectIcon(project.id);
  return (
    <span style={{ width: 20, height: 20, minWidth: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", color: colors.textMuted, flexShrink: 0 }}>
      <Icon size={15} />
    </span>
  );
}

function IconButton({ onClick, label, title, disabled, children, style: extraStyle }: {
  onClick: (e: React.MouseEvent) => void;
  label: string;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className="nav-icon-btn"
      style={{ ...iconBtnStyle, width: 28, height: 28, minWidth: 28, minHeight: 28, color: colors.textMuted, ...extraStyle }}
    >
      {children}
    </button>
  );
}

function RailTooltip({ text, children }: { text: string; children: React.ReactElement }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onMouseEnter={() => { if (ref.current) setRect(ref.current.getBoundingClientRect()); }}
      onMouseLeave={() => setRect(null)}
    >
      {children}
      {rect && createPortal(
        <div style={{ position: "fixed", top: rect.top + rect.height / 2, left: rect.right + 8, transform: "translateY(-50%)", padding: "4px 10px", background: colors.text, color: colors.bg, fontSize: "0.72rem", whiteSpace: "nowrap", borderRadius: 5, pointerEvents: "none", zIndex: zIndex.tooltip }}>
          {text}
        </div>,
        document.body,
      )}
    </div>
  );
}

function ConvoRow({ convo, projectId, active, onClickLink, onArchive }: { convo: ConvoMeta; projectId: string; active: boolean; onClickLink: () => void; onArchive?: () => void }) {
  return (
    <div className="convo-row" style={{ display: "flex", alignItems: "center", borderRadius: 8, background: active ? colors.bgSurfaceHover : "transparent" }}>
      <Link
        to={`/${projectId}/${convo.id}`}
        onClick={onClickLink}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px 7px 12px", flex: 1, minWidth: 0, color: colors.text, textDecoration: "none" }}
      >
        <span style={{ width: 7, height: 7, minWidth: 7, borderRadius: 999, background: statusColor(convo.status), opacity: active ? 1 : 0.7 }} />
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: active ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{convo.title || "Untitled"}</span>
          <span style={{ fontSize: "0.7rem", color: colors.textMuted }}>{timeAgo(convo.last_event_at || convo.updated_at)}</span>
        </span>
      </Link>
      {onArchive && (
        <button
          className="convo-archive nav-icon-btn"
          onClick={onArchive}
          aria-label="Archive chat"
          title="Archive chat"
          style={{ ...iconBtnStyle, width: 26, height: 26, minWidth: 26, minHeight: 26, color: colors.textMuted, marginRight: 6, transition: "opacity 100ms ease" }}
        >
          <Archive size={13} />
        </button>
      )}
    </div>
  );
}

function ProjectCard({ project, convos, expanded, active, activeConvId, dimmed, actions, onToggleExpand, onClickLink, onArchiveConvo }: {
  project: Project;
  convos: ConvoMeta[] | null;
  expanded: boolean;
  active: boolean;
  activeConvId?: string;
  dimmed?: boolean;
  actions: React.ReactNode;
  onToggleExpand: () => void;
  onClickLink: () => void;
  onArchiveConvo?: (convoId: string) => void;
}) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, overflow: "hidden", background: active ? colors.bgSurface : colors.bg, opacity: dimmed ? 0.7 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px" }}>
        <button onClick={onToggleExpand} aria-label={expanded ? "Collapse" : "Expand"} className="nav-icon-btn" style={{ ...iconBtnStyle, width: 20, height: 20, minWidth: 20, minHeight: 20, color: colors.textMuted }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <ProjectBadge project={project} />
        <Link to={`/${project.id}`} onClick={onClickLink} style={{ flex: 1, minWidth: 0, color: colors.text, textDecoration: "none", fontSize: "0.85rem", fontWeight: active ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</Link>
        {actions}
      </div>
      {expanded && (
        <div style={{ borderTop: `1px solid ${colors.border}`, padding: "6px" }}>
          {convos === null ? (
            <div style={{ padding: "6px 8px", color: colors.textMuted, fontSize: "0.78rem" }}>Loading...</div>
          ) : convos.length === 0 ? (
            <div style={{ padding: "6px 8px", color: colors.textMuted, fontSize: "0.78rem" }}>No chats yet.</div>
          ) : convos.map((convo) => (
            <ConvoRow key={convo.id} convo={convo} projectId={project.id} active={activeConvId === convo.id} onClickLink={onClickLink} onArchive={onArchiveConvo ? () => onArchiveConvo(convo.id) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

// Inject hover styles once via CSS class (avoids stale inline hover state)
let stylesInjected = false;
function injectNavStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `.nav-icon-btn:hover { background: ${colors.bgSurfaceHover} !important; } .convo-row .convo-archive { opacity: 0; } .convo-row:hover .convo-archive { opacity: 1; }`;
  document.head.appendChild(style);
}

function loadExpandedProjects(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveExpandedProjects(expanded: Record<string, boolean>) {
  // Only persist the true entries
  const toSave: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(expanded)) if (v) toSave[k] = true;
  localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(toSave));
}

export function AppNavigator({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  useEffect(injectNavStyles, []);
  const navigate = useNavigate();
  const { projectId, convId } = useParams<{ projectId?: string; convId?: string }>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(loadExpandedProjects);
  const [projectConvos, setProjectConvos] = useState<Record<string, ConvoMeta[]>>({});
  const [loadingConvos, setLoadingConvos] = useState<Record<string, boolean>>({});
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && localStorage.getItem("remote-lab:nav-collapsed") === "true");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= MOBILE_BREAKPOINT);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectInput, setProjectInput] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingConvoProjectId, setCreatingConvoProjectId] = useState<string | null>(null);

  // Persist expanded state whenever it changes
  useEffect(() => { saveExpandedProjects(expandedProjects); }, [expandedProjects]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Load convos for a project
  const loadConvosFor = useCallback(async (pid: string) => {
    setLoadingConvos((prev) => ({ ...prev, [pid]: true }));
    try {
      const c = await listConvos(pid);
      setProjectConvos((prev) => ({ ...prev, [pid]: c.filter((x) => !x.archived_at) }));
    } catch {
      setProjectConvos((prev) => ({ ...prev, [pid]: [] }));
    } finally {
      setLoadingConvos((prev) => ({ ...prev, [pid]: false }));
    }
  }, []);

  // Load convos when a project becomes expanded
  useEffect(() => {
    for (const [pid, isExpanded] of Object.entries(expandedProjects)) {
      if (isExpanded && !(pid in projectConvos) && !loadingConvos[pid]) {
        void loadConvosFor(pid);
      }
    }
  }, [expandedProjects, projectConvos, loadingConvos, loadConvosFor]);

  const loadProjects = useCallback(async () => {
    try {
      const projectList = await listProjects();
      const active = projectList.filter((p) => !p.archived_at);
      const archived = projectList.filter((p) => !!p.archived_at);
      setProjects(active);
      setArchivedProjects(archived);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load navigator");
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // Live status updates
  useEffect(() => {
    const handler = (e: Event) => {
      const { convoId, status } = (e as CustomEvent).detail;
      setProjectConvos((prev) => {
        const next = { ...prev };
        for (const [pid, convos] of Object.entries(next)) {
          next[pid] = convos.map((c) => c.id === convoId ? { ...c, status } : c);
        }
        return next;
      });
    };
    window.addEventListener("convo-status-changed", handler);
    return () => window.removeEventListener("convo-status-changed", handler);
  }, []);

  // Live title updates
  useEffect(() => {
    const handler = (e: Event) => {
      const { convoId, title } = (e as CustomEvent).detail;
      setProjectConvos((prev) => {
        const next = { ...prev };
        for (const [pid, convos] of Object.entries(next)) {
          next[pid] = convos.map((c) => c.id === convoId ? { ...c, title } : c);
        }
        return next;
      });
    };
    window.addEventListener("convo-title-changed", handler);
    return () => window.removeEventListener("convo-title-changed", handler);
  }, []);

  // Remove archived convos
  useEffect(() => {
    const handler = (e: Event) => {
      const { convoId } = (e as CustomEvent).detail;
      setProjectConvos((prev) => {
        const next = { ...prev };
        for (const [pid, convos] of Object.entries(next)) {
          next[pid] = convos.filter((c) => c.id !== convoId);
        }
        return next;
      });
    };
    window.addEventListener("convo-archived", handler);
    return () => window.removeEventListener("convo-archived", handler);
  }, []);

  // Auto-expand active project
  useEffect(() => {
    if (!projectId) return;
    setExpandedProjects((prev) => prev[projectId] ? prev : { ...prev, [projectId]: true });
  }, [projectId]);

  // Reload convos for active project when conversation changes (new chat created, etc.)
  useEffect(() => {
    if (!projectId) return;
    void loadConvosFor(projectId);
  }, [projectId, convId, loadConvosFor]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseMobile();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  const handleToggleExpand = useCallback((pid: string) => {
    setExpandedProjects((prev) => ({ ...prev, [pid]: !prev[pid] }));
  }, []);

  const handleCreateProject = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const val = projectInput.trim();
    if (!val) return;
    setCreatingProject(true);
    setError(null);
    try {
      const url = isUrl(val);
      const name = url ? repoNameFromUrl(val) : val;
      const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const body: { name: string; path: string; github_url?: string } = { name, path: `/srv/projects/${slug}` };
      if (url) body.github_url = val;
      const project = await createProject(body);
      setProjectInput("");
      setShowProjectForm(false);
      await loadProjects();
      navigate(`/${project.id}`);
      onCloseMobile();
    } catch (err: any) {
      setError(err.message || "Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  }, [loadProjects, navigate, onCloseMobile, projectInput]);

  const handleCreateConvo = useCallback(async (targetProjectId: string) => {
    try {
      setCreatingConvoProjectId(targetProjectId);
      const convo = await createConvo(targetProjectId);
      void loadConvosFor(targetProjectId);
      navigate(`/${targetProjectId}/${convo.id}`);
      onCloseMobile();
    } catch (err: any) {
      setError(err.message || "Failed to create conversation");
    } finally {
      setCreatingConvoProjectId(null);
    }
  }, [loadConvosFor, navigate, onCloseMobile]);

  const handleArchiveConvo = useCallback(async (convoProjectId: string, convoId: string) => {
    try {
      await updateConvo(convoId, { archived_at: new Date().toISOString() });
      setProjectConvos((prev) => {
        const next = { ...prev };
        for (const [pid, convos] of Object.entries(next)) {
          next[pid] = convos.filter((c) => c.id !== convoId);
        }
        return next;
      });
      window.dispatchEvent(new CustomEvent("convo-archived", { detail: { convoId } }));
      if (convId === convoId) {
        const remaining = projectConvos[convoProjectId]?.filter((c) => c.id !== convoId) || [];
        if (remaining.length > 0) {
          navigate(`/${convoProjectId}/${remaining[0].id}`);
        } else if (projects.length > 0) {
          navigate(`/${projects[0].id}`);
        } else {
          navigate("/");
        }
      }
    } catch {}
  }, [convId, navigate, projects, projectConvos]);

  const handleArchiveProject = useCallback(async (id: string) => {
    await updateProject(id, { archived_at: new Date().toISOString() });
    setProjectConvos((prev) => { const next = { ...prev }; delete next[id]; return next; });
    await loadProjects();
  }, [loadProjects]);

  const handleRestoreProject = useCallback(async (id: string) => {
    await updateProject(id, { archived_at: null });
    await loadProjects();
  }, [loadProjects]);

  // Build collapsed rail items: walk expanded projects in order, emit their convos
  const collapsedItems = useMemo(() => {
    const items: { convo: ConvoMeta; project: Project }[] = [];
    for (const project of projects) {
      if (!expandedProjects[project.id]) continue;
      const convos = projectConvos[project.id];
      if (!convos) continue;
      for (const convo of convos) {
        items.push({ convo, project });
      }
    }
    return items;
  }, [projects, expandedProjects, projectConvos]);

  const rail = (
    <div style={{ width: isMobile ? "100%" : `${collapsed ? 52 : RAIL_WIDTH}px`, background: colors.bg, borderRight: isMobile ? "none" : `1px solid ${colors.border}`, display: "flex", flexDirection: "column", minWidth: 0, height: "100%", transition: "width 140ms ease" }}>
      <div style={{ height: 52, borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", justifyContent: collapsed && !isMobile ? "center" : "space-between", gap: 8, padding: collapsed && !isMobile ? "8px" : "8px 12px" }}>
        {(!collapsed || isMobile) && <div style={{ fontSize: "0.82rem", fontWeight: 600, color: colors.textMuted }}>Navigator</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isMobile && (
            <IconButton onClick={() => setCollapsed((prev) => { const next = !prev; localStorage.setItem("remote-lab:nav-collapsed", String(next)); return next; })} label={collapsed ? "Expand navigator" : "Collapse navigator"}>
              {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </IconButton>
          )}
          {isMobile && (
            <IconButton onClick={onCloseMobile} label="Close navigator">
              <X size={15} />
            </IconButton>
          )}
        </div>
      </div>

      <div style={{ padding: collapsed && !isMobile ? "12px 6px" : "12px", borderBottom: `1px solid ${colors.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={() => setShowProjectForm((prev) => !prev)} style={{ ...btnPrimary, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: colors.bgSurface, color: colors.text, border: `1px solid ${colors.border}`, padding: collapsed && !isMobile ? "0" : "8px 12px", height: 40, width: "100%" }}>
          <FolderPlus size={16} />
          {(!collapsed || isMobile) && <span>New project</span>}
        </button>
        {showProjectForm && (!collapsed || isMobile) && (
          <form onSubmit={handleCreateProject} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input style={inputStyle} placeholder="Project name or GitHub URL" value={projectInput} onChange={(e) => setProjectInput(e.target.value)} autoFocus />
            <button type="submit" disabled={creatingProject || !projectInput.trim()} style={{ ...btnPrimary, opacity: creatingProject || !projectInput.trim() ? 0.6 : 1 }}>
              {creatingProject ? "Creating..." : "Create"}
            </button>
          </form>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: collapsed && !isMobile ? "12px 6px" : "12px", display: "flex", flexDirection: "column", gap: collapsed && !isMobile ? 4 : 18 }}>
        {error && (!collapsed || isMobile) && <div style={{ color: colors.textMuted, fontSize: "0.8rem" }}>{error}</div>}
        {!collapsed || isMobile ? (
          <>
            {initialLoading ? (
              <div style={{ color: colors.textMuted, fontSize: "0.8rem" }}>Loading...</div>
            ) : (
              <>
                <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {projects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      convos={projectConvos[project.id] ?? (loadingConvos[project.id] ? null : [])}
                      expanded={!!expandedProjects[project.id]}
                      active={project.id === projectId}
                      activeConvId={convId}
                      onToggleExpand={() => handleToggleExpand(project.id)}
                      onClickLink={onCloseMobile}
                      onArchiveConvo={(cid) => { void handleArchiveConvo(project.id, cid); }}
                      actions={<>
                        <IconButton onClick={() => { void handleCreateConvo(project.id); }} disabled={creatingConvoProjectId === project.id} label="New chat" style={{ opacity: creatingConvoProjectId === project.id ? 0.6 : 1 }}>
                          <MessageSquarePlus size={14} />
                        </IconButton>
                        <IconButton onClick={() => { void handleArchiveProject(project.id); }} label="Archive project" title="Archive project">
                          <Archive size={14} />
                        </IconButton>
                      </>}
                    />
                  ))}
                </section>

                {archivedProjects.length > 0 && (
                  <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button
                      onClick={() => setShowArchivedProjects((prev) => !prev)}
                      style={{ background: "none", border: "none", padding: 0, color: colors.textMuted, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}
                    >
                      {showArchivedProjects ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Archived ({archivedProjects.length})
                    </button>
                    {showArchivedProjects && archivedProjects.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        convos={projectConvos[project.id] ?? (loadingConvos[project.id] ? null : [])}
                        expanded={!!expandedProjects[project.id]}
                        active={false}
                        activeConvId={convId}
                        dimmed
                        onToggleExpand={() => handleToggleExpand(project.id)}
                        onClickLink={onCloseMobile}
                        actions={
                          <IconButton onClick={() => { void handleRestoreProject(project.id); }} label="Restore project" title="Restore project">
                            <ArchiveRestore size={14} />
                          </IconButton>
                        }
                      />
                    ))}
                  </section>
                )}
              </>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
            {collapsedItems.map(({ convo, project }) => {
              const active = convId === convo.id;
              const Icon = getProjectIcon(project.id);
              return (
                <RailTooltip key={`c-${convo.id}`} text={convo.title || "Untitled"}>
                  <Link
                    to={`/${project.id}/${convo.id}`}
                    onClick={onCloseMobile}
                    className="nav-icon-btn"
                    style={{ width: 40, height: 44, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: active ? colors.bgSurface : "transparent", color: active ? colors.text : colors.textMuted, textDecoration: "none", position: "relative" }}
                  >
                    <Icon size={16} />
                    <span style={{ position: "absolute", top: 5, right: 3, width: 7, height: 7, borderRadius: 999, background: statusColor(convo.status), boxShadow: `0 0 0 2px ${active ? colors.bgSurface : colors.bg}` }} />
                  </Link>
                </RailTooltip>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return mobileOpen ? (
      <div style={{ position: "fixed", inset: 0, zIndex: 1200, background: colors.overlay }}>
        <div style={{ width: "100%", height: "100%", background: colors.bg }}>{rail}</div>
      </div>
    ) : null;
  }

  return rail;
}
