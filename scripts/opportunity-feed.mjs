import { mkdir, writeFile } from "node:fs/promises";
import { initialOpportunities } from "../src/data.js";

await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await writeFile(new URL("../public/opportunities.json", import.meta.url), JSON.stringify({
  version: 1,
  kind: "fictional-demo-catalog",
  description: "Fictional Connect onAir test listings. Not live job openings. No candidate or workspace data is included.",
  scoring: { requiredSkills: 70, preferredSkills: 20, interests: 10, emptySections: "redistribute remaining weights proportionally", maximumResults: 10 },
  opportunities: initialOpportunities
}, null, 2) + "\n");
