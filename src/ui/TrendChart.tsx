import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { formatEur } from "../lib/money";

export function TrendChart({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="leftoverFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3D6B4F" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#3D6B4F" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#78716C", fontSize: 12 }}
          />
          <Tooltip
            formatter={(value) => [formatEur(Number(value ?? 0)), "Leftover"]}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid #E7E2D8",
              boxShadow: "0 8px 24px rgba(28, 25, 23, 0.06)",
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#3D6B4F"
            fill="url(#leftoverFill)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
