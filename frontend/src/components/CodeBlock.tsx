import React, { useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { Copy, Check, Maximize2 } from "lucide-react";
import { colors, radius } from "../styles";

interface CodeBlockProps {
  code: string;
  language?: string;
  onOpen?: (code: string, language: string) => void;
}

const codeActionButton: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "2px",
  color: colors.textMuted,
  display: "inline-flex",
  alignItems: "center",
};

export function CodeBlock({ code, language = "", onOpen }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = isDark ? themes.oneDark : themes.oneLight;

  return (
    <div style={{ position: "relative", margin: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 12px", background: colors.bgSurface, borderRadius: `${radius.md} ${radius.md} 0 0`, fontSize: "0.7rem", color: colors.textMuted, borderBottom: `1px solid ${colors.border}` }}>
        <span style={{ fontFamily: "monospace" }}>{language || "text"}</span>
        <div style={{ display: "flex", gap: "4px" }}>
          {onOpen && (
            <button onClick={() => onOpen(code, language)} style={codeActionButton} data-tooltip="Open in panel">
              <Maximize2 size={12} />
            </button>
          )}
          <button onClick={copy} style={codeActionButton} data-tooltip={copied ? "Copied!" : "Copy"}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      </div>

      <Highlight theme={theme} code={code.replace(/\n$/, "")} language={language || "text"}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre style={{ ...style, margin: 0, padding: "10px 12px", borderRadius: `0 0 ${radius.md} ${radius.md}`, overflowX: "auto", fontSize: "0.82rem", lineHeight: 1.5 }}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })} style={{ display: "table-row" }}>
                <span style={{ display: "table-cell", paddingRight: "1em", userSelect: "none", opacity: 0.35, textAlign: "right", fontFamily: "monospace", fontSize: "0.75rem" }}>{i + 1}</span>
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
