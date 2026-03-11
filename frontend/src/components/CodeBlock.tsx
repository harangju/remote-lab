import React, { useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { Copy, Check, Maximize2 } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  onOpen?: (code: string, language: string) => void;
}

export function CodeBlock({ code, language = "", onOpen }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Detect dark mode
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = isDark ? themes.oneDark : themes.oneLight;

  return (
    <div style={{ position: "relative", margin: "6px 0" }}>
      {/* Header bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 12px",
        background: isDark ? "#1e1e1e" : "#e8e6e1",
        borderRadius: "6px 6px 0 0",
        fontSize: "0.7rem",
        color: "var(--text-muted)",
      }}>
        <span style={{ fontFamily: "monospace" }}>{language || "text"}</span>
        <div style={{ display: "flex", gap: "4px" }}>
          {onOpen && (
            <button
              onClick={() => onOpen(code, language)}
              style={{
                background: "none", border: "none", padding: "2px",
                color: "var(--text-muted)", cursor: "pointer",
                display: "inline-flex", alignItems: "center",
              }}
              data-tooltip="Open in panel"
            >
              <Maximize2 size={12} />
            </button>
          )}
          <button
            onClick={copy}
            style={{
              background: "none", border: "none", padding: "2px",
              color: "var(--text-muted)", cursor: "pointer",
              display: "inline-flex", alignItems: "center",
            }}
            data-tooltip={copied ? "Copied!" : "Copy"}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      </div>

      {/* Code */}
      <Highlight theme={theme} code={code.replace(/\n$/, "")} language={language || "text"}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre style={{
            ...style,
            margin: 0,
            padding: "10px 12px",
            borderRadius: "0 0 6px 6px",
            overflowX: "auto",
            fontSize: "0.82rem",
            lineHeight: 1.5,
          }}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })} style={{ display: "table-row" }}>
                <span style={{
                  display: "table-cell",
                  paddingRight: "1em",
                  userSelect: "none",
                  opacity: 0.35,
                  textAlign: "right",
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                }}>{i + 1}</span>
                <span style={{ display: "table-cell" }}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
