import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatEur } from "../lib/money";

export function MixChart({
  data,
}: {
  data: { name: string; value: number; color: string }[];
}) {
  const height = Math.max(160, data.length * 36);
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={118}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#44403C", fontSize: 12 }}
          />
          <Tooltip
            formatter={(value) => [formatEur(Number(value ?? 0)), "Spent"]}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid #E7E2D8",
              boxShadow: "0 8px 24px rgba(28, 25, 23, 0.06)",
            }}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={12}>
            {data.map((row) => (
              <Cell key={row.name} fill={row.color || "#3D6B4F"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
