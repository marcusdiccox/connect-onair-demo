const apiOrigin = "https://connect-onair-api.marcus-3177.chatgpt.site";

export async function requestProfileDraft(source, options = {}) {
  if (typeof source !== "string" || !source.trim() || source.length > 20000) {
    throw new Error("Use source text of up to 20,000 characters for AI drafting.");
  }
  const result = await post("profile-draft", { source }, options, 35000);
  if (!result.draft || typeof result.draft !== "object") throw new Error("The AI reply did not include a profile draft. Try again.");
  options.onWarnings?.(Array.isArray(result.warnings) ? result.warnings.filter(value => typeof value === "string").slice(0, 10) : []);
  return result.draft;
}

export async function requestDocumentText(images, options = {}) {
  const result = await post("read-document", { images }, options, 65000);
  if (typeof result.text !== "string" || !result.text.trim() || result.text.length > 50000) throw new Error("The reading reply did not include usable text. Try a clearer scan.");
  return { text: result.text, notes: Array.isArray(result.notes) ? result.notes.filter(value => typeof value === "string").slice(0, 10) : [] };
}

async function post(route, body, options, timeout) {
  let response;
  try { response = await (options.fetch ?? fetch)(`${apiOrigin}/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(body),
    signal: options.signal ?? AbortSignal.timeout(timeout),
  }); } catch (error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") throw error;
    throw new Error("We could not reach PatriotAI. Try again or use the local parser.");
  }
  let result;
  try { result = await response.json(); } catch {
    throw new Error("We could not read the AI reply. Try again or use the local parser.");
  }
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The AI service is unavailable. Try again or use the local parser.");
  return result;
}
