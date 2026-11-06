import { initialOpportunities } from './data.js';
import { MAX_TEXT, safeUrl, fingerprint, matchOpportunity } from './domain.js';

export const STORAGE_KEY = 'connect-onair.workspace.v1';
const string = (value, max = 5000) => typeof value === 'string' && value.length <= max;
const list = value => Array.isArray(value) && value.length <= 100 && value.every(item => string(item, 100) && item.trim());
const profileValid = profile => profile && string(profile.name, 100) && string(profile.education) && string(profile.experience) && list(profile.skills) && list(profile.interests) && string(profile.sourceText, MAX_TEXT) && string(profile.fileName, 255) && urlValid(profile.sourceUrl);
const urlValid = value => {
  try { return string(value, 2000) && safeUrl(value) === value; } catch { return false; }
};
const opportunityValid = opportunity => opportunity && string(opportunity.id, 100) && opportunity.id.trim() && string(opportunity.title, 120) && opportunity.title.trim() && string(opportunity.organization, 120) && opportunity.organization.trim() && string(opportunity.description) && string(opportunity.type, 80) && string(opportunity.category, 80) && string(opportunity.location, 120) && list(opportunity.required) && opportunity.required.length > 0 && list(opportunity.preferred) && list(opportunity.interests) && typeof opportunity.sample === 'boolean' && urlValid(opportunity.url);

export function emptyState() {
  return {
    version: 1,
    draft: { text: '', url: '', fileName: '' },
    profile: { name: '', education: '', experience: '', skills: [], interests: [], sourceText: '', sourceUrl: '', fileName: '' },
    opportunities: structuredClone(initialOpportunities), selectedId: '', reviews: []
  };
}

export function validateState(value) {
  const invalid = () => { throw new Error('This is not a valid Connect onAir workspace backup.'); };
  if (!value || value.version !== 1 || !profileValid(value.profile)) invalid();
  if (!value.draft || !string(value.draft.text, MAX_TEXT) || !string(value.draft.url, 2000) || !string(value.draft.fileName, 255)) invalid();
  if (!Array.isArray(value.opportunities) || value.opportunities.length > 100 || !value.opportunities.every(opportunityValid)) invalid();
  const ids = new Set(value.opportunities.map(item => item.id));
  if (ids.size !== value.opportunities.length || typeof value.selectedId !== 'string' || (value.selectedId && !ids.has(value.selectedId))) invalid();
  if (!Array.isArray(value.reviews) || value.reviews.length > 100 || !value.reviews.every(review => {
    if (!review || !string(review.id, 100) || !['approved', 'changes_requested'].includes(review.kind) || !string(review.reviewer, 100) || !review.reviewer.trim() || !string(review.note) || !string(review.at, 40) || !Number.isFinite(Date.parse(review.at)) || !profileValid(review.profile) || !opportunityValid(review.opportunity)) return false;
    return review.fingerprint === fingerprint(review.profile, review.opportunity) && review.score === matchOpportunity(review.profile, review.opportunity).score;
  })) invalid();
  return structuredClone(value);
}

export function restoreState(storage) {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    return { state: saved ? validateState(JSON.parse(saved)) : emptyState(), error: '' };
  } catch {
    return { state: emptyState(), error: 'Saved data could not be opened. Your stored copy has not been overwritten. Export or reset before saving a new workspace.' };
  }
}

export function saveState(storage, state) {
  validateState(state);
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
