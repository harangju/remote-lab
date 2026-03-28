import React from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { FolderPlus, Menu } from "lucide-react";
import { btnIcon, btnPrimary, colors } from "../styles";

export function ProjectList() {
  const navigate = useNavigate();
  const { closeMobileNavigator } = useOutletContext<{ closeMobileNavigator: () => void }>();

  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", position: "relative" }}>
      <button onClick={() => closeMobileNavigator()} style={{ ...btnIcon, color: colors.textMuted, position: "absolute", top: 16, left: 16 }} aria-label="Open navigator" className="app-shell-mobile-menu-inline">
        <Menu size={15} />
      </button>
      <div style={{ maxWidth: 520, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, border: `1px solid ${colors.border}`, background: colors.bgSurface, display: "flex", alignItems: "center", justifyContent: "center", color: colors.textMuted }}>
          <FolderPlus size={22} />
        </div>
        <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Choose a project</h1>
        <p style={{ margin: 0, color: colors.textMuted, fontSize: "0.95rem", lineHeight: 1.6 }}>
          Use the navigator to open a recent chat, expand a project, or create something new.
        </p>
        <button onClick={() => navigate("/")} style={btnPrimary}>
          Refresh navigator
        </button>
      </div>
    </div>
  );
}
