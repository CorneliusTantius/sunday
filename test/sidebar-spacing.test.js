import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../src/web/${path}`, import.meta.url), 'utf8');

test('left navigation orders Repositories, Automations, Context, Skills, and MCP', () => {
  const app = read('App.jsx');
  const nav = app.slice(app.indexOf('<ul class="menu menu-sm w-full gap-1 p-0">'), app.indexOf('</ul>', app.indexOf('<ul class="menu menu-sm w-full gap-1 p-0">')));
  const destinations = ['repos-link', 'scheduled-job-link', 'context-link', 'skills-link', 'mcp-link'];
  assert.deepEqual(destinations.map(id => nav.indexOf(`id="${id}"`)), [...destinations].map(id => nav.indexOf(`id="${id}"`)).sort((a, b) => a - b));
  assert.match(app, /id="skills-link" href="#context\/skills" aria-current=\{page === 'skills' \? 'page' : undefined\}/);
  assert.match(app, /id="context-link" href="#context"/);
  assert.match(app, /id="scheduled-job-link"[^>]*>.*?<MenuIcon name="schedule" \/>Automations/s);
  assert.match(app, /id="mcp-link" href="#mcp"/);
  assert.match(app, /Repositories<\/a><\/li>[\s\S]*?<hr class="my-1 border-base-300"[\s\S]*?id="sessions-list"/);
  assert.doesNotMatch(app, /<Character profile=\{session\.profile/);
});

test('Context graph nodes remain keyboard-operable buttons', () => {
  const memory = read('components/Memory.jsx');
  assert.match(memory, /<g key=\{node\.id\} transform=\{`translate\(\$\{node\.x\} \$\{node\.y\}\)`\} role="button" tabIndex="0" aria-label=\{`Open \$\{node\.automatic \? 'auto' : 'intentional'\} note: \$\{node\.title\}`\}/);
  assert.match(memory, /onKeyDown=\{event => \{ if \(event\.key === 'Enter' \|\| event\.key === ' '\)/);
});

test('reduced-motion preferences disable page scrolling, transitions, and animation', () => {
  const html = read('index.html');
  assert.match(html, /<html[^>]*class="[^"]*motion-reduce:scroll-auto"/);
  assert.match(html, /<body[^>]*motion-reduce:transition-none motion-reduce:animate-none/);
  for (const utility of [
    'motion-reduce:[&_*]:transition-none',
    'motion-reduce:[&_*]:animate-none',
    'motion-reduce:[&_*::before]:animate-none',
    'motion-reduce:[&_*::after]:animate-none',
  ]) assert.ok(html.includes(utility), `missing reduced-motion utility ${utility}`);
});

test('skill builder and npm import forms remain in a native modal dialog', () => {
  const skills = read('components/Skills.jsx');
  assert.match(skills, /<dialog ref=\{dialog\}/);
  assert.match(skills, /onSubmit=\{installNpmSkill\}/);
  assert.match(skills, /onSubmit=\{saveSkill\}/);
  assert.match(skills, /element\.showModal\(\)/);
});
