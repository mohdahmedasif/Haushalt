import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  caption,
  onClick,
  size = "default",
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  onClick?: () => void;
  size?: "default" | "hero";
}) {
  const inner = (
    <>
      <div className="stat-label">{label}</div>
      <div className={`stat-value${size === "hero" ? " hero" : ""}`}>{value}</div>
      {caption && <div className="stat-caption">{caption}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="stat-card clickable" onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className="stat-card">{inner}</div>;
}
