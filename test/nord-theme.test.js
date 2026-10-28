import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../src/web/${path}`, import.meta.url), 'utf8');

test('the default DaisyUI theme uses Nord dark colors and app chrome matches', () => {
  const css = read('style.css');
  const theme = css.match(/@plugin "daisyui\/theme" \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(theme, 'missing custom Nord theme');
  assert.match(css, /themes: nord-dark --default;/);
  assert.match(theme, /name: "nord-dark";/);
  assert.match(theme, /color-scheme: dark;/);
  for (const radius of [
    '--radius-selector: 9999px',
    '--radius-field: 9999px',
    '--radius-box: 1.25rem',
  ]) assert.ok(theme.includes(radius), `missing rounded shape token ${radius}`);
  for (const color of [
    '--color-base-100: #2E3440',
    '--color-base-200: #3B4252',
    '--color-base-300: #434C5E',
    '--color-base-content: #ECEFF4',
    '--color-primary: #88C0D0',
    '--color-secondary: #81A1C1',
    '--color-accent: #B48EAD',
    '--color-accent-content: #292F3A',
    '--color-info: #88C0D0',
    '--color-success: #A3BE8C',
    '--color-warning: #EBCB8B',
    '--color-error: #A64F59',
    '--color-error-content: #ECEFF4',
  ]) assert.ok(theme.includes(color), `missing Nord token ${color}`);

  const html = read('index.html');
  assert.match(html, /data-theme="nord-dark"/);
  assert.match(html, /<meta name="theme-color" content="#2E3440">/);
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.background_color, '#2E3440');
  assert.equal(manifest.theme_color, '#2E3440');
});

test('pill controls, rounded surfaces, and editable textareas keep appropriate shapes', () => {
  const bubble = read('components/MessageBubble.js');
  assert.ok(bubble.includes('[.user_&]:rounded-3xl'));
  for (const path of [
    'components/McpServers.jsx',
    'components/Memory.jsx',
    'components/Personas.jsx',
    'components/ScheduledJobs.jsx',
    'components/Skills.jsx',
  ]) assert.ok(read(path).includes('textarea textarea-bordered rounded-box'), `${path} needs a rounded text area`);
  for (const path of [
    'components/McpServers.jsx',
    'components/Repositories.jsx',
    'components/SessionConfig.jsx',
    'components/Personas.jsx',
    'components/ScheduledJobs.jsx',
  ]) assert.ok(read(path).includes('checkbox rounded-md') || read(path).includes('checkbox checkbox-primary rounded-md'), `${path} needs square checkbox corners`);
});

test('brand and persona characters use Nord colors', () => {
  const character = read('components/Character.jsx');
  for (const color of ['#88C0D0', '#B48EAD', '#5E81AC', '#EBCB8B', '#A3BE8C', '#BF616A']) {
    assert.ok(character.includes(color), `missing Nord character color ${color}`);
  }
  assert.ok(character.includes('fill="#2E3440"'), 'character background is not Nord Polar Night');

  for (const logo of ['logo.svg', 'logo-blink.svg', 'logo-sideeye.svg', 'logo-sweat.svg']) {
    const svg = read(logo);
    assert.ok(svg.includes('#2E3440'), `${logo} background is not Nord Polar Night`);
    assert.ok(svg.includes('#88C0D0'), `${logo} accent is not Nord Frost`);
  }
});
