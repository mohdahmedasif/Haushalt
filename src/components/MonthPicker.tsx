import { DatePicker } from "antd";
import dayjs from "dayjs";

export function MonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <DatePicker
      picker="month"
      value={dayjs(`${month}-01`)}
      onChange={(value) => {
        if (value) onChange(value.format("YYYY-MM"));
      }}
      allowClear={false}
    />
  );
}
