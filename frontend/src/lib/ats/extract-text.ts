/**
 * Read a resume file into plain text IN THE BROWSER. Nothing is uploaded: the bytes are parsed
 * locally by pdf.js (PDF) or mammoth (DOCX). Both libraries are heavy, so they are imported
 * lazily and only when a file of that type is chosen, keeping them out of every other page.
 */
export const ATS_MAX_BYTES = 5 * 1024 * 1024;
export const ATS_ACCEPT = ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export function validateAtsFile(file: Pick<File, "name" | "size">): string | undefined {
  const name = file.name.toLowerCase();
  if (!/\.(pdf|docx|txt)$/.test(name)) return "Upload a PDF, DOCX or TXT file, or paste your resume text.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > ATS_MAX_BYTES) return "That file is over 5 MB.";
  return undefined;
}

interface PdfItem {
  str: string;
  transform?: number[];
  hasEOL?: boolean;
}

/** Rebuild lines from pdf.js text items: a new line starts when the baseline moves or the item says so. */
export function joinPdfItems(items: PdfItem[]): string {
  let out = "";
  let lastY: number | null = null;
  for (const it of items) {
    if (!("str" in it)) continue;
    const y = it.transform?.[5] ?? null;
    if (out && lastY !== null && y !== null && Math.abs(y - lastY) > 2) out += out.endsWith("\n") ? "" : "\n";
    else if (out && !out.endsWith("\n") && it.str && !out.endsWith(" ")) out += " ";
    out += it.str;
    if (it.hasEOL) out += "\n";
    if (y !== null) lastY = y;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(joinPdfItems(content.items as PdfItem[]));
  }
  await task.destroy();
  return pages.join("\n\n").trim();
}

async function docxText(data: ArrayBuffer): Promise<string> {
  const mod = (await import("mammoth/mammoth.browser.js")) as unknown as { default?: typeof import("mammoth/mammoth.browser.js") };
  const mammoth = mod.default ?? (mod as unknown as typeof import("mammoth/mammoth.browser.js"));
  const { value } = await mammoth.extractRawText({ arrayBuffer: data });
  // mammoth separates paragraphs with a blank line; one newline per paragraph matches PDF output.
  return value.replace(/\n{2,}/g, "\n").trim();
}

/** Throws an Error with a user-readable message if the file cannot be read. */
export async function extractResumeText(file: File): Promise<string> {
  const problem = validateAtsFile(file);
  if (problem) throw new Error(problem);
  const name = file.name.toLowerCase();
  try {
    const text = name.endsWith(".txt") ? await file.text() : name.endsWith(".pdf") ? await pdfText(await file.arrayBuffer()) : await docxText(await file.arrayBuffer());
    if (text.trim().length < 20) throw new Error("empty");
    return text;
  } catch {
    throw new Error("We could not read text from that file. If it is a scanned image, paste the text instead.");
  }
}
