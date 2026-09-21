import { formatEur } from "./money";
import { formatMonth } from "./dates";
import { summarizeMonth } from "./summary";
import type { Forecast } from "./forecast";
import type { DetectedContract } from "./contracts";
import type { Category, Transaction } from "../types";

export interface AskAnswer {
  question: string;
  answer: string;
  bullets: string[];
}

export function answerFinanceQuestion(
  question: string,
  ctx: {
    month: string;
    transactions: Transaction[];
    categories: Category[];
    contracts: DetectedContract[];
    forecast: Forecast;
  },
): AskAnswer {
  const q = question.toLowerCase();
  const summary = summarizeMonth(ctx.month, ctx.transactions, ctx.categories);
  const bullets: string[] = [];

  if (/until payday|verfügbar|available|reicht|safe to spend|bis gehalt/.test(q)) {
    return {
      question,
      answer: ctx.forecast.availableUntilSalary == null
        ? "Set your bank balance to see how much is left until payday."
        : `${formatEur(ctx.forecast.availableUntilSalary)} is left until payday after remaining contracts.`,
      bullets: [
        ctx.forecast.nextSalaryDate
          ? `Payday around ${ctx.forecast.nextSalaryDate} (${ctx.forecast.daysUntilSalary} days).`
          : "No salary pattern yet.",
        ctx.forecast.remainingOutflows
          ? `Still expected out: ${formatEur(-ctx.forecast.remainingOutflows)}.`
          : "No remaining contract debits before payday.",
        ctx.forecast.forecastTomorrow != null
          ? `Tomorrow: ${formatEur(ctx.forecast.forecastTomorrow)}. In 7 days: ${formatEur(ctx.forecast.forecastIn7Days ?? 0)}.`
          : "",
      ].filter(Boolean),
    };
  }

  if (/gehalt|salary|payday|lohn/.test(q)) {
    return {
      question,
      answer: ctx.forecast.nextSalaryDate
        ? `Next salary is around ${ctx.forecast.nextSalaryDate} for about ${formatEur(ctx.forecast.nextSalaryAmount)} (${ctx.forecast.daysUntilSalary} days).`
        : "I have not seen a salary booking yet.",
      bullets: [
        ctx.forecast.availableUntilSalary != null
          ? `Safe to spend until then: ${formatEur(ctx.forecast.availableUntilSalary)} after remaining contracts.`
          : "Set your bank balance to get a safe-to-spend number.",
      ],
    };
  }

  if (/vertrag|abo|fixkosten|contract/.test(q)) {
    const active = ctx.contracts.filter((c) => c.status === "active" && c.typicalAmount < 0);
    return {
      question,
      answer: `You have ${active.length} active contracts. Monthly fixed costs are about ${formatEur(ctx.forecast.monthlyFixedCosts)}.`,
      bullets: active.slice(0, 8).map((c) => `${c.name}: ${formatEur(c.typicalAmount)} (${c.cadence})`),
    };
  }

  if (/sparen|save|spar/.test(q)) {
    if (!ctx.forecast.savings.length) {
      return { question, answer: "No obvious unused-Abo overlap this month besides watching shopping and family transfers.", bullets: [] };
    }
    return {
      question,
      answer: "Biggest levers from your own bookings:",
      bullets: ctx.forecast.savings.map((s) => `${s.title}: ${s.body}`),
    };
  }

  if (/kontostand|balance|giro/.test(q)) {
    return {
      question,
      answer: ctx.forecast.bankBalance == null
        ? "No Girokonto snapshot yet."
        : `Bank balance is ${formatEur(ctx.forecast.bankBalance)}. After remaining contracts, about ${formatEur(ctx.forecast.availableUntilSalary ?? 0)} until payday. Forecast after salary: ${formatEur(ctx.forecast.forecastAtSalary ?? 0)}.`,
      bullets: [`Cash wallet ${formatEur(ctx.forecast.cashOnHand)} is separate.`],
    };
  }

  const cat = ctx.categories.find((c) => q.includes(c.name.toLowerCase()) || q.includes(c.id));
  if (cat) {
    const amt = summary.byCategory[cat.id] ?? 0;
    return {
      question,
      answer: `${cat.name} in ${formatMonth(ctx.month)} is ${formatEur(amt)} (budget ${formatEur(cat.budget)}).`,
      bullets: [],
    };
  }

  bullets.push(`Income ${formatEur(summary.income)}, expenses ${formatEur(summary.expense)}, leftover ${formatEur(summary.leftover)}.`);
  bullets.push(`Fixkosten ~ ${formatEur(ctx.forecast.monthlyFixedCosts)} / month.`);
  if (ctx.forecast.savings[0]) bullets.push(ctx.forecast.savings[0].body);
  return {
    question,
    answer: `For ${formatMonth(ctx.month)}: leftover ${formatEur(summary.leftover)}. Ask about salary, contracts, savings, or a category.`,
    bullets,
  };
}
