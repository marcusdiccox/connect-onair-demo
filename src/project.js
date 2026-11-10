import { project } from "./project-data.js";

function element(tag, className = "", text = "") {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text) result.textContent = text;
  return result;
}

function section(id, title, intro) {
  const result = element("section", "project-section");
  result.id = id;
  const heading = element("h2", "", title);
  heading.id = `${id}-heading`;
  result.setAttribute("aria-labelledby", heading.id);
  result.append(heading);
  if (intro) result.append(element("p", "project-intro", intro));
  return result;
}

function external(label, href) {
  const result = element("a", "", label);
  result.href = href;
  result.target = "_blank";
  result.rel = "noopener noreferrer";
  return result;
}

function rows(items, className = "project-rows") {
  const result = element("div", className);
  for (const item of items) {
    const row = element("article", "project-row");
    const title = element("div", "project-row-title");
    if (item.id) title.append(element("span", "project-number", item.id));
    title.append(element("h3", "", item.title));
    if (item.priority) title.append(element("span", "badge", "First priority"));
    row.append(title, element("p", "", item.description));
    result.append(row);
  }
  return result;
}

export function renderProject(container) {
  container.replaceChildren();
  const overview = section("project-overview", "The goal", project.goal);
  overview.append(element("p", "", project.pilot), element("p", "project-direction", project.direction));
  const actions = element("div", "actions project-actions");
  const demo = element("a", "button primary", "Try the working demo");
  demo.href = "#profile";
  const data = element("a", "button secondary", "Download project brief");
  data.href = "./project.json";
  data.download = "connect-onair-project.json";
  actions.append(demo, data);
  overview.append(actions);
  container.append(overview);

  const scope = section("project-scope", "Three connected processes");
  scope.append(rows(project.processes));
  container.append(scope);

  const status = section("project-status", "What works today", "The website and the separate PatriotAI tests show different parts of the plan.");
  const grid = element("div", "project-capabilities");
  const labels = { working: "Working in this website", separately_tested: "Tested separately", planned: "Planned integration" };
  for (const item of project.capabilities) {
    const card = element("article", "project-capability");
    card.append(element("span", `project-state ${item.status}`, labels[item.status]), element("h3", "", item.title), element("p", "", item.description));
    grid.append(card);
  }
  status.append(grid);
  container.append(status);

  const approach = section("project-approach", "Parser or AI?", "Keep the parser. Test where AI helps.");
  approach.append(rows(project.approach));
  container.append(approach);

  const integration = section("project-integration", "The connection still needed", project.patriot.testedDirection);
  integration.append(element("p", "project-direction", project.patriot.pendingDirection));
  integration.append(rows(project.architecture));
  const access = element("details", "project-detail");
  access.append(element("summary", "", "PatriotAI access and the next request"), element("p", "", project.patriot.access), element("p", "", project.patriot.request), external("Open Mason ITS PatriotAI help", project.patriot.helpUrl));
  integration.append(access);
  container.append(integration);

  const curation = section("project-curation", "The content and curation pilot");
  const content = element("ul", "project-list");
  for (const item of project.curation) content.append(element("li", "", item));
  curation.append(content);
  container.append(curation);

  const pilot = section("project-pilot", "Proposed pilot targets", project.baseline);
  const table = element("table", "project-table");
  table.append(element("caption", "", "Proposed acceptance criteria — subject to sponsor agreement"));
  const head = element("thead");
  const header = element("tr");
  for (const value of ["Measure", "Proposed target", "Validation"]) {
    const cell = element("th", "", value);
    cell.scope = "col";
    header.append(cell);
  }
  head.append(header);
  table.append(head);
  const body = element("tbody");
  for (const item of project.pilotTargets) {
    const row = element("tr");
    const name = element("th", "", item.measure);
    name.scope = "row";
    row.append(name, element("td", "", item.target), element("td", "", item.validation));
    body.append(row);
  }
  table.append(body);
  const scroll = element("div", "project-table-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Proposed pilot targets table");
  scroll.append(table);
  pilot.append(scroll);
  container.append(pilot);

  const decisions = section("project-decisions", "Questions to settle", "These decisions still need answers. Open each question for details.");
  for (const item of project.decisions) {
    const detail = element("details", "project-detail");
    detail.append(element("summary", "", item.question), element("p", "project-owner", item.owner), element("p", "", item.detail));
    decisions.append(detail);
  }
  container.append(decisions);

  const roadmap = section("project-roadmap", "Proposed IT493 plan", "Assignment 12 proposed these dates. Check them against the course calendar and sponsor access before fixing the schedule.");
  const phases = element("ol", "project-roadmap");
  for (const item of project.roadmap) {
    const phase = element("li");
    phase.append(element("p", "project-date", item.dates), element("h3", "", item.phase), element("p", "", item.deliverable));
    phases.append(phase);
  }
  roadmap.append(phases);
  container.append(roadmap);

  const sources = section("project-sources", "Evidence and sources", "Reviewed November 10, 2026. Private course files, real resumes, access credentials and confidential sponsor slides are not distributed with this brief.");
  const references = element("ul", "project-list");
  for (const item of project.sources) {
    const row = element("li");
    row.append(item.url ? external(item.title, item.url) : element("strong", "", item.title), element("p", "", item.detail));
    references.append(row);
  }
  sources.append(references);
  container.append(sources);
}
