import { useSearchParams } from "react-router-dom";
import { currentMonth } from "../lib/dates";

const MONTH_RE = /^\d{4}-\d{2}$/;

export function useMonth() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("month");
  const month = raw && MONTH_RE.test(raw) ? raw : currentMonth();

  const setMonth = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("month", next);
    setParams(nextParams, { replace: true });
  };

  return { month, setMonth, params };
}

export function withMonth(path: string, month: string, extra?: Record<string, string>) {
  const search = new URLSearchParams();
  search.set("month", month);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) search.set(key, value);
  }
  return `${path}?${search.toString()}`;
}
