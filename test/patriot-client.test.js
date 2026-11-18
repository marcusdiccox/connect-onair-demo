import test from "node:test";
import assert from "node:assert/strict";
import { requestProfileDraft, requestDocumentText } from "../src/patriot-client.js";

test("the client sends only source text and handles a validated draft", async () => {
  const draft = { name: "Jordan" };
  const result = await requestProfileDraft("Jordan", { fetch: async (url, init) => {
    assert.equal(new URL(url).pathname, "/api/profile-draft");
    assert.deepEqual(JSON.parse(init.body), { source: "Jordan" });
    assert.equal(init.credentials, "omit");
    return Response.json({ draft });
  } });
  assert.deepEqual(result, draft);
});

test("document reading sends only prepared images and returns editable text", async () => {
  const result = await requestDocumentText(["data:image/jpeg;base64,test"], { fetch: async (url, init) => {
    assert.equal(new URL(url).pathname, "/api/read-document");
    assert.deepEqual(JSON.parse(init.body), { images: ["data:image/jpeg;base64,test"] });
    return Response.json({ text: "Jordan Example", notes: ["Check unclear words."] });
  } });
  assert.equal(result.text, "Jordan Example");
  assert.equal(result.notes.length, 1);
});

test("draft warnings reach the UI and connection errors give a useful next step", async () => {
  let warnings;
  await requestProfileDraft("Jordan", { fetch: async () => Response.json({ draft: { name: "Jordan" }, warnings: ["Left one field blank."] }), onWarnings: value => { warnings = value; } });
  assert.deepEqual(warnings, ["Left one field blank."]);
  await assert.rejects(requestProfileDraft("Jordan", { fetch: async () => { throw new TypeError("network"); } }), /could not reach/);
});

test("the client explains provider errors and rejects oversized input locally", async () => {
  await assert.rejects(requestProfileDraft("x".repeat(20001)), /20,000/);
  await assert.rejects(requestProfileDraft("Jordan", { fetch: async () => Response.json({ error: "PatriotAI reached its limit." }, { status: 429 }) }), /reached its limit/);
  await assert.rejects(requestProfileDraft("Jordan", { fetch: async () => new Response("invalid") }), /could not read/);
});
