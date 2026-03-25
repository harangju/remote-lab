import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import { AppNavigator } from "./AppNavigator";
import { btnIcon, colors } from "../styles";

const menuButtonStyle: React.CSSProperties = {
  ...btnIcon,
  cursor: "pointer",
  position: "fixed",
  top: 12,
  left: 12,
  zIndex: 1100,
  color: colors.textMuted,
};

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden", background: colors.bg }}>
      <button aria-label="Open navigator" style={menuButtonStyle} className="app-shell-mobile-menu" onClick={() => setMobileOpen(true)}>
        <Menu size={16} />
      </button>
      <AppNavigator mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <Outlet context={{ closeMobileNavigator: () => setMobileOpen(true) }} />
      </div>
    </div>
  );
}
