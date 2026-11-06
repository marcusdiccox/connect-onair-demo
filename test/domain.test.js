import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSkills, parseProfile, matchOpportunity, rankedOpportunities, createReview, currentDecision, validateUpload, MAX_FILE_SIZE, safeUrl } from '../src/domain.js';
import { emptyState, validateState, restoreState, saveState, STORAGE_KEY } from '../src/storage.js';
import { sampleResume } from '../src/data.js';

test('extracts provided fields and leaves missing details blank', () => {
  const profile = parseProfile(sampleResume);
  assert.equal(profile.name, 'Alex Morgan');
  assert.match(profile.education, /George Mason/);
  assert.match(profile.experience, /network alerts/);
  assert.ok(profile.skills.includes('Python'));
  assert.ok(profile.interests.includes('Threat intelligence'));
  const short = parseProfile('Skills: Python');
  assert.equal(short.name, '');
  assert.equal(short.education, '');
  assert.equal(short.experience, '');
  assert.throws(() => parseProfile('  '), /paste/);
});

test('skill detection handles aliases and language boundaries', () => {
  const skills = detectSkills('JavaScript, Node.js, C++, C#, React.js, PostgreSQL and GitHub');
  for (const skill of ['JavaScript', 'Node.js', 'C++', 'C#', 'React', 'SQL', 'Git']) assert.ok(skills.includes(skill), skill);
  assert.ok(!skills.includes('Java'));
  assert.ok(!detectSkills('No experience with Python; JavaScript developer').includes('Python'));
  assert.equal(detectSkills('communicationless typography').length, 0);
});

test('matching is calculated from required, preferred and interest coverage', () => {
  const profile = { skills: ['Python', 'Linux'], interests: ['Open source'] };
  const opportunity = { required: ['Python', 'SQL'], preferred: ['Linux'], interests: ['Open Source'] };
  const result = matchOpportunity(profile, opportunity);
  assert.equal(result.score, 65);
  assert.deepEqual(result.requiredMatched, ['Python']);
  assert.deepEqual(result.missing, ['SQL']);
  assert.equal(matchOpportunity({ skills: [], interests: [] }, opportunity).score, 0);
  assert.equal(matchOpportunity(profile, { required: ['Python'], preferred: [], interests: [] }).score, 100);
});

test('different profiles change rankings and filters search actual skills', () => {
  const state = emptyState();
  const web = { skills: ['HTML', 'CSS', 'JavaScript', 'WordPress', 'Accessibility', 'Git'], interests: ['Open Source'] };
  assert.equal(rankedOpportunities(web, state.opportunities)[0].opportunity.id, 'sample-web');
  const security = parseProfile(sampleResume);
  assert.equal(rankedOpportunities(security, state.opportunities)[0].opportunity.id, 'sample-security');
  assert.equal(rankedOpportunities(web, state.opportunities, { query: 'unfindable' }).length, 0);
  assert.equal(rankedOpportunities(web, state.opportunities, { category: 'Design' })[0].opportunity.id, 'sample-design');
});

test('reviews snapshot data, require a reviewer and expire after profile or listing edits', () => {
  const state = emptyState();
  state.profile = parseProfile(sampleResume);
  state.selectedId = 'sample-security';
  assert.throws(() => createReview(state, 'approved', '', '', '1', new Date().toISOString()), /reviewer/);
  assert.throws(() => createReview(state, 'changes_requested', 'Taylor', '', '1', new Date().toISOString()), /Explain/);
  state.reviews.push(createReview(state, 'approved', 'Taylor', 'Checked source', '1', new Date().toISOString()));
  const opportunity = state.opportunities[0];
  assert.equal(currentDecision(state, opportunity).kind, 'approved');
  state.profile.skills.push('SQL');
  assert.equal(currentDecision(state, opportunity), null);
  assert.ok(!state.reviews[0].profile.skills.includes('SQL'));
  state.profile = structuredClone(state.reviews[0].profile);
  opportunity.required.push('SQL');
  assert.equal(currentDecision(state, opportunity), null);
});

test('upload validation rejects unsupported, empty and oversized files', () => {
  assert.equal(validateUpload({ name: 'resume.PDF', size: 100 }), 'pdf');
  assert.throws(() => validateUpload({ name: 'resume.doc', size: 100 }), /Older/);
  assert.throws(() => validateUpload({ name: 'empty.txt', size: 0 }), /contains text/);
  assert.throws(() => validateUpload({ name: 'big.pdf', size: MAX_FILE_SIZE + 1 }), /10 MB/);
});

test('only complete web links without embedded credentials are accepted', () => {
  assert.equal(safeUrl('https://example.com'), 'https://example.com/');
  for (const value of ['javascript:alert(1)', 'example.com', 'https://user:pass@example.com']) assert.throws(() => safeUrl(value));
});

test('backup validation rejects tampered scores, duplicated ids and unsafe links', () => {
  const state = emptyState();
  assert.deepEqual(validateState(state), state);
  state.profile = parseProfile(sampleResume);
  state.selectedId = 'sample-security';
  state.reviews.push(createReview(state, 'approved', 'Taylor', '', '1', new Date().toISOString()));
  assert.doesNotThrow(() => validateState(state));
  const tampered = structuredClone(state);
  tampered.reviews[0].score = -1;
  assert.throws(() => validateState(tampered));
  const duplicate = structuredClone(state);
  duplicate.opportunities.push(duplicate.opportunities[0]);
  assert.throws(() => validateState(duplicate));
  state.profile.sourceUrl = 'javascript:alert(1)';
  assert.throws(() => validateState(state));
});

test('storage round trip persists decisions and corrupt data remains untouched', () => {
  const map = new Map();
  const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  const state = emptyState();
  state.profile = parseProfile(sampleResume);
  state.selectedId = 'sample-security';
  state.reviews.push(createReview(state, 'changes_requested', 'Taylor', 'Confirm graduation date', '2', new Date().toISOString()));
  saveState(storage, state);
  assert.equal(restoreState(storage).state.reviews[0].note, 'Confirm graduation date');
  map.set(STORAGE_KEY, 'broken json');
  assert.match(restoreState(storage).error, /not been overwritten/);
  assert.equal(map.get(STORAGE_KEY), 'broken json');
});
