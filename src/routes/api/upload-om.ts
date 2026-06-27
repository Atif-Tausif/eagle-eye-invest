import { createFileRoute } from "@tanstack/react-router";
import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEAL_PATH = join(process.cwd(), "backend", "data", "current_deal.json");
const MERGE_SCRIPT = join(process.cwd(), "backend", "scripts", "merge_deal_data.py");

export const Route = createFileRoute("/api/upload-om")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ts = Date.now();
        let tempPdf = "";

        try {
          const formData = await request.formData();
          const file = formData.get("file");
          if (!(file instanceof File)) {
            return new Response(JSON.stringify({ error: "No file uploaded" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (!file.name.toLowerCase().endsWith(".pdf")) {
            return new Response(JSON.stringify({ error: "Only PDF files are supported" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          tempPdf = join(tmpdir(), `${ts}_${safeName}`);

          const bytes = Buffer.from(await file.arrayBuffer());
          await writeFile(tempPdf, bytes);

          await execFileAsync("python", [
            MERGE_SCRIPT,
            tempPdf,
            "--out", DEAL_PATH,
          ], { timeout: 30_000 });

          const dealJson = await readFile(DEAL_PATH, "utf-8");
          return new Response(dealJson, {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to process uploaded OM";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        } finally {
          if (tempPdf) await unlink(tempPdf).catch(() => {});
        }
      },
    },
  },
});
