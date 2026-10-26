import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
test('sidebar destinations share a row height and consistent sibling spacing', () => {
  assert.match(css, /\.feature-heading \{[^}]*min-height: 52px/);
  assert.match(css, /\.sidebar-scroll > :is\(\.feature-heading, \.agents-feature\) \+ :is\(\.feature-heading, \.agents-feature\) \{ margin-top: 8px; \}/);
  assert.match(css, /\.sidebar-scroll > \.feature-heading, \.sidebar-scroll > \.agents-feature \{ flex-shrink: 0; \}/);
});

test('sidebar hides the scrollbar without disabling scrolling', () => {
  assert.match(css, /\.sidebar-scroll \{[^}]*overflow-y: auto;[^}]*scrollbar-width: none;/);
  assert.match(css, /\.sidebar-scroll::-webkit-scrollbar \{ display: none; \}/);
});

test('standalone menu links group icons and labels like the agents link', () => {
  assert.match(css, /\.feature-link \{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: 10px;/);
  assert.match(css, /\.feature-heading\.feature-link \{ justify-content: flex-start; \}/);
  // The agents heading still reserves the opposite edge for its disclosure button.
  assert.match(css, /\.feature-heading \{[^}]*justify-content: space-between;/);
});

test('Context and Skills are separate top-level destinations below Sunday Agents', () => {
  const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /<section class="agents-feature"[\s\S]*?<\/section>\s*<a class=\{`feature-heading feature-link context-link[\s\S]*?<a class=\{`feature-heading feature-link skills-link[\s\S]*?<a class=\{`feature-heading feature-link scheduled-job-link/);
  assert.match(app, /id="skills-link" href="#context\/skills" aria-current=\{page === 'skills' \? 'page' : undefined\}/);
  assert.match(css, /\.scheduled-job-link\[aria-current="page"\]/);
});

test('Context knowledge graph renders linked dots with keyboard access and pan/zoom controls', () => {
  const memory = readFileSync(new URL('../src/web/components/Memory.jsx', import.meta.url), 'utf8');
  assert.match(memory, /layoutContextGraph\(graph\.nodes, graph\.links\)/);
  assert.match(memory, /class="context-global-svg"/);
  assert.match(memory, /data-graph-node[^>]*role="button" tabIndex="0"/);
  assert.match(memory, /onKeyDown={event => \{ if \(event\.key === 'Enter' \|\| event\.key === ' '\)/);
  assert.match(memory, /Graph zoom controls/);
  assert.match(memory, /onPointerDown={startGraphPan}/);
  assert.match(css, /\.context-graph-node-dot \.context-graph-point/);
  assert.match(css, /\.context-graph-node-dot text \{[^}]*opacity: 0; visibility: hidden;/);
  assert.match(css, /\.context-graph-node-dot:hover text, \.context-graph-node-dot:focus-visible text/);
});

test('Context and Skills do not duplicate navigation between their top-level pages', () => {
  const skills = readFileSync(new URL('../src/web/components/Skills.jsx', import.meta.url), 'utf8');
  const memory = readFileSync(new URL('../src/web/components/Memory.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(skills, /<nav class="context-section-tabs"/);
  assert.doesNotMatch(memory, /<nav class="context-section-tabs"/);
  assert.doesNotMatch(memory, /href="#context\/skills"/);
  assert.doesNotMatch(css, /\.context-section-tabs/);
  assert.doesNotMatch(css, /skills-(?:blueprint-badge|preview-grid|preview-card|card-kind)/);
});

test('skill builder and npm import forms are contained in a modal dialog', () => {
  const skills = readFileSync(new URL('../src/web/components/Skills.jsx', import.meta.url), 'utf8');
  const start = skills.indexOf('<dialog ref={dialog}');
  const end = skills.indexOf('</dialog>', start);
  assert.ok(start >= 0 && end > start);
  const modal = skills.slice(start, end);
  assert.match(modal, /class=\{`context-modal skills-dialog/);
  assert.match(modal, /onSubmit={installNpmSkill}/);
  assert.match(modal, /onSubmit={saveSkill}/);
  assert.doesNotMatch(skills.slice(0, start), /<form class="skills-form/);
  assert.doesNotMatch(skills.slice(end), /<form class="skills-form/);
  assert.match(skills, /element\.showModal\(\)/);
  assert.match(skills, /dialogClosing \? ' closing' : ''/);
});

test('Skills library enter and exit animations respect reduced motion', () => {
  const skills = readFileSync(new URL('../src/web/components/Skills.jsx', import.meta.url), 'utf8');
  assert.match(skills, /changeSource\(next\)/);
  assert.match(skills, /skills-content\$\{sourceLeaving \? ' leaving' : ''\}/);
  assert.match(skills, /removingId === skill\.id \? ' leaving' : ''/);
  assert.match(css, /\.skills-page\.exiting/);
  assert.match(css, /@keyframes skills-page-in/);
  assert.match(css, /@keyframes skills-page-out/);
  assert.match(css, /@keyframes skills-content-out/);
  assert.match(css, /@keyframes skills-card-out/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test('nested agents use smaller text, avatars and spacing than parent navigation', () => {
  assert.match(css, /\.agents-sessions \.new-chat \{ height: 32px; padding: 0 10px; font-size: 13px;/);
  assert.match(css, /\.agents-sessions \.sessions-list \{ gap: 6px; \}/);
  assert.match(css, /\.agents-sessions \.session-row \{[^}]*repeat\(2, 24px\); gap: 2px; padding: 8px;/);
  assert.match(css, /\.agents-sessions \.session-row \.avatar-character \{ width: 22px; height: 22px; \}/);
  assert.match(css, /\.agents-sessions \.session-row \.session-item \{ padding: 2px; font-size: 13px; \}/);
});


test('agents destination fills the heading without absorbing its disclosure button', () => {
  assert.match(css, /\.agents-feature \.feature-heading > \.feature-link \{ flex: 1; align-self: stretch; min-width: 0; \}/);
});

test('opening the current session navigates before skipping the session reload', () => {
  const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /if \(id === activeSession\.current\) \{ navigateChat\(navigate\); return; \}/);
});

test('settings dismiss action is labeled Close', () => {
  const settings = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
  assert.match(settings, /id="cancel-settings" onClick=\{requestClose\}>Close<\/button>/);
});

test('sidebar header omits Features and uses a left chevron to collapse', () => {
  const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /<div class="sessions-heading">FEATURES<\/div>/);
  assert.match(app, /id="collapse-sidebar"[^>]*onClick=\{closeSidebar\}><svg[^>]*aria-hidden="true"[^>]*><path d="m15 6-6 6 6 6"/);
});

test('sidebar omits provider status but retains Settings', () => {
  const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /id="connection-label"|Provider connected|class=\{`status-dot/);
  assert.match(app, /id="open-settings"/);
});

test('compact sidebar artwork retains the character beside it', () => {
  const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /aria-label="Sunday home"><span class="brand-card-heading"><Character brand \/><span class="brand-ascii"/);
  assert.doesNotMatch(app, /brand-tagline|your sunday butler/);
  assert.match(css, /\.brand-card-heading \{[^}]*gap: 14px;/);
  assert.match(css, /padding: 14px;/);
  assert.match(css, /\.sidebar-brand \.brand-ascii \{[^}]*font-size: 7px;/);
  assert.match(css, /\.sidebar-brand \.brand-character \{ width: 28px; height: 28px; flex-shrink: 0;/);
});

test('mobile Sunday card uses compact spacing and artwork', () => {
  assert.match(css, /@media \(max-width: 700px\) \{\s*\.sidebar-brand \{ margin-bottom: 12px; padding: 0 0 10px; \}/);
  assert.match(css, /\.sidebar-brand \.brand \{ padding: 8px 10px; border-radius: 14px; \}/);
  assert.ok(css.includes('font-size: min(6px, calc((100cqw - 34px) * .045))'));
});

test('artwork scales to the card space remaining beside the character', () => {
  assert.match(css, /container-type: inline-size;/);
  assert.ok(css.includes('font-size: min(7px, calc((100cqw - 42px) * .045))'));
});
