import React, { useEffect, useRef } from "react";

interface ListModalProps {
  title: string;
  children: React.ReactNode;
  width?: string;
  maxHeight?: string;
  onClose: () => void;
}

export function ListModal({ title, children, width = "min(520px, 92vw)", maxHeight = "70vh", onClose }: ListModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: 1000,
        }}
      />
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          top: "12vh",
          left: "50%",
          transform: "translateX(-50%)",
          width,
          maxHeight,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          zIndex: 1001,
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: "0.82rem",
          color: "var(--text-muted)",
        }}>
          <span>{title}</span>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {children}
        </div>
      </div>
    </>
  );
}
