/** Cloudflare Worker: POST {text} -> {entries, model}. CORS limited to ALLOWED_ORIGINS, a per-client rate limit, a size
 *  limit, and the same reading code as the dev server (web/server/cvRead.ts). Nothing is stored or logged. */
import { MAX_CV_CHARS, readCv } from "../../web/server/cvRead";

interface Env {
  OPENAI_API_KEY: string; MODEL: string; EFFORT: "low" | "medium" | "high"; ALLOWED_ORIGINS: string;
  LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

const MAX_BODY = 200_000;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
    const cors: Record<string, string> = allowed.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" }
      : {};
    const send = (status: number, body: unknown) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (!cors["Access-Control-Allow-Origin"]) return send(403, { error: "origin not allowed" });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" } });
    if (req.method !== "POST") return send(405, { error: "POST only" });
    // The client address is used only as the rate-limit key for this request; it is not stored by this code.
    const { success } = await env.LIMITER.limit({ key: req.headers.get("CF-Connecting-IP") ?? "unknown" });
    if (!success) return send(429, { error: "too many requests; try again in a minute" });
    if (Number(req.headers.get("Content-Length") ?? 0) > MAX_BODY) return send(413, { error: "too large" });
    try {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return send(413, { error: "too large" });
      const { text } = JSON.parse(raw) as { text?: unknown };
      if (typeof text !== "string" || text.length > MAX_CV_CHARS) return send(400, { error: "text missing or too long" });
      return send(200, { entries: await readCv(text, { apiKey: env.OPENAI_API_KEY, model: env.MODEL, effort: env.EFFORT }), model: env.MODEL });
    } catch {
      return send(502, { error: "the reader failed" });       // no details: an error message could echo CV text
    }
  },
};
