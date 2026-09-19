import Groq from "groq-sdk";

const apiKey = process.env.GROQ_API_KEY?.trim();
const model = process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";

const client = apiKey ? new Groq({ apiKey }) : null;

export const llmAvailable = !!client;

/** Calls the configured open-source model (via Groq) with a prompt that
 * must return JSON, and parses the result. Throws if no API key is
 * configured — callers are expected to fall back to the deterministic
 * heuristic path (see pipeline/mapping.ts) when llmAvailable is false, so
 * the whole pipeline still runs end-to-end without any API key. */
export async function callLLMJson<T>(system: string, user: string): Promise<T> {
  if (!client) {
    throw new Error("GROQ_API_KEY not configured — no LLM available");
  }

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(text) as T;
}
