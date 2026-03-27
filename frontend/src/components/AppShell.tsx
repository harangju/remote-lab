import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import { AppNavigator } from "./AppNavigator";
import { colors } from "../styles";

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden", background: colors.bg }}>
      <AppNavigator mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <Outlet context={{ closeMobileNavigator: () => setMobileOpen(true) }} />
      </div>
    </div>
  );
}
