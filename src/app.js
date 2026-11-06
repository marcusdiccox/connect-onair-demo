import { sampleResume } from "./data.js";
import {
  canonicalSkill,
  cleanList,
  parseProfile,
  profileIssues,
  rankedOpportunities,
  matchOpportunity,
  currentDecision,
  createReview,
  safeUrl,
} from "./domain.js";
import {
  emptyState,
  restoreState,
  saveState,
  validateState,
  STORAGE_KEY,
} from "./storage.js";
import { extractDocument } from "./files.js";

const $ = (selector) => document.querySelector(selector);
const storage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
const restored = restoreState(storage);
let state = restored.state;
let storageLocked = Boolean(restored.error);
let editingId = "";
let extracting = false;
let toastTimer;
let pendingConfirmation;
const filters = { query: "", type: "", category: "" };

function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function errorAt(id, message = "") {
  const element = $(id);
  element.textContent = message;
  element.hidden = !message;
}

function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 4500);
}

function storageAlert(message) {
  $("#storage-alert").textContent = message;
  $("#storage-alert").hidden = !message;
}

function persist() {
  if (storageLocked) {
    $("#save-indicator").textContent = "Changes are in this tab only";
    return false;
  }
  try {
    saveState(storage, state);
    $("#save-indicator").textContent = "● Saved on this device";
    storageAlert("");
    return true;
  } catch {
    storageAlert(
      "Changes are in this tab only. Browser storage is unavailable or full. Export your workspace to keep a backup.",
    );
    $("#save-indicator").textContent = "Not saved · export a backup";
    return false;
  }
}

function readList(value, skills = false) {
  const values = cleanList(value);
  if (values.length > 100 || values.some((item) => item.length > 100))
    throw new Error(
      "Use up to 100 items, with 100 characters or fewer per item.",
    );
  return cleanList(skills ? values.map(canonicalSkill) : values);
}

function chips(values, className = "") {
  const container = node("div", "chips");
  for (const value of values)
    container.append(node("span", `chip ${className}`, value));
  return container;
}

function link(label, href, className = "") {
  const anchor = node("a", className, label);
  anchor.href = safeUrl(href);
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function button(label, className, action) {
  const element = node("button", `button ${className}`, label);
  element.type = "button";
  element.addEventListener("click", action);
  return element;
}

function blank(title, description, action) {
  const element = node("div", "empty-state");
  element.append(node("h3", "", title), node("p", "", description));
  if (action) element.append(action);
  return element;
}

function confirmAction(title, message, label, action) {
  $("#confirm-heading").textContent = title;
  $("#confirm-message").textContent = message;
  $("#confirm-action").textContent = label;
  pendingConfirmation = action;
  $("#confirm-dialog").showModal();
}

function fillProfile() {
  $("#candidate-name").value = state.profile.name;
  $("#candidate-skills").value = state.profile.skills.join(", ");
  $("#candidate-education").value = state.profile.education;
  $("#candidate-experience").value = state.profile.experience;
  $("#candidate-interests").value = state.profile.interests.join(", ");
  renderProfileStatus();
}

function fillSources() {
  $("#source-text").value = state.draft.text;
  $("#source-url").value = state.draft.url;
  $("#file-status").textContent = state.draft.fileName
    ? `Text loaded from ${state.draft.fileName}`
    : "";
  $("#character-count").textContent =
    `${state.draft.text.length.toLocaleString()} / 50,000`;
}

function renderProfileStatus() {
  const ready = profileIssues(state.profile).length === 0;
  $("#profile-badge").textContent = ready
    ? "Ready to match"
    : state.profile.sourceText ||
        state.profile.name ||
        state.profile.skills.length
      ? "Needs your review"
      : "Not started";
  $("#profile-badge").className = `badge ${ready ? "" : "neutral"}`;
  $("#skill-preview").replaceChildren(...chips(state.profile.skills).children);
  $("#profile-save-status").textContent = ready
    ? `${state.profile.skills.length} skills · saved as you edit`
    : "Add a name and at least one skill.";
}

function updateProfile() {
  try {
    const profile = {
      ...state.profile,
      name: $("#candidate-name").value.trim(),
      education: $("#candidate-education").value.trim(),
      experience: $("#candidate-experience").value.trim(),
      skills: readList($("#candidate-skills").value, true),
      interests: readList($("#candidate-interests").value),
    };
    if (JSON.stringify(profile) !== JSON.stringify(state.profile))
      $("#confirm-review").checked = false;
    state.profile = profile;
    errorAt("#profile-error");
    persist();
    renderProfileStatus();
    return true;
  } catch (error) {
    errorAt("#profile-error", error.message);
    return false;
  }
}

function buildProfile() {
  try {
    const profile = parseProfile(
      $("#source-text").value,
      $("#source-url").value,
      state.draft.fileName,
    );
    const apply = () => {
      state.profile = profile;
      state.draft = {
        text: $("#source-text").value,
        url: $("#source-url").value,
        fileName: state.draft.fileName,
      };
      $("#confirm-review").checked = false;
      errorAt("#source-error");
      persist();
      fillProfile();
      $("#candidate-name").focus();
      toast(
        "Profile built. Check the detected details and add anything missing.",
      );
    };
    if (state.profile.name || state.profile.skills.length)
      confirmAction(
        "Rebuild this profile?",
        "This replaces the editable profile with details from your source text. Previous review snapshots will stay in history.",
        "Rebuild profile",
        apply,
      );
    else apply();
  } catch (error) {
    errorAt("#source-error", error.message);
  }
}

async function upload(file) {
  if (extracting || !file) return;
  extracting = true;
  $("#generate-button").disabled = true;
  $("#sample-button").disabled = true;
  $("#resume-file").disabled = true;
  $("#source-text").disabled = true;
  $("#file-status").textContent = `Reading ${file.name}…`;
  errorAt("#source-error");
  try {
    const text = await extractDocument(file);
    const apply = () => {
      state.draft.text = text;
      state.draft.fileName = file.name;
      fillSources();
      persist();
      toast(
        "Document text loaded. Choose “Build my profile” to extract details.",
      );
    };
    if (state.draft.text.trim()) {
      $("#file-status").textContent =
        `Read ${file.name}. Waiting for confirmation.`;
      confirmAction(
        "Replace source text?",
        "The uploaded document will replace the text in the source field. Your editable profile is unchanged until you rebuild it.",
        "Use document text",
        apply,
      );
    } else apply();
  } catch (error) {
    $("#file-status").textContent = state.draft.fileName
      ? `Previous source: ${state.draft.fileName}`
      : "Document could not be read.";
    errorAt(
      "#source-error",
      error.message?.includes("password")
        ? "This PDF is password protected. Use an unlocked document or paste its text."
        : `Could not read this document. ${error.message || "Try a different file or paste the text."}`,
    );
  } finally {
    extracting = false;
    $("#generate-button").disabled = false;
    $("#sample-button").disabled = false;
    $("#resume-file").disabled = false;
    $("#source-text").disabled = false;
    $("#resume-file").value = "";
  }
}

function populateFilters() {
  for (const [selector, key, defaultLabel] of [
    ["#filter-type", "type", "All types"],
    ["#filter-category", "category", "All areas"],
  ]) {
    const element = $(selector);
    const options = [node("option", "", defaultLabel)];
    options[0].value = "";
    for (const value of [
      ...new Set(state.opportunities.map((item) => item[key])),
    ].sort()) {
      const option = node("option", "", value);
      option.value = value;
      options.push(option);
    }
    element.replaceChildren(...options);
    if (!options.some((option) => option.value === filters[key]))
      filters[key] = "";
    element.value = filters[key];
  }
}

function selectOpportunity(id) {
  if (state.selectedId !== id) {
    $("#confirm-review").checked = false;
    $("#review-note").value = "";
  }
  state.selectedId = id;
  persist();
  renderMatching();
  document.getElementById(`select-${id}`)?.focus({ preventScroll: true });
  if (window.matchMedia("(max-width: 760px)").matches) {
    $("#match-detail").scrollIntoView({ block: "start", behavior: "instant" });
  }
}

function renderMatching() {
  const ready = !profileIssues(state.profile).length;
  const summary = $("#match-summary");
  summary.replaceChildren(
    node("strong", "", ready ? state.profile.name : "Start with a profile"),
    node(
      "span",
      "",
      ready
        ? `${state.profile.skills.length} skills · ${state.opportunities.length} opportunities · scores update with your profile`
        : "Add your name and skills to get meaningful matches. You can still explore the sample listings.",
    ),
  );
  const edit = node("a", "", "Edit profile →");
  edit.href = "#profile";
  summary.append(edit);
  const results = rankedOpportunities(
    state.profile,
    state.opportunities,
    filters,
  );
  $("#result-count").textContent =
    `${results.length} ${results.length === 1 ? "opportunity" : "opportunities"}`;
  const cards = results.map(({ opportunity, score, requiredMatched }) => {
    const selected = opportunity.id === state.selectedId;
    const card = node("button", "opportunity-card");
    card.id = `select-${opportunity.id}`;
    card.type = "button";
    card.setAttribute("aria-pressed", String(selected));
    card.setAttribute(
      "aria-label",
      `${opportunity.title}, ${opportunity.organization}, ${score}% match score${selected ? ", selected" : ""}`,
    );
    const top = node("span", "card-top");
    const title = node("span");
    title.append(
      node("span", "card-title", opportunity.title),
      node(
        "span",
        "card-company",
        `${opportunity.organization} · ${opportunity.location}`,
      ),
    );
    const coverage = node("span", "score", ready ? `${score}%` : "—");
    coverage.append(node("small", "", "match score"));
    top.append(title, coverage);
    const bottom = node("span", "card-bottom");
    bottom.append(
      node(
        "span",
        "",
        `${opportunity.type} · ${opportunity.sample ? "Sample listing" : "Your listing"}`,
      ),
      node("span", "selection-label", selected ? "✓ Selected" : "View match →"),
    );
    const tags = chips(
      opportunity.required.map(
        (skill) => `${requiredMatched.includes(skill) ? "✓ " : ""}${skill}`,
      ),
      "neutral",
    );
    card.append(
      top,
      node("p", "card-description", opportunity.description),
      tags,
      bottom,
    );
    card.addEventListener("click", () => selectOpportunity(opportunity.id));
    return card;
  });
  $("#opportunity-list").replaceChildren(
    ...(cards.length
      ? cards
      : [
          blank(
            "No opportunities found",
            "Try a different search or add your own opportunity.",
            button("Clear filters", "secondary", () => {
              filters.query = filters.type = filters.category = "";
              $("#search").value = "";
              populateFilters();
              renderMatching();
            }),
          ),
        ]),
  );
  renderDetail();
}

function renderDetail() {
  const container = $("#match-detail");
  const opportunity = state.opportunities.find(
    (item) => item.id === state.selectedId,
  );
  if (!opportunity) {
    container.replaceChildren(
      blank(
        "Every match has a reason.",
        "Choose an opportunity to see matched skills, gaps, and the calculation behind its score.",
      ),
    );
    return;
  }
  const result = matchOpportunity(state.profile, opportunity);
  const header = node("div", "panel-header");
  const heading = node("div");
  heading.append(
    node("p", "eyebrow", "WHY THIS OPPORTUNITY"),
    node("h2", "", "The match, explained"),
  );
  header.append(
    heading,
    node(
      "span",
      `badge ${opportunity.sample ? "neutral" : ""}`,
      opportunity.sample ? "Sample listing" : "Your listing",
    ),
  );
  const body = node("div", "panel-body");
  const scoreLine = node("div", "detail-score");
  const title = node("div");
  title.append(
    node("h3", "", opportunity.title),
    node("p", "field-help", opportunity.organization),
  );
  const coverage = node("div", "score", `${result.score}%`);
  coverage.append(node("small", "", "match score"));
  scoreLine.append(title, coverage);
  body.append(
    scoreLine,
    node("p", "detail-description", opportunity.description),
  );
  for (const [title, values, style, empty] of [
    [
      "Required skills you match",
      result.requiredMatched,
      "",
      "No required skills matched yet.",
    ],
    [
      "Required skills to build or confirm",
      result.missing,
      "missing",
      "You match every listed required skill.",
    ],
    [
      "Preferred skills you match",
      result.preferredMatched,
      "",
      "No preferred skills matched.",
    ],
    [
      "Shared interests",
      result.interestMatched,
      "neutral",
      "No shared interests detected.",
    ],
  ]) {
    const section = node("div", "detail-section");
    section.append(
      node("h3", "", title),
      values.length ? chips(values, style) : node("p", "", empty),
    );
    body.append(section);
  }
  const scoring = node("details", "scoring-details");
  scoring.append(node("summary", "", "How this score is calculated"));
  const breakdown = node("div", "detail-section");
  for (const dimension of result.dimensions) {
    const row = node("div", "coverage-row");
    row.append(
      node("span", "", `${dimension.label} · ${dimension.share}% weight`),
      node("strong", "", `${dimension.matched}/${dimension.total}`),
    );
    const bar = node("div", "coverage-bar");
    const fill = node("span");
    fill.style.width = `${(dimension.matched / dimension.total) * 100}%`;
    bar.append(fill);
    row.append(bar);
    breakdown.append(row);
  }
  scoring.append(breakdown);
  const actions = node("div", "detail-actions");
  const review = node("a", "button primary grow", "Review this match →");
  review.href = "#review";
  actions.append(
    review,
    button("Edit listing", "secondary", () => openOpportunity(opportunity.id)),
  );
  body.append(actions);
  if (opportunity.url)
    body.append(link("Open original listing ↗", opportunity.url, "field-help"));
  scoring.append(
    node(
      "p",
      "method-note",
      "A weighted coverage score: required skills 70%, preferred skills 20%, and interests 10%. Empty sections redistribute their weight. Matching uses normalized skill names, not semantic AI or a hiring probability. Sample listings are fictional.",
    ),
  );
  body.append(scoring);
  container.replaceChildren(header, body);
}

function reviewBlock(title, value) {
  const block = node("div", "review-block");
  block.append(
    node("h3", "", title),
    typeof value === "string" ? node("p", "", value || "Not provided") : value,
  );
  return block;
}

function renderReview() {
  const opportunity = state.opportunities.find(
    (item) => item.id === state.selectedId,
  );
  const valid = opportunity && !profileIssues(state.profile).length;
  $("#approve-button").disabled = !valid;
  $("#changes-button").disabled = !valid;
  const content = $("#review-content");
  const decision = currentDecision(state, opportunity);
  const related =
    opportunity &&
    state.reviews.some((review) => review.opportunity.id === opportunity.id);
  $("#review-badge").textContent = !valid
    ? "Awaiting profile & selection"
    : decision?.kind === "approved"
      ? "Approved locally"
      : decision?.kind === "changes_requested"
        ? "Changes requested"
        : related
          ? "Changed · review again"
          : "Ready for review";
  $("#review-badge").className =
    `badge large ${decision?.kind === "approved" ? "" : "warning"}`;
  $("#review-outcome").hidden = !decision;
  if (decision)
    $("#review-outcome").textContent =
      `${decision.kind === "approved" ? "Approved" : "Changes requested"} by ${decision.reviewer} on ${new Date(decision.at).toLocaleString()}.${decision.note ? ` ${decision.note}` : ""}`;
  if (!valid) {
    content.replaceChildren(
      blank(
        "Choose a connection to review.",
        "You need a profile with a name and at least one skill, plus a selected opportunity.",
        button("Go to opportunities", "primary", () => {
          location.hash = "matching";
        }),
      ),
    );
  } else {
    const profile = state.profile;
    const person = node("div", "review-person");
    const identity = node("div");
    identity.append(
      node("h3", "", profile.name),
      node("p", "", "Candidate profile · editable by you"),
    );
    person.append(
      node(
        "div",
        "avatar",
        profile.name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase(),
      ),
      identity,
    );
    const result = matchOpportunity(profile, opportunity);
    const match = node("div", "review-match");
    match.append(
      node("span", "badge", `${result.score}% match score`),
      node("h3", "", opportunity.title),
      node(
        "p",
        "",
        `${opportunity.organization} · ${opportunity.sample ? "Fictional sample listing" : "User-added listing"}`,
      ),
      chips(result.requiredMatched),
      node(
        "p",
        "",
        result.missing.length
          ? `Required skill gaps: ${result.missing.join(", ")}`
          : "All required skills match.",
      ),
    );
    content.replaceChildren(
      person,
      reviewBlock("Skills", chips(profile.skills)),
      reviewBlock("Education", profile.education),
      reviewBlock("Experience", profile.experience),
      reviewBlock("Interests", profile.interests.join(", ")),
      match,
    );
    if (profile.sourceUrl)
      content.append(
        reviewBlock(
          "Profile reference",
          link(profile.sourceUrl, profile.sourceUrl),
        ),
      );
    if (opportunity.url)
      content.append(
        reviewBlock(
          "Listing reference",
          link(opportunity.url, opportunity.url),
        ),
      );
    if (profile.sourceText) {
      const source = node("details", "review-block");
      source.append(
        node(
          "summary",
          "",
          `Original source text${profile.fileName ? ` · ${profile.fileName}` : ""}`,
        ),
        node("p", "", profile.sourceText),
      );
      content.append(source);
    }
    content.append(
      reviewBlock(
        "Record scope",
        "Approving saves the candidate profile, selected opportunity, score, reviewer, note, and time in this browser. There is no external publishing step.",
      ),
    );
  }
  renderHistory();
}

function renderHistory() {
  const cards = [...state.reviews].reverse().map((review) => {
    const card = node("article", "history-card");
    const title = node("div");
    title.append(
      node("h3", "", `${review.profile.name} → ${review.opportunity.title}`),
      node("p", "", `${review.reviewer} · ${review.score}% match score`),
    );
    const status = node(
      "span",
      `badge ${review.kind === "approved" ? "" : "warning"}`,
      review.kind === "approved" ? "Approved locally" : "Changes requested",
    );
    const time = node("time", "", new Date(review.at).toLocaleString());
    time.dateTime = review.at;
    card.append(title, status, time);
    if (review.note) card.append(node("p", "history-note", review.note));
    const details = node("details", "history-note");
    details.append(
      node("summary", "", "View saved snapshot"),
      node(
        "p",
        "",
        `Skills: ${review.profile.skills.join(", ")}\nEducation: ${review.profile.education || "Not provided"}\nExperience: ${review.profile.experience || "Not provided"}\nRequired skills: ${review.opportunity.required.join(", ")}\nOpportunity: ${review.opportunity.description}`,
      ),
      button("Download record", "quiet compact", () =>
        download(review, `onair-review-${review.id}.json`),
      ),
    );
    card.append(details);
    return card;
  });
  $("#review-history").replaceChildren(
    ...(cards.length
      ? cards
      : [
          blank(
            "No decisions yet.",
            "Your approved matches and change requests will appear here.",
          ),
        ]),
  );
}

function openOpportunity(id = "") {
  editingId = id;
  errorAt("#opportunity-error");
  $("#opportunity-form").reset();
  const opportunity = state.opportunities.find((item) => item.id === id);
  $("#opportunity-heading").textContent = opportunity
    ? "Edit opportunity"
    : "Add an opportunity";
  $("#delete-opportunity").hidden = !opportunity;
  if (opportunity) {
    for (const key of [
      "title",
      "organization",
      "type",
      "category",
      "location",
      "description",
      "url",
    ])
      $(`#opp-${key}`).value = opportunity[key];
    for (const key of ["required", "preferred", "interests"])
      $(`#opp-${key}`).value = opportunity[key].join(", ");
  }
  $("#opportunity-dialog").showModal();
}

function download(data, filename) {
  const blob = new Blob(
    [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
    { type: "application/json" },
  );
  const href = URL.createObjectURL(blob);
  const anchor = node("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function route(focus = true) {
  const screen = ["profile", "matching", "review"].includes(
    location.hash.slice(1),
  )
    ? location.hash.slice(1)
    : "profile";
  for (const section of document.querySelectorAll(".screen"))
    section.hidden = section.id !== `${screen}-screen`;
  for (const anchor of document.querySelectorAll("[data-screen]")) {
    if (anchor.dataset.screen === screen)
      anchor.setAttribute("aria-current", "step");
    else anchor.removeAttribute("aria-current");
  }
  if (screen === "matching") {
    populateFilters();
    renderMatching();
  }
  if (screen === "review") renderReview();
  errorAt("#review-error");
  if (focus) {
    $(`#${screen}-heading`).focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

$("#source-form").addEventListener("submit", (event) => {
  event.preventDefault();
  buildProfile();
});
$("#source-text").addEventListener("input", () => {
  state.draft.text = $("#source-text").value;
  state.draft.fileName = "";
  $("#file-status").textContent = "";
  $("#character-count").textContent =
    `${state.draft.text.length.toLocaleString()} / 50,000`;
  persist();
});
$("#source-url").addEventListener("input", () => {
  state.draft.url = $("#source-url").value;
  persist();
});
$("#sample-button").addEventListener("click", () => {
  const apply = () => {
    state.draft = { text: sampleResume, url: "", fileName: "" };
    fillSources();
    state.profile = parseProfile(sampleResume);
    fillProfile();
    $("#confirm-review").checked = false;
    errorAt("#source-error");
    persist();
    toast("Sample profile loaded. You can edit every field.");
  };
  if (state.profile.name || state.draft.text.trim())
    confirmAction(
      "Load the sample profile?",
      "This replaces the current profile and source text with a fictional sample. Previous review snapshots stay in history.",
      "Load sample",
      apply,
    );
  else apply();
});
$("#profile-form").addEventListener("input", updateProfile);
$("#profile-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!updateProfile()) return;
  const issues = profileIssues(state.profile);
  if (issues.length) {
    errorAt("#profile-error", issues.join(" "));
    return;
  }
  location.hash = "matching";
});
$("#resume-file").addEventListener("change", (event) =>
  upload(event.target.files[0]),
);
for (const eventName of ["dragenter", "dragover"])
  $("#drop-zone").addEventListener(eventName, (event) => {
    event.preventDefault();
    $("#drop-zone").classList.add("dragging");
  });
for (const eventName of ["dragleave", "drop"])
  $("#drop-zone").addEventListener(eventName, (event) => {
    event.preventDefault();
    $("#drop-zone").classList.remove("dragging");
  });
$("#drop-zone").addEventListener("drop", (event) => {
  if (event.dataTransfer.files.length !== 1) {
    errorAt("#source-error", "Drop one document at a time.");
    return;
  }
  upload(event.dataTransfer.files[0]);
});
$("#search").addEventListener("input", () => {
  filters.query = $("#search").value;
  renderMatching();
});
for (const key of ["type", "category"])
  $(`#filter-${key}`).addEventListener("change", (event) => {
    filters[key] = event.target.value;
    renderMatching();
  });
$("#add-opportunity").addEventListener("click", () => openOpportunity());
$("#opportunity-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    if (!editingId && state.opportunities.length >= 100)
      throw new Error("This workspace supports up to 100 opportunities.");
    const opportunity = { id: editingId || crypto.randomUUID(), sample: false };
    for (const key of [
      "title",
      "organization",
      "type",
      "category",
      "location",
      "description",
    ])
      opportunity[key] = $(`#opp-${key}`).value.trim();
    for (const key of ["required", "preferred", "interests"])
      opportunity[key] = readList($(`#opp-${key}`).value, key !== "interests");
    opportunity.url = safeUrl($("#opp-url").value);
    if (
      !opportunity.title ||
      !opportunity.organization ||
      !opportunity.category ||
      !opportunity.location ||
      !opportunity.description ||
      !opportunity.required.length
    )
      throw new Error(
        "Complete the listing details and add at least one required skill.",
      );
    const index = state.opportunities.findIndex(
      (item) => item.id === editingId,
    );
    if (index < 0) state.opportunities.push(opportunity);
    else state.opportunities[index] = opportunity;
    state.selectedId = opportunity.id;
    $("#confirm-review").checked = false;
    persist();
    $("#opportunity-dialog").close();
    populateFilters();
    renderMatching();
    toast("Opportunity saved. Match scores have been recalculated.");
  } catch (error) {
    errorAt("#opportunity-error", error.message);
  }
});
$("#delete-opportunity").addEventListener("click", () =>
  confirmAction(
    "Delete this opportunity?",
    "It will be removed from your listings. Existing review snapshots will stay in history.",
    "Delete opportunity",
    () => {
      state.opportunities = state.opportunities.filter(
        (item) => item.id !== editingId,
      );
      if (state.selectedId === editingId) state.selectedId = "";
      persist();
      $("#opportunity-dialog").close();
      populateFilters();
      renderMatching();
      toast("Opportunity deleted.");
    },
  ),
);
$("#review-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    if (!$("#confirm-review").checked)
      throw new Error(
        "Confirm that you checked the profile and opportunity details.",
      );
    if (state.reviews.length >= 100)
      throw new Error(
        "This workspace has 100 review records. Export a backup and start a new workspace to continue.",
      );
    const kind = event.submitter?.value || "approved";
    const review = createReview(
      state,
      kind,
      $("#reviewer").value,
      $("#review-note").value,
      crypto.randomUUID(),
      new Date().toISOString(),
    );
    state.reviews.push(review);
    const saved = persist();
    errorAt("#review-error");
    $("#confirm-review").checked = false;
    renderReview();
    toast(
      saved
        ? "Decision saved on this device."
        : "Decision recorded in this tab. Export a backup to keep it.",
    );
  } catch (error) {
    errorAt("#review-error", error.message);
  }
});
$("#workspace-button").addEventListener("click", () => {
  $("#workspace-stats").replaceChildren(
    node("span", "", `${state.profile.skills.length} profile skills`),
    node("span", "", `${state.opportunities.length} opportunities`),
    node("span", "", `${state.reviews.length} decisions`),
  );
  $("#workspace-dialog").showModal();
});
$("#export-button").addEventListener("click", () => {
  if (storageLocked) {
    try {
      const original = storage.getItem(STORAGE_KEY);
      if (original) download(original, "onair-original-workspace.json");
    } catch {}
    download(state, "onair-current-workspace.json");
  } else download(state, "onair-workspace.json");
  toast("Workspace export created. It contains your profile data.");
});
$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 12 * 1024 * 1024)
      throw new Error("Choose a workspace backup under 12 MB.");
    const importedState = validateState(JSON.parse(await file.text()));
    confirmAction(
      "Restore this workspace?",
      "This replaces your current profile, listings, and decisions. Export the current workspace first if you want to keep it.",
      "Restore backup",
      () => {
        state = importedState;
        storageLocked = false;
        $("#confirm-review").checked = false;
        fillSources();
        fillProfile();
        persist();
        route(false);
        $("#workspace-dialog").close();
        toast("Workspace restored.");
      },
    );
    errorAt("#workspace-error");
  } catch (error) {
    errorAt(
      "#workspace-error",
      error instanceof SyntaxError
        ? "This file is not valid JSON. Choose a Connect onAir backup."
        : error.message,
    );
  }
  event.target.value = "";
});
$("#reset-button").addEventListener("click", () =>
  confirmAction(
    "Reset this workspace?",
    "This removes the saved profile, custom listings, and review history from this browser. Export a backup first to keep a copy.",
    "Reset workspace",
    () => {
      state = emptyState();
      storageLocked = false;
      $("#review-form").reset();
      filters.query = filters.type = filters.category = "";
      $("#search").value = "";
      fillSources();
      fillProfile();
      persist();
      $("#workspace-dialog").close();
      location.hash = "profile";
      route();
      toast("Workspace reset.");
    },
  ),
);
$("#confirm-action").addEventListener("click", () => {
  const action = pendingConfirmation;
  pendingConfirmation = undefined;
  $("#confirm-dialog").close();
  action?.();
});
$("#confirm-cancel").addEventListener("click", () =>
  $("#confirm-dialog").close(),
);
$("#confirm-dialog").addEventListener("close", () => {
  pendingConfirmation = undefined;
});
for (const close of document.querySelectorAll("[data-close]"))
  close.addEventListener("click", () =>
    document.getElementById(close.dataset.close).close(),
  );
window.addEventListener("hashchange", () => route());
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    storageLocked = true;
    storageAlert(
      "This workspace changed in another tab. Export any unsaved edits, then reload to use the latest saved copy.",
    );
    $("#save-indicator").textContent = "Another tab changed this workspace";
  }
});

fillSources();
fillProfile();
storageAlert(restored.error);
if (restored.error)
  $("#save-indicator").textContent = "Not saved · export a backup";
route(false);
