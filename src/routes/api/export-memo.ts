import { createFileRoute } from "@tanstack/react-router";
import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEAL_PATH = join(process.cwd(), "backend", "data", "current_deal.json");
const MEMO_SCRIPT = join(process.cwd(), "backend", "services", "memo_generator.py");

export const Route = createFileRoute("/api/export-memo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ts = Date.now();
        const tempOverrides = join(tmpdir(), `memo_overrides_${ts}.json`);
        const tempPdf = join(tmpdir(), `deal_memo_${ts}.pdf`);

        try {
          // Accept optional overrides body: { analyst_notes, verdict, sections }
          const body = await request.json().catch(() => ({}));
          await writeFile(tempOverrides, JSON.stringify(body), "utf-8");

          await execFileAsync("python", [
            MEMO_SCRIPT,
            "--deal", DEAL_PATH,
            "--overrides", tempOverrides,
            "--out", tempPdf,
          ], { timeout: 30_000 });

          const pdfBytes = await readFile(tempPdf);

          // Derive a tidy filename from the overrides or fallback
          const filename = "deal-memo.pdf";

          return new Response(pdfBytes, {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="${filename}"`,
              "Content-Length": pdfBytes.length.toString(),
              "Cache-Control": "no-store",
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to generate memo";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        } finally {
          await unlink(tempOverrides).catch(() => {});
          await unlink(tempPdf).catch(() => {});
        }
      },
    },
  },
});
