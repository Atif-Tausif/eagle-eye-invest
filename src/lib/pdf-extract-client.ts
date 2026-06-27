/**
 * Client-side PDF text extraction using pdfjs-dist.
 * Runs in the browser where real web workers are available — no worker errors.
 */
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const FIN_KEYWORDS = /net\s+operating\s+income|NOI|pro\s+forma|renovation|capital\s+expenditure/i;
const YEAR1_KEYWORDS = /year\s*1|yr\.?\s*1/i;

async function extractPages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 20) pages.push(text);
  }
  return pages;
}

export async function extractOmSections(
  file: File,
): Promise<{ cover: string; financials: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pages = await extractPages(bytes);

  const cover = pages.slice(0, 3).join("\n\n---\n\n");

  const finPages = pages.filter((p) => FIN_KEYWORDS.test(p));
  const year1Pages = finPages.filter((p) => YEAR1_KEYWORDS.test(p));
  const financials = (year1Pages.length ? year1Pages : finPages)
    .slice(0, 4)
    .join("\n\n---\n\n");

  return { cover, financials };
}
