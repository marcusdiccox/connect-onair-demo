import { skillCatalog } from "./data.js";

export const MAX_TEXT = 50000;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const normalize = (value) =>
  value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function cleanList(values) {
  const list = typeof values === "string" ? values.split(/[,;\n]/) : values;
  return [
    ...new Map(
      list
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => [normalize(value), value]),
    ).values(),
  ];
}

export function canonicalSkill(value) {
  const key = normalize(value);
  return (
    Object.entries(skillCatalog).find(
      ([name, aliases]) =>
        normalize(name) === key ||
        aliases.some((alias) => normalize(alias) === key),
    )?.[0] ?? value.trim()
  );
}

export function detectSkills(text) {
  const clauses = text.split(/[\n!?;]|\.\s+/);
  return Object.entries(skillCatalog)
    .filter(([, aliases]) =>
      aliases.some((alias) => {
        const pattern = new RegExp(
          `(^|[^a-z0-9])${escapeRegex(alias)}(?=$|[^a-z0-9+#])`,
          "i",
        );
        return clauses.some((clause) => {
          const match = pattern.exec(clause);
          if (!match) return false;
          return !/(?:\bno\b|\bnot\b|\bwithout\b|\black(?:ing)?\b)[^,;]{0,35}$/i.test(
            clause.slice(0, match.index),
          );
        });
      }),
    )
    .map(([name]) => name);
}

export function safeUrl(value) {
  if (!value.trim()) return "";
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error();
    return url.href;
  } catch {
    throw new Error("Enter a complete http:// or https:// link.");
  }
}

export function parseProfile(text, sourceUrl = "", fileName = "") {
  if (!text.trim())
    throw new Error("Upload a document or paste some profile text first.");
  if (text.length > MAX_TEXT)
    throw new Error("Use up to 50,000 characters of profile text.");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const field = (label) =>
    lines.find((line) => label.test(line))?.replace(/^[^:]+:\s*/, "") ?? "";
  const sectionHeading =
    /^(education|(?:work\s+)?experience|skills|interests|projects|summary|certifications|name|contact)(?:\s*:|\s*$)/i;
  const section = (label) => {
    const start = lines.findIndex((line) => label.test(line));
    if (start < 0) return "";
    const parts = [lines[start].replace(label, "").replace(/^\s*:\s*/, "")];
    for (let i = start + 1; i < lines.length; i++) {
      if (sectionHeading.test(lines[i])) break;
      parts.push(lines[i]);
    }
    return parts.filter(Boolean).join("\n").slice(0, 5000);
  };
  const firstLine = lines[0];
  const looksLikeName =
    /^[\p{L}][\p{L} .'-]{2,69}$/u.test(firstLine) &&
    firstLine.split(/\s+/).length <= 5 &&
    !/resume|curriculum|skills|education|experience|summary|profile/i.test(
      firstLine,
    );
  let inInterests = false;
  const skillText = lines
    .filter((line) => {
      if (sectionHeading.test(line)) inInterests = /^interests\b/i.test(line);
      return !inInterests;
    })
    .join("\n");
  return {
    name: field(/^name\s*:/i) || (looksLikeName ? firstLine : ""),
    education: section(/^education\b/i),
    experience: section(/^(?:work\s+)?experience\b/i),
    skills: detectSkills(skillText),
    interests: cleanList(section(/^interests\b/i)),
    sourceText: text,
    sourceUrl: safeUrl(sourceUrl),
    fileName,
  };
}

export function profileIssues(profile) {
  const issues = [];
  if (!profile.name.trim()) issues.push("Add the candidate’s name.");
  if (!profile.skills.length)
    issues.push("Add at least one skill to calculate matches.");
  return issues;
}

export function matchOpportunity(profile, opportunity) {
  const available = new Set(
    profile.skills.map((skill) => normalize(canonicalSkill(skill))),
  );
  const interestSet = new Set(
    profile.interests.map((interest) => normalize(canonicalSkill(interest))),
  );
  const requiredMatched = opportunity.required.filter((skill) =>
    available.has(normalize(canonicalSkill(skill))),
  );
  const preferredMatched = opportunity.preferred.filter((skill) =>
    available.has(normalize(canonicalSkill(skill))),
  );
  const interestMatched = opportunity.interests.filter((interest) =>
    interestSet.has(normalize(canonicalSkill(interest))),
  );
  const dimensions = [
    {
      label: "Required skills",
      total: opportunity.required.length,
      matched: requiredMatched.length,
      weight: 70,
    },
    {
      label: "Preferred skills",
      total: opportunity.preferred.length,
      matched: preferredMatched.length,
      weight: 20,
    },
    {
      label: "Interests",
      total: opportunity.interests.length,
      matched: interestMatched.length,
      weight: 10,
    },
  ].filter((dimension) => dimension.total > 0);
  const totalWeight = dimensions.reduce(
    (sum, dimension) => sum + dimension.weight,
    0,
  );
  const score = totalWeight
    ? Math.round(
        (dimensions.reduce(
          (sum, dimension) =>
            sum + (dimension.matched / dimension.total) * dimension.weight,
          0,
        ) /
          totalWeight) *
          100,
      )
    : 0;
  return {
    score,
    requiredMatched,
    preferredMatched,
    interestMatched,
    missing: opportunity.required.filter(
      (skill) => !available.has(normalize(canonicalSkill(skill))),
    ),
    dimensions: dimensions.map((dimension) => ({
      ...dimension,
      share: Math.round((dimension.weight / totalWeight) * 100),
    })),
  };
}

export function rankedOpportunities(profile, opportunities, filters = {}) {
  const query = normalize(filters.query ?? "");
  return opportunities
    .filter(
      (opportunity) =>
        (!filters.type || opportunity.type === filters.type) &&
        (!filters.category || opportunity.category === filters.category) &&
        (!query ||
          normalize(
            [
              opportunity.title,
              opportunity.organization,
              opportunity.description,
              opportunity.location,
              ...opportunity.required,
              ...opportunity.preferred,
            ].join(" "),
          ).includes(query)),
    )
    .map((opportunity) => ({
      opportunity,
      ...matchOpportunity(profile, opportunity),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.opportunity.title.localeCompare(b.opportunity.title),
    );
}

export function fingerprint(profile, opportunity) {
  return JSON.stringify({ profile, opportunity });
}

export function currentDecision(state, opportunity) {
  if (!opportunity) return null;
  const key = fingerprint(state.profile, opportunity);
  return state.reviews.findLast((review) => review.fingerprint === key) ?? null;
}

export function createReview(state, kind, reviewer, note, id, now) {
  const opportunity = state.opportunities.find(
    (item) => item.id === state.selectedId,
  );
  if (!opportunity) throw new Error("Choose an opportunity before reviewing.");
  const issues = profileIssues(state.profile);
  if (issues.length) throw new Error(issues.join(" "));
  if (!["approved", "changes_requested"].includes(kind))
    throw new Error("Invalid review decision.");
  if (!reviewer.trim()) throw new Error("Enter the reviewer’s name.");
  if (kind === "changes_requested" && !note.trim())
    throw new Error("Explain the changes needed.");
  return {
    id,
    kind,
    reviewer: reviewer.trim(),
    note: note.trim(),
    at: now,
    fingerprint: fingerprint(state.profile, opportunity),
    profile: structuredClone(state.profile),
    opportunity: structuredClone(opportunity),
    score: matchOpportunity(state.profile, opportunity).score,
  };
}

export function validateUpload(file) {
  if (!file || file.size === 0)
    throw new Error("Choose a document that contains text.");
  if (file.size > MAX_FILE_SIZE)
    throw new Error("The document must be 10 MB or smaller.");
  const extension = file.name.split(".").pop().toLowerCase();
  if (!["pdf", "docx", "txt"].includes(extension))
    throw new Error(
      "Choose a PDF, DOCX, or TXT file. Older .doc files are not supported.",
    );
  return extension;
}
