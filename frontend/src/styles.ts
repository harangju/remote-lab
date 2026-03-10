// Shared inline styles — keeps things simple until we add a CSS framework.

export const colors = {
  bg: "var(--bg)",
  bgSurface: "var(--bg-surface)",
  border: "var(--border)",
  text: "var(--text)",
  textMuted: "var(--text-muted)",
  accent: "var(--accent)",
  danger: "#da3633",
  badgeIdle: "#8b949e",
  badgeRunning: "#58a6ff",
  badgeDone: "#3fb950",
  badgeError: "#f85149",
};

/** Inject CSS variables for light/dark mode into document head. */
export function injectTheme() {
  if (document.getElementById("rl-theme")) return;
  const style = document.createElement("style");
  style.id = "rl-theme";
  style.textContent = `
    :root {
      --bg: #ffffff;
      --bg-surface: #f6f8fa;
      --border: #d1d9e0;
      --text: #1f2328;
      --text-muted: #656d76;
      --accent: #0969da;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1117;
        --bg-surface: #161b22;
        --border: #30363d;
        --text: #e6edf3;
        --text-muted: #8b949e;
        --accent: #58a6ff;
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
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
  background: colors.accent,
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  padding: "6px 14px",
  fontWeight: 600,
};

export const btnDanger: React.CSSProperties = {
  background: "transparent",
  color: colors.danger,
  border: `1px solid ${colors.danger}`,
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
