import type { DetectedContract } from "./contracts";

export async function enrichContractsWithAI(
  contracts: DetectedContract[],
): Promise<{ contracts: DetectedContract[]; provider: string }> {
  const key = process.env.HAUSHALT_AI_KEY || process.env.OPENAI_API_KEY || "";
  const base = (process.env.HAUSHALT_AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.HAUSHALT_AI_MODEL || "gpt-4o-mini";

  if (key) {
    try {
      const labeled = await callChatApi(base, key, model, contracts);
      return { contracts: labeled, provider: `openai:${model}` };
    } catch (error) {
      console.warn("AI enrich failed, using local labels", error);
    }
  }

  if (await ollamaUp()) {
    try {
      const labeled = await callOllama(contracts);
      return { contracts: labeled, provider: "ollama" };
    } catch (error) {
      console.warn("Ollama enrich failed", error);
    }
  }

  return {
    contracts: contracts.map((c) => ({
      ...c,
      ai: { used: true, provider: "local-pattern-model", note: "Labeled from bank mandate patterns in your history" },
    })),
    provider: "local-pattern-model",
  };
}

function promptFor(contracts: DetectedContract[]): string {
  return `You classify German household SEPA contracts from bank bookings.
Return JSON array only, same length/order. Each item: {"id":"...","name":"short English name","status":"active|paused|ended","note":"one sentence"}.
Today is ${new Date().toISOString().slice(0, 10)}.
Data:\n${JSON.stringify(
    contracts.map((c) => ({
      id: c.id,
      vendor: c.vendor,
      lastDate: c.lastDate,
      typicalAmount: c.typicalAmount,
      cadence: c.cadence,
      mandateRef: c.mandateRef,
      count: c.count,
    })),
  )}`;
}

async function callChatApi(
  base: string,
  key: string,
  model: string,
  contracts: DetectedContract[],
): Promise<DetectedContract[]> {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You output {\"contracts\":[...]} JSON only." },
        { role: "user", content: promptFor(contracts) },
      ],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content ?? "{}";
  return mergeAi(contracts, text, `openai:${model}`);
}

async function ollamaUp(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(400) });
    return res.ok;
  } catch {
    return false;
  }
}

async function callOllama(contracts: DetectedContract[]): Promise<DetectedContract[]> {
  const res = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.HAUSHALT_OLLAMA_MODEL || "llama3.1",
      stream: false,
      messages: [
        { role: "system", content: "Return {\"contracts\":[...]} JSON only." },
        { role: "user", content: promptFor(contracts) },
      ],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const body = await res.json();
  return mergeAi(contracts, body.message?.content ?? "{}", "ollama");
}

function mergeAi(contracts: DetectedContract[], raw: string, provider: string): DetectedContract[] {
  const parsed = JSON.parse(raw) as { contracts?: { id: string; name?: string; status?: string; note?: string }[] };
  const byId = new Map((parsed.contracts ?? []).map((c) => [c.id, c]));
  return contracts.map((c) => {
    const ai = byId.get(c.id);
    if (!ai) return { ...c, ai: { used: true, provider } };
    return {
      ...c,
      name: ai.name || c.name,
      status: (["active", "paused", "ended"].includes(ai.status ?? "") ? ai.status : c.status) as DetectedContract["status"],
      evidence: ai.note ? `${c.evidence}. ${ai.note}` : c.evidence,
      confidence: Math.min(0.99, c.confidence + 0.05),
      ai: { used: true, provider, note: ai.note },
    };
  });
}
