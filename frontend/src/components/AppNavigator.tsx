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
import { createConvo, createProject, listConvos, listProjects, listRecentConvos, updateProject, type ConvoMeta, type Project } from "../api";
import { btnIcon, btnPrimary, colors, input as inputStyle } from "../styles";

const MOBILE_BREAKPOINT = 768;
const RAIL_WIDTH = 300;
const RECENT_LIMIT = 5;

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

function ConvoRow({ convo, projectId, active, onClickLink }: { convo: ConvoMeta; projectId: string; active: boolean; onClickLink: () => void }) {
  return (
    <Link
      to={`/${projectId}/${convo.id}`}
      onClick={onClickLink}
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px 7px 12px", borderRadius: 8, background: active ? colors.bgSurfaceHover : "transparent", color: colors.text, textDecoration: "none" }}
    >
      <span style={{ width: 7, height: 7, minWidth: 7, borderRadius: 999, background: statusColor(convo.status), opacity: active ? 1 : 0.7 }} />
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: active ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{convo.title || "Untitled"}</span>
        <span style={{ fontSize: "0.7rem", color: colors.textMuted }}>{timeAgo(convo.last_event_at || convo.updated_at)}</span>
      </span>
    </Link>
  );
}

function ProjectCard({ project, expanded, active, activeConvId, dimmed, actions, onToggleExpand, onClickLink }: {
  project: Project;
  expanded: boolean;
  active: boolean;
  activeConvId?: string;
  dimmed?: boolean;
  actions: React.ReactNode;
  onToggleExpand: () => void;
  onClickLink: () => void;
}) {
  const [convos, setConvos] = useState<ConvoMeta[] | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!expanded || loadedRef.current) return;
    loadedRef.current = true;
    listConvos(project.id).then((c) => setConvos(c.filter((x) => !x.archived_at))).catch(() => setConvos([]));
  }, [expanded, project.id]);

  // Reload convos when this project is active (new chat may have been created)
  useEffect(() => {
    if (!active || !loadedRef.current) return;
    listConvos(project.id).then((c) => setConvos(c.filter((x) => !x.archived_at))).catch(() => {});
  }, [active, activeConvId, project.id]);

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
          ) : convos.slice(0, 8).map((convo) => (
            <ConvoRow key={convo.id} convo={convo} projectId={project.id} active={activeConvId === convo.id} onClickLink={onClickLink} />
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
  style.textContent = `.nav-icon-btn:hover { background: ${colors.bgSurfaceHover} !important; }`;
  document.head.appendChild(style);
}

export function AppNavigator({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  useEffect(injectNavStyles, []);
  const navigate = useNavigate();
  const { projectId, convId } = useParams<{ projectId?: string; convId?: string }>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [recentConvos, setRecentConvos] = useState<ConvoMeta[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && localStorage.getItem("remote-lab:nav-collapsed") === "true");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= MOBILE_BREAKPOINT);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectInput, setProjectInput] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingConvoProjectId, setCreatingConvoProjectId] = useState<string | null>(null);
  const initialProjectIdRef = useRef(projectId);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const [projectList, recent] = await Promise.all([listProjects(), listRecentConvos(RECENT_LIMIT)]);
      const active = projectList.filter((p) => !p.archived_at);
      const archived = projectList.filter((p) => !!p.archived_at);
      setProjects(active);
      setArchivedProjects(archived);
      setRecentConvos(recent);
      setExpandedProjects((prev) => {
        const next = { ...prev };
        const initId = initialProjectIdRef.current;
        for (const p of active) {
          if (next[p.id] === undefined) next[p.id] = p.id === initId;
        }
        return next;
      });
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

  useEffect(() => {
    if (!projectId) return;
    setExpandedProjects((prev) => ({ ...prev, [projectId]: true }));
  }, [projectId]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseMobile();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  const projectMap = useMemo(() => new Map([...projects, ...archivedProjects].map((p) => [p.id, p])), [projects, archivedProjects]);

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
      listRecentConvos(RECENT_LIMIT).then(setRecentConvos).catch(() => {});
      navigate(`/${targetProjectId}/${convo.id}`);
      onCloseMobile();
    } catch (err: any) {
      setError(err.message || "Failed to create conversation");
    } finally {
      setCreatingConvoProjectId(null);
    }
  }, [navigate, onCloseMobile]);

  const handleArchiveProject = useCallback(async (id: string) => {
    await updateProject(id, { archived_at: new Date().toISOString() });
    await loadProjects();
  }, [loadProjects]);

  const handleRestoreProject = useCallback(async (id: string) => {
    await updateProject(id, { archived_at: null });
    await loadProjects();
  }, [loadProjects]);

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

      <div style={{ flex: 1, overflowY: "auto", padding: collapsed && !isMobile ? "12px 6px" : "12px", display: "flex", flexDirection: "column", gap: 18 }}>
        {error && (!collapsed || isMobile) && <div style={{ color: colors.textMuted, fontSize: "0.8rem" }}>{error}</div>}
        {!collapsed || isMobile ? (
          <>
            <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textMuted, fontWeight: 600 }}>Recent</div>
              {initialLoading ? (
                <div style={{ color: colors.textMuted, fontSize: "0.8rem" }}>Loading...</div>
              ) : recentConvos.length === 0 ? (
                <div style={{ color: colors.textMuted, fontSize: "0.8rem" }}>No chats yet.</div>
              ) : recentConvos.map((convo) => {
                const active = convId === convo.id;
                const project = projectMap.get(convo.project_id);
                const Icon = project ? getProjectIcon(project.id) : null;
                return (
                  <Link
                    key={`recent-${convo.id}`}
                    to={`/${convo.project_id}/${convo.id}`}
                    onClick={onCloseMobile}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 10, background: active ? colors.bgSurface : "transparent", color: colors.text, textDecoration: "none", border: `1px solid ${active ? colors.border : "transparent"}` }}
                  >
                    <span style={{ width: 7, height: 7, minWidth: 7, borderRadius: 999, background: statusColor(convo.status), opacity: active ? 1 : 0.7 }} />
                    <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                      <span style={{ fontSize: "0.84rem", fontWeight: active ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{convo.title || "Untitled"}</span>
                      <span style={{ fontSize: "0.72rem", color: colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        {Icon && <Icon size={10} />} {project?.name || "Project"} · {timeAgo(convo.last_event_at || convo.updated_at)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </section>

            <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textMuted, fontWeight: 600 }}>Projects</div>
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  expanded={!!expandedProjects[project.id]}
                  active={project.id === projectId}
                  activeConvId={convId}
                  onToggleExpand={() => setExpandedProjects((prev) => ({ ...prev, [project.id]: !prev[project.id] }))}
                  onClickLink={onCloseMobile}
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
                    expanded={!!expandedProjects[project.id]}
                    active={false}
                    activeConvId={convId}
                    dimmed
                    onToggleExpand={() => setExpandedProjects((prev) => ({ ...prev, [project.id]: !prev[project.id] }))}
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
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
            {recentConvos.map((convo) => {
              const active = convId === convo.id;
              const project = projectMap.get(convo.project_id);
              const Icon = project ? getProjectIcon(project.id) : Sparkles;
              return (
                <Link
                  key={`c-${convo.id}`}
                  to={`/${convo.project_id}/${convo.id}`}
                  onClick={onCloseMobile}
                  title={convo.title || "Untitled"}
                  className="nav-icon-btn"
                  style={{ width: 40, height: 44, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: active ? colors.bgSurface : "transparent", color: active ? colors.text : colors.textMuted, textDecoration: "none", position: "relative" }}
                >
                  <Icon size={16} />
                  <span style={{ position: "absolute", top: 5, right: 3, width: 7, height: 7, borderRadius: 999, background: statusColor(convo.status), boxShadow: `0 0 0 2px ${active ? colors.bgSurface : colors.bg}` }} />
                </Link>
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
