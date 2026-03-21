import React, { useEffect, useRef } from "react";
import { overlayBackdrop, overlayHeader, overlayPanel } from "../styles";

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
      <div onClick={onClose} style={overlayBackdrop} />
      <div
        ref={panelRef}
        style={{
          ...overlayPanel,
          top: "12vh",
          left: "50%",
          transform: "translateX(-50%)",
          width,
          maxHeight,
        }}
      >
        <div style={overlayHeader}>
          <span>{title}</span>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {children}
        </div>
      </div>
    </>
  );
}
