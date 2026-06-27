import { createFileRoute } from "@tanstack/react-router";
import { evaluateDeal, type EnginePayload } from "@/lib/risk-engine";
import dealData from "../../../backend/data/current_deal.json";

async function loadEnginePayload(): Promise<EnginePayload> {
  return evaluateDeal(dealData);
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
