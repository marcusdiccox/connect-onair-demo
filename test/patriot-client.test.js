import test from "node:test";
import assert from "node:assert/strict";
import { requestProfileDraft } from "../src/patriot-client.js";

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

test("the client explains provider errors and rejects oversized input locally", async () => {
  await assert.rejects(requestProfileDraft("x".repeat(20001)), /20,000/);
  await assert.rejects(requestProfileDraft("Jordan", { fetch: async () => Response.json({ error: "PatriotAI reached its limit." }, { status: 429 }) }), /reached its limit/);
  await assert.rejects(requestProfileDraft("Jordan", { fetch: async () => new Response("invalid") }), /could not read/);
});
