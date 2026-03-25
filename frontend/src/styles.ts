// Shared inline styles — lightweight design tokens + reusable primitives.

export const colors = {
  bg: "var(--bg)",
  bgSurface: "var(--bg-surface)",
  bgSurfaceHover: "var(--bg-surface-hover)",
  border: "var(--border)",
  borderStrong: "var(--border-strong)",
  text: "var(--text)",
  textMuted: "var(--text-muted)",
  accent: "var(--accent)",
  accentSoft: "var(--accent-soft)",
  success: "var(--success)",
  successSoft: "var(--success-soft)",
  warning: "var(--warning)",
  warningSoft: "var(--warning-soft)",
  danger: "var(--danger)",
  dangerSoft: "var(--danger-soft)",
  overlay: "var(--overlay)",
  codeBg: "var(--code-bg)",
  badgeIdle: "var(--text-muted)",
  badgeRunning: "var(--warning)",
  badgeDone: "var(--success)",
  badgeError: "var(--danger)",
};

export const radius = {
  sm: "4px",
  md: "6px",
  lg: "8px",
  xl: "10px",
  pill: "999px",
};

export const shadow = {
  overlay: "0 8px 32px rgba(0,0,0,0.2)",
  focus: "0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)",
};

export const zIndex = {
  overlayBackdrop: 1000,
  overlayPanel: 1001,
  tooltip: 2147483647,
};

export const controlSize = {
  icon: "34px",
};

export const transition = {
  fast: "120ms ease",
  button: "140ms ease",
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
      --bg-surface-hover: #ece9e2;
      --border: #e6e4df;
      --border-strong: #d7d3cc;
      --text: #37352f;
      --text-muted: #9b9a97;
      --accent: #b4885d;
      --accent-soft: color-mix(in srgb, var(--accent) 14%, var(--bg));
      --success: #4d9375;
      --success-soft: rgba(77,147,117,0.12);
      --warning: #d9a754;
      --warning-soft: rgba(217,167,84,0.14);
      --danger: #c4554d;
      --danger-soft: rgba(196,85,77,0.12);
      --overlay: rgba(0,0,0,0.3);
      --bg-user: #ede9e3;
      --border-user: #ddd9d3;
      --bg-bash-user: #e7ece7;
      --border-bash-user: #bccabb;
      --bg-bash-composer: #eef3ee;
      --border-bash-composer: #7d9b7b;
      --code-bg: rgba(0,0,0,0.05);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #191919;
        --bg-surface: #202020;
        --bg-surface-hover: #272727;
        --border: #2e2e2e;
        --border-strong: #3a3a3a;
        --text: #e8e7e4;
        --text-muted: #8b8a86;
        --accent: #c9a57c;
        --accent-soft: color-mix(in srgb, var(--accent) 16%, var(--bg));
        --success: #6aa88c;
        --success-soft: rgba(106,168,140,0.16);
        --warning: #d9a754;
        --warning-soft: rgba(217,167,84,0.16);
        --danger: #d06a63;
        --danger-soft: rgba(208,106,99,0.16);
        --overlay: rgba(0,0,0,0.46);
        --bg-user: #2a2926;
        --border-user: #3a3835;
        --bg-bash-user: #202723;
        --border-bash-user: #395043;
        --bg-bash-composer: #1d2620;
        --border-bash-composer: #6f9678;
        --code-bg: rgba(255,255,255,0.07);
      }
    }
    *, *::before, *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    input, textarea, select { font-size: 16px !important; }
    html, body {
      margin: 0;
      height: 100%;
    }
    body {
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    #root {
      height: 100%;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    [data-tooltip] { position: relative; }
    [data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-top: 4px;
      padding: 3px 8px;
      background: var(--text);
      color: var(--bg);
      font-size: 0.7rem;
      white-space: nowrap;
      border-radius: 4px;
      pointer-events: none;
      z-index: ${zIndex.tooltip};
    }
    [data-tooltip][data-tooltip-pos="top"]:hover::after {
      top: auto;
      bottom: 100%;
      margin-top: 0;
      margin-bottom: 4px;
    }
    button {
      cursor: pointer;
      font-family: inherit;
      font-size: 0.875rem;
      transition: filter ${transition.button}, transform ${transition.button}, box-shadow ${transition.button}, opacity ${transition.button};
    }
    button:hover:not(:disabled) {
      filter: brightness(0.97);
    }
    button:active:not(:disabled) {
      filter: brightness(0.92);
      transform: translateY(1px);
    }
    @media (prefers-color-scheme: dark) {
      button:hover:not(:disabled) {
        filter: brightness(1.04);
      }
      button:active:not(:disabled) {
        filter: brightness(1.08);
        transform: translateY(1px);
      }
    }
    button:disabled {
      cursor: default;
    }
    input, textarea {
      font-family: inherit;
      font-size: 0.875rem;
    }
    * {
      scrollbar-width: none;
    }
    *::-webkit-scrollbar {
      display: none;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @media (max-width: 768px) {
      .artifact-panel-wrap {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100% !important;
        z-index: 100;
      }
      .chat-convo-rail {
        display: none !important;
      }
    }
    @media (min-width: 769px) {
      .chat-convo-rail {
        display: flex !important;
      }
      .chat-convo-rail-row:hover > button:first-child,
      .chat-convo-rail-row:focus-within > button:first-child {
        background: var(--bg-surface-hover) !important;
      }
      .chat-convo-rail-row:hover .chat-convo-rail-archive,
      .chat-convo-rail-row:focus-within .chat-convo-rail-archive {
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      .app-shell-mobile-menu,
      .app-shell-mobile-menu-inline {
        display: none !important;
      }
    }
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

export const container: React.CSSProperties = {
  padding: "1.5rem",
  maxWidth: "48rem",
  margin: "0 auto",
};

export const btnPrimary: React.CSSProperties = {
  background: colors.text,
  color: colors.bg,
  border: "none",
  borderRadius: radius.md,
  padding: "6px 14px",
  fontWeight: 500,
};

export const btnIcon: React.CSSProperties = {
  background: colors.bgSurface,
  border: `1px solid ${colors.border}`,
  color: colors.text,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: controlSize.icon,
  height: controlSize.icon,
  minWidth: controlSize.icon,
  minHeight: controlSize.icon,
  padding: 0,
  borderRadius: "9px",
  flexShrink: 0,
  transition: `background ${transition.fast}, border-color ${transition.fast}, opacity ${transition.fast}`,
  transform: "none",
  boxShadow: "none",
  appearance: "none",
  WebkitAppearance: "none",
  position: "relative",
};

export const btnSubtle: React.CSSProperties = {
  background: "transparent",
  color: colors.textMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: "4px 10px",
  fontSize: "0.75rem",
};

export const btnDanger: React.CSSProperties = {
  ...btnSubtle,
};

export const input: React.CSSProperties = {
  background: colors.bgSurface,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: "6px 10px",
  outline: "none",
  width: "100%",
};

export const card: React.CSSProperties = {
  background: colors.bgSurface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: "12px 16px",
  marginBottom: "8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

export const overlayBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: colors.overlay,
  zIndex: zIndex.overlayBackdrop,
};

export const overlayPanel: React.CSSProperties = {
  position: "fixed",
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.xl,
  boxShadow: shadow.overlay,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  zIndex: zIndex.overlayPanel,
};

export const overlayHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 14px",
  borderBottom: `1px solid ${colors.border}`,
  fontSize: "0.82rem",
  color: colors.textMuted,
};

export function interactiveRow(selected = false): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    padding: "8px 14px",
    background: selected ? colors.bgSurface : "transparent",
    border: "none",
    cursor: "pointer",
    color: colors.text,
    fontSize: "0.82rem",
    textAlign: "left",
  };
}

export function iconButtonHoverStyle(active = false): React.CSSProperties {
  return {
    background: active ? colors.bgSurfaceHover : colors.bgSurfaceHover,
  };
}

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
    background: `color-mix(in srgb, ${c} 14%, transparent)`,
    color: c,
    ...(status === "running" ? { animation: "pulse 1.5s infinite" } : {}),
  };
}
