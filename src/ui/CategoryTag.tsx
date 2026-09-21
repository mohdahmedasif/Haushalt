export function CategoryTag({
  name,
  color,
}: {
  name: string;
  color?: string;
}) {
  return (
    <span
      className="category-tag"
      style={{
        background: color ? `${color}22` : "var(--primary-soft)",
        color: color || "var(--primary)",
      }}
    >
      {name}
    </span>
  );
}
