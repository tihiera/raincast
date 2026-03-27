import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  onClick?: () => void;
}

export default function ActionButton({ icon, title, onClick }: Props) {
  return (
    <button
      type="button"
      className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
      style={{ color: "var(--text-tertiary)" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--btn-subtle-hover-bg)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-tertiary)"; }}
      title={title}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
