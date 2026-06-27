import { createFileRoute } from "@tanstack/react-router";
import { generateChatReply } from "@/lib/deal-chat";
import { evaluateDeal } from "@/lib/risk-engine";
import dealDataRaw from "../../../backend/data/current_deal.json";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { message?: string };
          const message = body.message?.trim() ?? "";

          if (!message) {
            return new Response(JSON.stringify({ error: "message is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const payload = evaluateDeal(dealDataRaw);
          const reply = generateChatReply(payload, message);

          return new Response(JSON.stringify({ reply }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Chat failed";
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
