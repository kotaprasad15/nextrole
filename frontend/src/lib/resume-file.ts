/** Mirrors the backend resume rules (PDF or DOCX, 5 MB, non-empty) so errors show before upload. */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const RESUME_ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Returns an error message, or undefined when the file is acceptable. Server stays the authority. */
export function validateResume(file: Pick<File, "name" | "size">): string | undefined {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && !name.endsWith(".docx")) return "Upload a PDF or DOCX file. Older .doc files are not supported.";
  if (file.size === 0) return "That file is empty. Choose a different one.";
  if (file.size > MAX_RESUME_BYTES) return `That file is ${formatBytes(file.size)}. The limit is 5 MB.`;
  return undefined;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
