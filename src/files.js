import { MAX_TEXT } from "./domain.js";
import { validateDocument, IMAGE_EXTENSIONS } from "./document-types.js";
import { unzipSync, strFromU8 } from "fflate";

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PAGES = 10;

function visionRequired(message) {
  return Object.assign(new Error(message), { code: "VISION_REQUIRED" });
}

export function needsVision(file, error) {
  try {
    const extension = validateDocument(file);
    return IMAGE_EXTENSIONS.includes(extension) || (["pdf", "docx"].includes(extension) && error?.code === "VISION_REQUIRED");
  } catch {
    return false;
  }
}

function decodeEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const point = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  });
}

function markupText(value) {
  return decodeEntities(value.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<(?:br|text:line-break)\b[^>]*\/?\s*>/gi, "\n").replace(/<\/(?:p|div|h[1-6]|li|tr|a:p|text:p|text:h)>/gi, "\n").replace(/<text:tab\b[^>]*\/?\s*>/gi, "\t").replace(/<\/(?:td|th)>/gi, "\t").replace(/<[^>]*>/g, "")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function rtfText(value) {
  if (!/^\s*\{\\rtf\d/.test(value)) throw new Error("This RTF file is invalid. Export it as PDF or TXT and try again.");
  const states = [{ skip: false, unicodeSkip: 1 }];
  let output = "";
  let fallback = 0;
  const decoder = new TextDecoder("windows-1252");
  for (let i = 0; i < value.length;) {
    const state = states.at(-1);
    const char = value[i++];
    if (char === "{") { states.push({ ...state }); continue; }
    if (char === "}") { if (states.length > 1) states.pop(); continue; }
    if (char !== "\\") {
      if (fallback > 0 && !/[\r\n]/.test(char)) fallback--;
      else if (!state.skip && !/[\r\n]/.test(char)) output += char;
      continue;
    }
    const next = value[i++];
    if (next === "*") { state.skip = true; continue; }
    let literal;
    if (next === "'") { literal = decoder.decode(Uint8Array.of(parseInt(value.slice(i, i + 2), 16))); i += 2; }
    else if (/[\\{}]/.test(next)) literal = next;
    else if (next === "~") literal = " ";
    else if (next === "_") literal = "-";
    if (literal !== undefined) {
      if (fallback > 0) fallback--;
      else if (!state.skip) output += literal;
      continue;
    }
    if (!/[a-z]/i.test(next ?? "")) continue;
    i--;
    const control = /^([a-z]+)(-?\d+)? ?/i.exec(value.slice(i));
    i += control[0].length;
    const word = control[1].toLowerCase();
    const number = Number(control[2]);
    if (["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "fldinst", "xmlnstbl"].includes(word)) state.skip = true;
    if (word === "bin" && number > 0) { i += number; continue; }
    if (word === "uc") state.unicodeSkip = number;
    if (state.skip) continue;
    if (word === "u") { output += String.fromCharCode(number < 0 ? number + 65536 : number); fallback = state.unicodeSkip; }
    else if (["par", "line"].includes(word)) output += "\n";
    else if (word === "tab") output += "\t";
    else if (word === "emdash") output += "—";
    else if (word === "endash") output += "–";
    else if (word === "bullet") output += "•";
  }
  return output.trim();
}

async function readArchive(file) {
  let expanded = 0;
  let count = 0;
  try {
    return unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
      expanded += entry.originalSize;
      if (++count > 1000 || expanded > MAX_ARCHIVE_BYTES) throw new Error("The document expands beyond the supported size. Export it as a smaller PDF or TXT file.");
      return /^(?:word\/document\.xml|word\/media\/[^/]+|content\.xml|ppt\/slides\/slide\d+\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml)$/.test(entry.name);
    } });
  } catch (error) {
    if (/expands beyond/.test(error.message)) throw error;
    throw new Error("This document is damaged, encrypted, or invalid. Export a fresh PDF or TXT file and try again.");
  }
}

function archiveText(entries, extension) {
  const read = name => entries[name] ? strFromU8(entries[name]) : "";
  if (extension === "odt") return markupText(read("content.xml"));
  if (extension === "pptx") return Object.keys(entries).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(name => markupText(read(name))).join("\n");
  const strings = [...read("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => markupText(match[1]));
  return Object.keys(entries).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(name => [...read(name).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row => [...row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(cell => {
    const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] ?? "";
    if (/\bt=["']s["']/.test(cell[1])) return strings[Number(value)] ?? "";
    return /\bt=["']inlineStr["']/.test(cell[1]) ? markupText(cell[2]) : decodeEntities(value);
  }).join("\t")).join("\n")).join("\n");
}

async function openPdf(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    const { default: workerUrl } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  try { return { document: await task.promise, task }; }
  catch (error) {
    await task.destroy();
    if (error.name === "PasswordException") throw new Error("This PDF is password protected. Save an unlocked copy and try again.");
    throw new Error("This PDF is damaged or unreadable. Export a fresh PDF and try again.");
  }
}

export async function extractDocument(file) {
  const extension = validateDocument(file);
  let text;
  if (IMAGE_EXTENSIONS.includes(extension)) throw visionRequired("This picture needs AI document reading.");
  if (["txt", "md", "csv", "json", "html", "htm", "rtf"].includes(extension)) {
    text = await file.text();
    if (text.includes("\u0000")) throw new Error("This file is not a plain text document. Export it as UTF-8 text or PDF.");
    if (["html", "htm"].includes(extension)) text = markupText(text);
    if (extension === "rtf") text = rtfText(text);
  } else if (["odt", "pptx", "xlsx", "docx"].includes(extension)) {
    const entries = await readArchive(file);
    if (extension === "docx") {
      const { default: mammoth } = await import("mammoth/mammoth.browser.js");
      try { text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value; }
      catch { throw new Error("This DOCX is damaged or invalid. Export it as PDF and try again."); }
      if (!text.trim() && Object.keys(entries).some(name => name.startsWith("word/media/"))) throw visionRequired("This DOCX contains pictures instead of selectable text. AI document reading can read its pictures.");
    } else text = archiveText(entries, extension);
  } else {
    const { document, task } = await openPdf(file);
    try {
      if (document.numPages > 50) throw new Error("Use a PDF with 50 pages or fewer.");
      const pages = [];
      let length = 0;
      let sparse = false;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => (item.str ?? "") + (item.hasEOL ? "\n" : " ")).join("");
        const compact = pageText.replace(/\s/g, "");
        const readable = compact.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
        sparse ||= compact.length < 40 || readable / compact.length < 0.35 || (compact.match(/\ufffd/g)?.length ?? 0) / compact.length > 0.05;
        length += pageText.length;
        if (length > MAX_TEXT) throw new Error("Use a shorter document, up to 50,000 characters.");
        pages.push(pageText);
        page.cleanup();
      }
      if (sparse) throw visionRequired("Some PDF pages have little or unreadable text. AI document reading can read every page, including scans.");
      text = pages.join("\n");
    } finally { await task.destroy(); }
  }
  if (!text?.trim()) throw new Error("No readable text was found. Export this document as PDF or paste its text.");
  if (text.length > MAX_TEXT) throw new Error("Use a shorter document, up to 50,000 characters.");
  return text.trim();
}

function imageData(canvas) {
  const data = canvas.toDataURL("image/jpeg", 0.85);
  if (!data.startsWith("data:image/jpeg;base64,")) throw new Error("The browser could not prepare this image. Try a smaller JPG or PDF.");
  if (data.length > MAX_IMAGE_BYTES) throw new Error("A document image exceeds 3 MB after preparation. Try a smaller image or PDF.");
  return data;
}

async function prepareImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); }
    catch { throw new Error("This picture could not be decoded. Convert it to JPG or PNG and try again."); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40000000) throw new Error("This picture is too large to read. Use an image with 40 megapixels or fewer.");
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = imageData(canvas);
    canvas.width = canvas.height = 0;
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export async function prepareDocumentImages(file) {
  const extension = validateDocument(file);
  if (!IMAGE_EXTENSIONS.includes(extension) && !["pdf", "docx"].includes(extension)) throw new Error("AI document reading supports pictures, PDF pages, and picture-only DOCX documents.");
  if (typeof document === "undefined") throw new Error("Prepare document images in a browser.");
  const images = [];
  let total = 0;
  const append = data => {
    total += data.length;
    if (total > MAX_IMAGES_BYTES) throw new Error("This document exceeds the 12 MB AI reading limit. Split it into smaller documents.");
    images.push(data);
  };
  if (IMAGE_EXTENSIONS.includes(extension)) append(await prepareImage(file));
  else if (extension === "docx") {
    const entries = await readArchive(file);
    const names = Object.keys(entries).filter(name => /^word\/media\/.*\.(?:png|jpe?g|webp|gif|bmp)$/i.test(name));
    if (!names.length) throw new Error("No supported pictures were found in this DOCX. Export it as PDF and try again.");
    if (names.length > MAX_IMAGE_PAGES) throw new Error("AI document reading supports up to 10 pictures. Split this DOCX into smaller documents.");
    for (const name of names) append(await prepareImage(new Blob([entries[name]])));
  } else {
    const { document: pdf, task } = await openPdf(file);
    try {
      if (pdf.numPages > MAX_IMAGE_PAGES) throw new Error("AI document reading supports up to 10 PDF pages. Split this PDF into smaller documents.");
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 2000 / Math.max(base.width, base.height)) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        try {
          await page.render({ canvasContext: canvas.getContext("2d"), viewport, background: "rgb(255,255,255)" }).promise;
          append(imageData(canvas));
        } finally { canvas.width = canvas.height = 0; page.cleanup(); }
      }
    } finally { await task.destroy(); }
  }
  return { images, pageCount: images.length };
}
