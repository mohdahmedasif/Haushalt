import { formatEur } from "../lib/money";

export function Money({
  value,
  absolute = false,
}: {
  value: number;
  absolute?: boolean;
}) {
  const shown = absolute ? Math.abs(value) : value;
  const tone = value > 0 ? "var(--positive)" : value < 0 ? "var(--negative)" : undefined;
  return (
    <span className="money" style={{ color: tone }}>
      {formatEur(shown)}
    </span>
  );
}
