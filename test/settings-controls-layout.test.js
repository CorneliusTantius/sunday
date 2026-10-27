import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../src/web/${path}`, import.meta.url), 'utf8');
test('provider settings can re-fetch the current provider model list', () => {
  const settings = read('components/Settings.jsx');
  assert.match(settings, /class="settings-heading-actions"><button class="secondary-button" id="refresh-models"/);
  assert.match(settings, /id="add-provider"/);
  assert.match(settings, /async function refreshModels\(\)[\s\S]*?jsonRequest\('\/api\/settings\/models\/refresh', 'POST', \{ provider, mode \}\)[\s\S]*?setModels\(data\.models \|\| \[\]\)[\s\S]*?await onReload\?\.\(\)[\s\S]*?toast\('Model list refreshed\.'\)/);
  assert.match(settings, /\/api\/settings\?provider=\$\{encodeURIComponent\(nextProvider\)\}&mode=\$\{encodeURIComponent\(nextMode\)\}/);
  assert.match(settings, /disabled=\{saving \|\| loading\}/);
});

test('model refresh also updates the active chat model selector', () => {
  const app = read('App.jsx');
  assert.match(app, /const sessionConfigRef = useRef\(null\)/);
  assert.match(app, /const config = sessionConfigRef\.current[\s\S]*?data\.connectedModels[\s\S]*?item\.provider === config\.provider && item\.mode === config\.mode[\s\S]*?setSessionModels\(models\)/);
  assert.match(app, /sessionConfigRef\.current = session\.config \|\| null/);
});

test('mobile settings uses a full-height layout and swipeable section pills', () => {
  const mobileRules = read('style.css').split('/* Settings becomes a full-height mobile workspace')[1];
  assert.match(mobileRules, /@media \(max-width: 700px\)[\s\S]*?#settings-backdrop \{ place-items: stretch; padding: 0; \}/);
  assert.match(mobileRules, /\.settings-modal \{[^}]*height: 100dvh;[^}]*max-height: 100dvh;/s);
  assert.match(mobileRules, /\.settings-providers \{[^}]*overflow-x: auto;[^}]*overflow-y: hidden;[^}]*-webkit-overflow-scrolling: touch;/s);
  assert.match(mobileRules, /\.settings-nav \{[^}]*flex: 0 0 auto;[^}]*min-width: max-content;[^}]*border-radius: 999px;/s);
  assert.match(mobileRules, /\.settings-detail \{[^}]*overflow-y: auto;/s);
  assert.match(mobileRules, /@media \(max-width: 440px\)[\s\S]*?\.settings-select-row \{[^}]*grid-template-columns: minmax\(0, 1fr\);/s);
});

test('settings dropdowns use shared balanced rows', () => {
  const settings = read('components/Settings.jsx');
  assert.equal((settings.match(/class="settings-select-row"/g) || []).length, 5);
  assert.match(settings, /connectedModels\.map\(item => <option/);
  assert.doesNotMatch(settings, /id="config-provider"|id="config-mode"/);
  assert.match(read('style.css'), /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(read('components/Personas.jsx'), /persona-color-field settings-select-row/);
});
test('persona tools are in an initially open native disclosure', () => {
  assert.match(read('components/Personas.jsx'), /<details class="persona-tools-card" open><summary>Tool permissions<\/summary>/);
  assert.match(read('components/Personas.jsx'), /<\/div><\/fieldset><\/details>/);
});

test('persona tool descriptions wrap inside the available list width', () => {
  const css = read('style.css');
  assert.match(css, /#persona-tools \.repository-checkbox\s*\{[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\);/s);
  assert.doesNotMatch(css, /#persona-tools \.repository-checkbox > span:first-of-type\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /#persona-tools \.persona-tool-detail\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s);
  assert.match(css, /#persona-tools \.persona-tool-list li\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s);
  assert.match(css, /#persona-tools code\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s);
});

test('persona identity inputs share the balanced settings rows', () => {
  const personas = read('components/Personas.jsx');
  for (const id of ['persona-name', 'persona-specialty']) {
    assert.ok(personas.includes(`<div class="settings-select-row"><label class="field-label" for="${id}">`));
  }
  assert.match(read('style.css'), /\.settings-select-row \.select,\s*\.settings-select-row \.text-input \{/);
});

 test('persona color preview sits in the left column and centers with the control', () => {
  const personas = read('components/Personas.jsx');
  assert.match(personas, /class="persona-color-label">[\s\S]*?id="persona-preview"[\s\S]*?<\/div><\/div><select class="select" id="persona-color"/);
  assert.match(read('style.css'), /\.persona-color-label \{ display: flex; align-items: center;/);
  assert.doesNotMatch(read('style.css'), /\.persona-appearance \{[^}]*align-items: flex-end/);
});
