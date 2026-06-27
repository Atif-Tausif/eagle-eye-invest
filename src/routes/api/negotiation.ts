import { createFileRoute } from "@tanstack/react-router";
import {
  evaluateNegotiationOpportunities,
  type NegotiationPayload,
} from "@/lib/negotiation-engine";
import dealDataRaw from "../../../backend/data/current_deal.json";

async function loadNegotiationPayload(): Promise<NegotiationPayload> {
  return evaluateNegotiationOpportunities(dealDataRaw);
}

export const Route = createFileRoute("/api/negotiation")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const payload = await loadNegotiationPayload();
          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to load negotiation payload";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
