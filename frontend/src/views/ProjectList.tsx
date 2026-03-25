import React from "react";
import { useNavigate } from "react-router-dom";
import { FolderPlus } from "lucide-react";
import { btnPrimary, colors } from "../styles";

export function ProjectList() {
  const navigate = useNavigate();

  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
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
