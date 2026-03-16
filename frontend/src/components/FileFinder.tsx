import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, X, FileText } from "lucide-react";

interface FileFinderProps {
  files: string[];
  loading: boolean;
  touchedFiles: string[];
  onSelect: (path: string) => void;
  onClose: () => void;
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
  // Exact filename contains: best
  if (filename.includes(q)) return 0;
  // Path contains: good
  if (target.toLowerCase().includes(q)) return 1;
  // Fuzzy match: ok
  return 2;
}

export function FileFinder({ files, loading, touchedFiles, onSelect, onClose }: FileFinderProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const touchedSet = useMemo(() => new Set(touchedFiles), [touchedFiles]);

  const filtered = useMemo(() => {
    let results = files;
    if (query) {
      results = files
        .filter((f) => fuzzyMatch(query, f))
        .sort((a, b) => fuzzyScore(query, a) - fuzzyScore(query, b));
    }
    // Sort touched files first
    const touched: string[] = [];
    const rest: string[] = [];
    for (const f of results) {
      if (touchedSet.has(f)) touched.push(f);
      else rest.push(f);
    }
    return [...touched, ...rest];
  }, [files, query, touchedSet]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      onSelect(filtered[selectedIndex]);
      onClose();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: 1000,
        }}
      />

      {/* Finder */}
      <div
        className="file-finder"
        style={{
          position: "fixed",
          top: "15vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(480px, 90vw)",
          maxHeight: "60vh",
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
        {/* Search input */}
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
            placeholder="Find file..."
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
                background: "none", border: "none", padding: "2px",
                color: "var(--text-muted)", cursor: "pointer",
                display: "inline-flex",
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: "auto", flex: 1 }}>
          {loading && (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
              Loading files...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
              {query ? "No files match" : "No files found"}
            </div>
          )}
          {filtered.slice(0, 200).map((f, i) => {
            const isTouched = touchedSet.has(f);
            const isSelected = i === selectedIndex;
            const parts = f.split("/");
            const filename = parts.pop() || f;
            const dir = parts.join("/");
            return (
              <button
                key={f}
                onClick={() => { onSelect(f); onClose(); }}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "6px 14px",
                  background: isSelected ? "var(--bg-surface)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text)",
                  fontSize: "0.82rem",
                  textAlign: "left",
                  fontFamily: "monospace",
                }}
              >
                <FileText size={14} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 500 }}>{filename}</span>
                  {dir && <span style={{ color: "var(--text-muted)", marginLeft: "6px" }}>{dir}/</span>}
                </span>
                {isTouched && (
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: "var(--accent)",
                    flexShrink: 0,
                    marginLeft: "auto",
                  }} data-tooltip="Modified in this conversation" />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: "6px 14px",
          borderTop: "1px solid var(--border)",
          fontSize: "0.7rem",
          color: "var(--text-muted)",
          display: "flex",
          gap: "12px",
        }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          {filtered.length > 0 && <span style={{ marginLeft: "auto" }}>{filtered.length} files</span>}
        </div>
      </div>
    </>
  );
}
