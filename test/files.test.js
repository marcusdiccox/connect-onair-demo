import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import * as intake from "../src/files.js";

const file = (name, value) => new File([value], name);
const zipped = (name, entries) => file(name, zipSync(Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, strToU8(value)]))));

function pdfFile(pages) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (let index = 0; index < pages.length; index++) {
    const content = pages[index] ? `BT /F1 12 Tf 40 700 Td (${pages[index]}) Tj ET` : "";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return file("resume.pdf", source);
}

const docxEntries = text => ({
  "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
});

test("reads common plain-text formats and rejects binary disguised as text", async () => {
  for (const name of ["resume.txt", "resume.md", "resume.csv", "resume.json"]) {
    assert.equal(await intake.extractDocument(file(name, "  Alex Rivera\nPython  ")), "Alex Rivera\nPython");
  }
  await assert.rejects(intake.extractDocument(file("binary.txt", "bad\0text")), /plain text/i);
});

test("HTML extraction discards executable and hidden content and preserves readable boundaries", async () => {
  const html = '<style>.x{color:red}</style><script>alert(1)</script><h1>Alex &amp; Sam</h1><p>Experience<br>Engineer &#x1f680;</p>';
  const text = await intake.extractDocument(file("resume.html", html));
  assert.match(text, /Alex & Sam\s+Experience\s+Engineer 🚀/);
  assert.doesNotMatch(text, /alert|color:red|<h1>/);
});

test("HTML table cells retain word boundaries", async () => {
  assert.equal(await intake.extractDocument(file("resume.htm", "<table><tr><td>Alex</td><td>Engineer</td></tr></table>")), "Alex\tEngineer");
});

test("RTF reads formatting, escaped accents and unicode while omitting metadata", async () => {
  const text = await intake.extractDocument(file("resume.rtf", "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\*\\generator Secret;}Alex \\b Engineer\\b0\\par Caf\\'e9 \\u233? \\{ok\\}}"));
  assert.match(text, /Alex Engineer\s+Café é \{ok\}/);
  assert.doesNotMatch(text, /Arial|Secret|generator/);
});

test("ODT preserves paragraph text and escaped symbols", async () => {
  assert.equal(await intake.extractDocument(zipped("resume.odt", {"content.xml": '<office:document><text:p>Alex &amp; Sam</text:p><text:p>Engineer</text:p></office:document>'})), "Alex & Sam\nEngineer");
});

test("PPTX follows slide order numerically", async () => {
  const slides = {"ppt/slides/slide10.xml": '<a:p><a:t>Ten</a:t></a:p>', "ppt/slides/slide2.xml": '<a:p><a:t>Two</a:t></a:p>'};
  assert.equal(await intake.extractDocument(zipped("profile.pptx", slides)), "Two\nTen");
});

test("XLSX resolves shared strings and inline text alongside numeric cells", async () => {
  const workbook = {"xl/sharedStrings.xml": '<sst><si><t>Alex</t><r><t> Rivera</t></r></si></sst>', "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="inlineStr"><is><t>Engineer</t></is></c><c><v>2026</v></c></row></sheetData></worksheet>'};
  assert.equal(await intake.extractDocument(zipped("profile.xlsx", workbook)), "Alex Rivera\tEngineer\t2026");
});

test("images ask for vision and empty or oversized input is rejected", async () => {
  const picture = file("resume.PNG", "pixels");
  await assert.rejects(intake.extractDocument(picture), error => intake.needsVision(picture, error));
  await assert.rejects(intake.extractDocument(file("empty.txt", "")), /empty/i);
  await assert.rejects(intake.extractDocument(file("large.txt", "a".repeat(10 * 1024 * 1024 + 1))), /10 MB/i);
  await assert.rejects(intake.extractDocument(file("long.md", "a".repeat(50001))), /50,000/);
});

test("unsupported legacy formats give a conversion path", async () => {
  for (const name of ["resume.doc", "resume.heic", "resume.tiff", "resume.exe"]) {
    await assert.rejects(intake.extractDocument(file(name, "bytes")), /convert.*PDF.*JPG/i);
  }
});

test("corrupt Office files fail with a useful error rather than becoming OCR eligible", async () => {
  const broken = file("resume.pptx", "not a zip");
  await assert.rejects(intake.extractDocument(broken), error => /damaged|invalid/i.test(error.message) && !intake.needsVision(broken, error));
});

test("readable PDF text is extracted and mixed scanned pages request full-document reading", async () => {
  const text = "Alex Rivera is an experienced software engineer with Python and SQL skills.";
  assert.equal(await intake.extractDocument(pdfFile([text])), text);
  const mixed = pdfFile([text, ""]);
  await assert.rejects(intake.extractDocument(mixed), error => intake.needsVision(mixed, error));
});

test("invalid PDFs do not become eligible for AI reading", async () => {
  const broken = file("broken.pdf", "not a PDF");
  await assert.rejects(intake.extractDocument(broken), error => /damaged|unreadable/i.test(error.message) && !intake.needsVision(broken, error));
});

test("DOCX reads packaged Word text and offers picture-only fallback", async () => {
  assert.equal(await intake.extractDocument(zipped("resume.docx", docxEntries("Alex Rivera"))), "Alex Rivera");
  const pictured = zipped("resume.docx", { ...docxEntries(""), "word/media/image1.png": "image" });
  await assert.rejects(intake.extractDocument(pictured), error => intake.needsVision(pictured, error));
});

test("compressed Office documents cannot bypass the expanded document size limit", async () => {
  const expanded = zipped("resume.odt", { "content.xml": "a".repeat(21 * 1024 * 1024) });
  await assert.rejects(intake.extractDocument(expanded), /expands beyond/i);
});
