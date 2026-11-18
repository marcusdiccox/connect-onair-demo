import test from "node:test";
import assert from "node:assert/strict";
import { groundedProfilePrompt, groundProfileDraft } from "../server/grounding.js";
import { parseProfileResponse } from "../src/assistant.js";
const source = "Jordan Example\nI am skilled in troubleshooting, problem-solving, and adapting to new tools, and am seeking technical roles.\nEducation: Information Technology\nInterests: Machine Learning";
const draft = () => ({ name: "Jordan Example", education: "Information Technology", experience: "", skills: ["troubleshooting", "problem-solving"], interests: ["Machine Learning"], evidence: [{ field: "name", sourceIds: [0] }, { field: "education", sourceIds: [2] }, { field: "skills", sourceIds: [1] }, { field: "interests", sourceIds: [3] }] });

test("source IDs become exact quotes even when the model would paraphrase a sentence", () => {
  const result = groundProfileDraft(JSON.stringify(draft()), source);
  assert.deepEqual(result.draft.skills, ["troubleshooting", "problem-solving"]);
  assert.equal(result.draft.evidence.find(e => e.field === "skills").quote, source.split("\n")[1]);
  assert.doesNotThrow(() => parseProfileResponse(JSON.stringify(result.draft), source));
  assert.match(groundedProfilePrompt(source), /sourceIds/);
});

test("one unsupported skill does not discard a valid profile", () => {
  const input = draft(); input.skills.push("React", "Machine Learning");
  const result = groundProfileDraft(JSON.stringify(input), source);
  assert.equal(result.draft.name, "Jordan Example");
  assert.deepEqual(result.draft.skills, ["troubleshooting", "problem-solving"]);
  assert.ok(result.warnings.some(w => w.includes("React")));
  assert.ok(result.warnings.some(w => w.includes("Machine Learning")));
});

test("bad evidence leaves only the affected field blank and never invents replacement facts", () => {
  const input = draft(); input.evidence[1].sourceIds = [999];
  const result = groundProfileDraft(JSON.stringify(input), source);
  assert.equal(result.draft.education, "");
  assert.equal(result.draft.name, "Jordan Example");
  assert.ok(result.warnings.length);
  assert.throws(() => groundProfileDraft("not JSON", source), /JSON/);
});
