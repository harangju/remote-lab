import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, X, FileText, Folder, ChevronRight, ChevronDown, CornerDownLeft } from "lucide-react";

interface FileFinderProps {
  files: string[];
  loading: boolean;
  touchedFiles: string[];
  onSelect: (path: string) => void;
  onClose: () => void;
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

/** Simple fuzzy match: all characters of query appear in order in target. */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Score a match — lower is better. Prefers filename matches over path matches. */
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
    if (expanded.has(dir.path)) {
      rows.push(...flattenTree(dir, expanded, depth + 1));
    }
  }
  for (const file of node.files) {
    const fullPath = node.path ? `${node.path}/${file}` : file;
    rows.push({ type: "file", path: fullPath, depth });
  }
  return rows;
}

function defaultExpandedDirs(): Set<string> {
  return new Set<string>();
}

export function FileFinder({ files, loading, touchedFiles, onSelect, onClose }: FileFinderProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => defaultExpandedDirs(files));
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setExpandedDirs(defaultExpandedDirs(files));
  }, [files]);

  const touchedSet = useMemo(() => new Set(touchedFiles), [touchedFiles]);
  const tree = useMemo(() => buildTree(files), [files]);

  const filtered = useMemo(() => {
    if (!query) return [] as string[];
    return files
      .filter((f) => fuzzyMatch(query, f))
      .sort((a, b) => {
        const touchedDelta = Number(touchedSet.has(b)) - Number(touchedSet.has(a));
        if (touchedDelta !== 0) return touchedDelta;
        return fuzzyScore(query, a) - fuzzyScore(query, b);
      })
      .slice(0, 200);
  }, [files, query, touchedSet]);

  const explorerRows = useMemo(() => flattenTree(tree, expandedDirs), [tree, expandedDirs]);
  const visibleRows = query
    ? filtered.map((path) => ({ type: "file" as const, path, depth: path.split("/").length - 1 }))
    : explorerRows;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, visibleRows.length]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleActivate = (row: ExplorerRow | undefined) => {
    if (!row) return;
    if (row.type === "dir") {
      toggleDir(row.path);
      return;
    }
    onSelect(row.path);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const row = visibleRows[selectedIndex];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, visibleRows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "ArrowRight" && row?.type === "dir") {
      e.preventDefault();
      setExpandedDirs((prev) => new Set(prev).add(row.path));
    } else if (e.key === "ArrowLeft" && row?.type === "dir") {
      e.preventDefault();
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.delete(row.path);
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
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: 1000,
        }}
      />

      <div
        className="file-finder"
        style={{
          position: "fixed",
          top: "10vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(640px, 92vw)",
          maxHeight: "72vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          zIndex: 1001,
          overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
        }}>
          <Search size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Browse files or search..."
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontSize: "0.9rem",
              fontFamily: "inherit",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{
                background: "none",
                border: "none",
                padding: "2px",
                color: "var(--text-muted)",
                cursor: "pointer",
                display: "inline-flex",
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div ref={listRef} style={{ overflowY: "auto", flex: 1 }}>
          {loading && (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
              Loading files...
            </div>
          )}
          {!loading && visibleRows.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
              {query ? "No files match" : "No files found"}
            </div>
          )}
          {!loading && visibleRows.map((row, i) => {
            const isSelected = i === selectedIndex;
            const isTouched = row.type === "file" && touchedSet.has(row.path);
            const name = row.path.split("/").pop() || row.path;
            const dir = row.type === "file"
              ? row.path.split("/").slice(0, -1).join("/")
              : row.path;
            const isExpanded = row.type === "dir" && expandedDirs.has(row.path);

            return (
              <button
                key={`${row.type}:${row.path}`}
                onClick={() => handleActivate(row)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "7px 14px",
                  paddingLeft: `${14 + row.depth * 18}px`,
                  background: isSelected ? "var(--bg-surface)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text)",
                  fontSize: "0.82rem",
                  textAlign: "left",
                  fontFamily: row.type === "file" ? "monospace" : "inherit",
                }}
              >
                {row.type === "dir" ? (
                  <>
                    {isExpanded ? <ChevronDown size={14} style={{ flexShrink: 0, color: "var(--text-muted)" }} /> : <ChevronRight size={14} style={{ flexShrink: 0, color: "var(--text-muted)" }} />}
                    <Folder size={14} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{name}</span>
                  </>
                ) : (
                  <>
                    <FileText size={14} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 500 }}>{name}</span>
                      {query && dir && <span style={{ color: "var(--text-muted)", marginLeft: "6px" }}>{dir}/</span>}
                    </span>
                    {isTouched && (
                      <span style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "var(--accent)",
                        flexShrink: 0,
                        marginLeft: "auto",
                      }} data-tooltip="Modified in this conversation" />
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div style={{
          padding: "6px 14px",
          borderTop: "1px solid var(--border)",
          fontSize: "0.7rem",
          color: "var(--text-muted)",
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
        }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          {!query && <span>←→ fold</span>}
          <span>esc close</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <CornerDownLeft size={12} /> {query ? `${filtered.length} matches` : `${files.length} files`}
          </span>
        </div>
      </div>
    </>
  );
}
