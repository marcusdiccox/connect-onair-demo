export const DOCUMENT_EXTENSIONS = ["pdf", "docx", "txt", "md", "csv", "json", "html", "htm", "rtf", "odt", "pptx", "xlsx", "png", "jpg", "jpeg", "webp", "gif", "bmp"];
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.map(extension => `.${extension}`).join(",");
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export function validateDocument(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0)
    throw new Error("Choose a document that is not empty.");
  if (file.size > DOCUMENT_MAX_BYTES)
    throw new Error("Choose a file of 10 MB or less.");
  const extension = file.name?.split(".").pop()?.toLowerCase();
  if (!DOCUMENT_EXTENSIONS.includes(extension))
    throw new Error("This file format is not supported. Convert it to PDF, DOCX, TXT, PNG, or JPG and try again.");
  return extension;
}
