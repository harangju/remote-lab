// Shared inline styles — keeps things simple until we add a CSS framework.

export const colors = {
  bg: "var(--bg)",
  bgSurface: "var(--bg-surface)",
  border: "var(--border)",
  text: "var(--text)",
  textMuted: "var(--text-muted)",
  accent: "var(--accent)",
  danger: "#c4554d",
  badgeIdle: "#9b9a97",
  badgeRunning: "#d9a754",
  badgeDone: "#4d9375",
  badgeError: "#c4554d",
};

/** Inject CSS variables for light/dark mode into document head. */
export function injectTheme() {
  if (document.getElementById("rl-theme")) return;
  const style = document.createElement("style");
  style.id = "rl-theme";
  style.textContent = `
    :root {
      --bg: #fbfaf8;
      --bg-surface: #f3f2ee;
      --border: #e6e4df;
      --text: #37352f;
      --text-muted: #9b9a97;
      --accent: #b4885d;
      --bg-user: #ede9e3;
      --border-user: #ddd9d3;
      --code-bg: rgba(0,0,0,0.05);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #191919;
        --bg-surface: #202020;
        --border: #2e2e2e;
        --text: #e8e7e4;
        --text-muted: #8b8a86;
        --accent: #c9a57c;
        --bg-user: #2a2926;
        --border-user: #3a3835;
        --code-bg: rgba(255,255,255,0.07);
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    button {
      cursor: pointer;
      font-family: inherit;
      font-size: 0.875rem;
    }
    input, textarea {
      font-family: inherit;
      font-size: 0.875rem;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    /* Markdown content resets */
    .md-content p { margin: 0 0 0.4em; }
    .md-content p:last-child { margin-bottom: 0; }
    .md-content ul, .md-content ol { margin: 0.3em 0; padding-left: 1.4em; }
    .md-content li { margin: 0.15em 0; }
    .md-content h1, .md-content h2, .md-content h3 {
      margin: 0.6em 0 0.3em;
      line-height: 1.3;
    }
    .md-content h1 { font-size: 1.2em; }
    .md-content h2 { font-size: 1.1em; }
    .md-content h3 { font-size: 1em; }
    .md-content blockquote {
      margin: 0.4em 0;
      padding-left: 0.8em;
      border-left: 3px solid var(--border);
      color: var(--text-muted);
    }
    .md-content hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 0.6em 0;
    }
  `;
  document.head.appendChild(style);
}

// Reusable style objects

export const container: React.CSSProperties = {
  padding: "1.5rem",
  maxWidth: "48rem",
  margin: "0 auto",
};

export const btnPrimary: React.CSSProperties = {
  background: "var(--text)",
  color: "var(--bg)",
  border: "none",
  borderRadius: "6px",
  padding: "6px 14px",
  fontWeight: 500,
};

export const btnDanger: React.CSSProperties = {
  background: "transparent",
  color: "var(--text-muted)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  padding: "4px 10px",
  fontSize: "0.75rem",
};

export const input: React.CSSProperties = {
  background: "var(--bg-surface)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  padding: "6px 10px",
  outline: "none",
  width: "100%",
};

export const card: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "12px 16px",
  marginBottom: "8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

export const backLink: React.CSSProperties = {
  display: "inline-block",
  marginBottom: "1rem",
  fontSize: "0.875rem",
};

export function badge(status: string): React.CSSProperties {
  const colorMap: Record<string, string> = {
    idle: colors.badgeIdle,
    running: colors.badgeRunning,
    done: colors.badgeDone,
    error: colors.badgeError,
  };
  const c = colorMap[status] || colors.badgeIdle;
  return {
    display: "inline-block",
    fontSize: "0.7rem",
    fontWeight: 600,
    textTransform: "uppercase",
    padding: "2px 8px",
    borderRadius: "10px",
    background: c + "22",
    color: c,
    ...(status === "running" ? { animation: "pulse 1.5s infinite" } : {}),
  };
}
