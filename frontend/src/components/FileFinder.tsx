import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, X, FileText, Folder, ChevronRight, ChevronDown, CornerDownLeft, Clock3 } from "lucide-react";
import { colors, overlayBackdrop, overlayHeader, overlayPanel, interactiveRow } from "../styles";

interface FileFinderProps {
  projectId: string;
  files: string[];
  loading: boolean;
  touchedFiles: string[];
  recentlyViewed?: string[];
  onSelect: (path: string) => void;
  onClose: () => void;
  onRemoveRecent?: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  files: string[];
  dirs: TreeNode[];
}

interface ExplorerRow {
  type: "dir" | "file";
  path: string;
  depth: number;
}

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const filename = target.split("/").pop()?.toLowerCase() || "";
  if (filename === q) return -1;
  if (filename.includes(q)) return 0;
  if (target.toLowerCase().includes(q)) return 1;
  return 2;
}

function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", files: [], dirs: [] };
  const dirMap = new Map<string, TreeNode>([["", root]]);

  const ensureDir = (path: string): TreeNode => {
    const existing = dirMap.get(path);
    if (existing) return existing;
    const parts = path.split("/");
    const name = parts[parts.length - 1] || path;
    const parentPath = parts.slice(0, -1).join("/");
    const parent = ensureDir(parentPath);
    const node: TreeNode = { name, path, files: [], dirs: [] };
    parent.dirs.push(node);
    dirMap.set(path, node);
    return node;
  };

  for (const file of files) {
    const parts = file.split("/");
    const filename = parts.pop() || file;
    const dirPath = parts.join("/");
    const dir = ensureDir(dirPath);
    dir.files.push(filename);
  }

  const sortNode = (node: TreeNode) => {
    node.dirs.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.localeCompare(b));
    node.dirs.forEach(sortNode);
  };

  sortNode(root);
  return root;
}

function flattenTree(node: TreeNode, expanded: Set<string>, depth = 0): ExplorerRow[] {
  const rows: ExplorerRow[] = [];
  for (const dir of node.dirs) {
    rows.push({ type: "dir", path: dir.path, depth });
    if (expanded.has(dir.path)) rows.push(...flattenTree(dir, expanded, depth + 1));
  }
  for (const file of node.files) {
    const fullPath = node.path ? `${node.path}/${file}` : file;
    rows.push({ type: "file", path: fullPath, depth });
  }
  return rows;
}

const EXPANDED_DIRS_KEY = "remote-lab:file-finder-expanded:";

function loadExpandedDirs(projectId: string): Set<string> {
  try {
    const stored = localStorage.getItem(EXPANDED_DIRS_KEY + projectId);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch { return new Set(); }
}

function saveExpandedDirs(projectId: string, dirs: Set<string>) {
  try { localStorage.setItem(EXPANDED_DIRS_KEY + projectId, JSON.stringify([...dirs])); } catch {}
}

export function FileFinder({ projectId, files, loading, touchedFiles, recentlyViewed = [], onSelect, onClose, onRemoveRecent }: FileFinderProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => loadExpandedDirs(projectId));
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const effectiveShowHidden = query.includes(".");
  const effectiveFiles = useMemo(() => {
    if (effectiveShowHidden) return files;
    return files.filter((path) => !path.split("/").some((part) => part.startsWith(".")));
  }, [effectiveShowHidden, files]);
  const touchedSet = useMemo(() => new Set(touchedFiles), [touchedFiles]);
  const tree = useMemo(() => buildTree(effectiveFiles), [effectiveFiles]);

  const filtered = useMemo(() => {
    if (!query) return [] as string[];
    return effectiveFiles
      .filter((f) => fuzzyMatch(query, f))
      .sort((a, b) => {
        const touchedDelta = Number(touchedSet.has(b)) - Number(touchedSet.has(a));
        if (touchedDelta !== 0) return touchedDelta;
        return fuzzyScore(query, a) - fuzzyScore(query, b);
      })
      .slice(0, 200);
  }, [effectiveFiles, query, touchedSet]);

  const explorerRows = useMemo(() => flattenTree(tree, expandedDirs), [tree, expandedDirs]);
  const visibleRows = query
    ? filtered.map((path) => ({ type: "file" as const, path, depth: path.split("/").length - 1 }))
    : explorerRows;

  const prevQueryRef = useRef(query);
  const prevVisibleLenRef = useRef(visibleRows.length);

  useEffect(() => {
    const queryChanged = prevQueryRef.current !== query;
    const listWasEmpty = prevVisibleLenRef.current === 0;
    if (queryChanged || listWasEmpty) setSelectedIndex(0);
    else setSelectedIndex((i) => Math.min(i, Math.max(visibleRows.length - 1, 0)));
    prevQueryRef.current = query;
    prevVisibleLenRef.current = visibleRows.length;
  }, [query, visibleRows.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-row-index="${selectedIndex}"]`) as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveExpandedDirs(projectId, next);
      return next;
    });
  };

  const handleActivate = (row: ExplorerRow | undefined) => {
    if (!row) return;
    if (row.type === "dir") return toggleDir(row.path);
    onSelect(row.path);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const row = visibleRows[selectedIndex];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, visibleRows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "ArrowRight" && row?.type === "dir") {
      e.preventDefault();
      setExpandedDirs((prev) => { const next = new Set(prev).add(row.path); saveExpandedDirs(projectId, next); return next; });
    } else if (e.key === "ArrowLeft" && row?.type === "dir") {
      e.preventDefault();
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.delete(row.path);
        saveExpandedDirs(projectId, next);
        return next;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleActivate(row);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <>
      <div onClick={onClose} style={overlayBackdrop} />

      <div
        className="file-finder"
        style={{
          ...overlayPanel,
          top: "10vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(640px, 92vw)",
          maxHeight: "72vh",
        }}
      >
        <div style={{ ...overlayHeader, color: colors.text }}>
          <Search size={16} style={{ color: colors.textMuted, flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={effectiveShowHidden ? "Browse files or search... (hidden shown)" : "Browse files or search..."}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: colors.text,
              fontSize: "0.9rem",
              fontFamily: "inherit",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{ background: "none", border: "none", padding: "2px", color: colors.textMuted, display: "inline-flex" }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div ref={listRef} style={{ overflowY: "auto", flex: 1 }}>
          {loading && <div style={{ padding: "20px", textAlign: "center", color: colors.textMuted, fontSize: "0.8rem" }}>Loading files...</div>}
          {!loading && !query && recentlyViewed.length > 0 && (
            <>
              <div style={{ padding: "6px 14px 4px", fontSize: "0.7rem", color: colors.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: "5px" }}><Clock3 size={12} /> Recently viewed</div>
              {recentlyViewed.map((path) => {
                const name = path.split("/").pop() || path;
                const dir = path.split("/").slice(0, -1).join("/");
                return (
                  <button
                    key={`recent:${path}`}
                    onClick={() => { onSelect(path); onClose(); }}
                    style={{ ...interactiveRow(false), padding: "7px 14px", fontFamily: "monospace" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgSurface; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <FileText size={14} style={{ flexShrink: 0, color: colors.textMuted }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      <span style={{ fontWeight: 500 }}>{name}</span>
                      {dir && <span style={{ color: colors.textMuted, marginLeft: "6px" }}>{dir}/</span>}
                    </span>
                    {onRemoveRecent && (
                      <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); onRemoveRecent(path); }}
                        style={{ flexShrink: 0, padding: "2px", color: colors.textMuted, display: "inline-flex", opacity: 0.5, cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                      >
                        <X size={13} />
                      </span>
                    )}
                  </button>
                );
              })}
              <div style={{ borderBottom: `1px solid ${colors.border}`, margin: "4px 0" }} />
            </>
          )}
          {!loading && visibleRows.length === 0 && <div style={{ padding: "20px", textAlign: "center", color: colors.textMuted, fontSize: "0.8rem" }}>{query ? "No files match" : "No files found"}</div>}
          {!loading && visibleRows.map((row, i) => {
            const isSelected = i === selectedIndex;
            const isTouched = row.type === "file" && touchedSet.has(row.path);
            const name = row.path.split("/").pop() || row.path;
            const dir = row.type === "file" ? row.path.split("/").slice(0, -1).join("/") : row.path;
            const isExpanded = row.type === "dir" && expandedDirs.has(row.path);

            return (
              <button
                key={`${row.type}:${row.path}`}
                data-row-index={i}
                onClick={() => handleActivate(row)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  ...interactiveRow(isSelected),
                  padding: "7px 14px",
                  paddingLeft: `${14 + row.depth * 18}px`,
                  fontFamily: row.type === "file" ? "monospace" : "inherit",
                }}
              >
                {row.type === "dir" ? (
                  <>
                    {isExpanded ? <ChevronDown size={14} style={{ flexShrink: 0, color: colors.textMuted }} /> : <ChevronRight size={14} style={{ flexShrink: 0, color: colors.textMuted }} />}
                    <Folder size={14} style={{ flexShrink: 0, color: colors.textMuted }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{name}</span>
                  </>
                ) : (
                  <>
                    <FileText size={14} style={{ flexShrink: 0, color: colors.textMuted }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 500 }}>{name}</span>
                      {query && dir && <span style={{ color: colors.textMuted, marginLeft: "6px" }}>{dir}/</span>}
                    </span>
                    {isTouched && <span style={{ width: 5, height: 5, borderRadius: "50%", background: colors.accent, flexShrink: 0, marginLeft: "auto" }} data-tooltip="Modified in this conversation" />}
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "6px 14px", borderTop: `1px solid ${colors.border}`, fontSize: "0.7rem", color: colors.textMuted, display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          {!query && <span>←→ fold</span>}
          <span>. hidden</span>
          <span>esc close</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <CornerDownLeft size={12} /> {query ? `${filtered.length} matches` : `${effectiveFiles.length} files`}
          </span>
        </div>
      </div>
    </>
  );
}
