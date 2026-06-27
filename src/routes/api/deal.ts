import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateDeal, type EnginePayload } from "@/lib/risk-engine";

const DEAL_PATH = join(process.cwd(), "backend", "data", "current_deal.json");

async function loadEnginePayload(): Promise<EnginePayload> {
  const raw = await readFile(DEAL_PATH, "utf-8");
  const deal = JSON.parse(raw);
  return evaluateDeal(deal);
}

export const Route = createFileRoute("/api/deal")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const payload = await loadEnginePayload();
          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load deal payload";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
