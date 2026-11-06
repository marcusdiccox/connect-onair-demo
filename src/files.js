import { validateUpload, MAX_TEXT } from './domain.js';

export async function extractDocument(file) {
  const extension = validateUpload(file);
  let text;
  if (extension === 'txt') {
    text = await file.text();
    if (text.includes('\u0000')) throw new Error('This file is not a plain text document.');
  } else if (extension === 'docx') {
    const { default: mammoth } = await import('mammoth/mammoth.browser.js');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    text = result.value;
  } else {
    const pdfjs = await import('pdfjs-dist');
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    let document;
    try {
      document = await task.promise;
      if (document.numPages > 50) throw new Error('Use a PDF with 50 pages or fewer.');
      const pages = [];
      let length = 0;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('');
        length += pageText.length;
        if (length > MAX_TEXT) throw new Error('Use a shorter document, up to 50,000 characters.');
        pages.push(pageText);
      }
      text = pages.join('\n');
    } finally {
      await task.destroy();
    }
  }
  if (!text?.trim()) throw new Error('No text was found. For a scanned document, paste its text into the profile field.');
  if (text.length > MAX_TEXT) throw new Error('Use a shorter document, up to 50,000 characters.');
  return text.trim();
}
