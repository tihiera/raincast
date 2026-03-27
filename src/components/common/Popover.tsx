import { useRef, useEffect, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onClose: () => void;
  width?: number;
  style?: React.CSSProperties;
}

export default function Popover({ children, onClose, width = 240, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        width,
        padding: "6px",
        background: "var(--popover-bg)",
        borderRadius: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)",
        border: "1px solid var(--popover-border)",
        zIndex: 100,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
