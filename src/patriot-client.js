const apiOrigin = "https://connect-onair-api.marcus-3177.chatgpt.site";

export async function requestProfileDraft(source, options = {}) {
  if (typeof source !== "string" || !source.trim() || source.length > 20000) {
    throw new Error("Use source text of up to 20,000 characters for AI drafting.");
  }
  const response = await (options.fetch ?? fetch)(`${apiOrigin}/api/profile-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({ source }),
    signal: options.signal ?? AbortSignal.timeout(30000),
  });
  let result;
  try { result = await response.json(); } catch {
    throw new Error("We could not read the AI reply. Try again or use the local parser.");
  }
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The AI service is unavailable. Try again or use the local parser.");
  if (!result.draft || typeof result.draft !== "object") throw new Error("The AI reply did not include a profile draft. Try again.");
  return result.draft;
}
