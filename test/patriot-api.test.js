import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../server/patriot.js";

const origin = "https://marcusdiccox.github.io";
const env = { PATRIOT_API_KEY: "test-secret" };
const source = "Jordan Example\nSkills: Python, SQL\nProjects: Built a Python script and SQL class project.";
const draft = { name: "Jordan Example", education: "", experience: "Built a Python script and SQL class project.", skills: ["Python", "SQL"], interests: [], evidence: [{ field: "name", quote: "Jordan Example" }, { field: "skills", quote: "Skills: Python, SQL" }, { field: "experience", quote: "Built a Python script and SQL class project." }] };
const request = (body, from = origin) => new Request("https://api.example/api/profile-draft", { method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const upstream = (value, status = 200) => async () => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }, { status });

test("the public GitHub website can draft without owner login and never receives credentials", async () => {
  let call;
  const response = await handleRequest(request({ source }), env, async (url, init) => {
    call = { url, init };
    return upstream(draft)();
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  const result = await response.json();
  assert.equal(result.draft.name, "Jordan Example");
  assert.ok(result.draft.evidence.length);
  assert.equal(call.init.headers["api-key"], "test-secret");
  assert.match(call.url, /^https:\/\/apim-n1ai-use-gmun1\.azure-api\.net\//);
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
});

test("rejects other origins, oversized or empty sources before spending tokens", async () => {
  const noCall = () => { throw new Error("must not call model"); };
  for (const [body, from, status] of [[{ source }, "https://other.example", 403], [{ source: "" }, origin, 400], [{ source: "x".repeat(20001) }, origin, 400]]) {
    assert.equal((await handleRequest(request(body, from), env, noCall)).status, status);
  }
});

test("unsupported claims are left out without discarding valid fields", async () => {
  const response = await handleRequest(request({ source }), env, upstream({ ...draft, skills: ["React"] }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.draft.skills, []);
  assert.equal(result.draft.name, "Jordan Example");
  assert.ok(result.warnings.length);
  assert.equal((await handleRequest(request({ source }), env, upstream({ ...draft, evidence: [{ field: "name", quote: "Made up source" }] }))).status, 422);
});

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=";
const imageRequest = body => new Request("https://api.example/api/read-document", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("vision reads uploaded pages as data and returns text for review", async () => {
  const response = await handleRequest(imageRequest({ images: [image] }), env, async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.messages[1].content[1].type, "image_url");
    assert.equal(body.messages[1].content[1].image_url.url, image);
    return upstream({ text: "Jordan Example\nSkills: Python, SQL", notes: [] })();
  });
  assert.equal(response.status, 200);
  assert.match((await response.json()).text, /Python/);
});

test("vision rejects URLs, invalid images and too many pages without calling upstream", async () => {
  const noCall = () => { throw new Error("must not call model"); };
  for (const images of [[], ["https://example.com/private"], ["data:image/png;base64,aGVsbG8="], Array(11).fill(image)]) {
    assert.equal((await handleRequest(imageRequest({ images }), env, noCall)).status, 400);
  }
});

test("vision reports unreadable or cut-off text instead of silently losing pages", async () => {
  assert.equal((await handleRequest(imageRequest({ images: [image] }), env, upstream({ text: "", notes: [] }))).status, 422);
  const cut = async () => Response.json({ choices: [{ finish_reason: "length", message: { content: '{"text":"cut' } }] });
  assert.equal((await handleRequest(imageRequest({ images: [image] }), env, cut)).status, 422);
});

test("handles upstream limits, missing setup and malformed data without leaking errors", async () => {
  assert.equal((await handleRequest(request({ source }), {}, upstream(draft))).status, 503);
  const response = await handleRequest(request({ source }), env, async () => new Response("private upstream details", { status: 429 }));
  assert.equal(response.status, 429);
  assert.equal((await response.text()).includes("private upstream"), false);
  assert.equal((await handleRequest(request({ source }), env, async () => Response.json({}))).status, 502);
});

test("preflight allows only the GitHub origin and supported headers", async () => {
  const r = await handleRequest(new Request("https://api.example/api/profile-draft", { method: "OPTIONS", headers: { Origin: origin } }), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Headers"), "Content-Type");
});
