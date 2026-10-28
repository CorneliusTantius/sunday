import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../src/web/${path}`, import.meta.url), 'utf8');
test('provider settings can re-fetch the current provider model list', () => {
  const settings = read('components/Settings.jsx');
  assert.match(settings, /id="refresh-models"/);
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


test('settings model selector is populated from connected models', () => {
  assert.match(read('components/Settings.jsx'), /connectedModels\.map\(item => <option/);
});
test('persona character color selector has a subtle visible boundary', () => {
  const personas = read('components/Personas.jsx');
  assert.match(personas, /<select class="select select-bordered border-base-300[^"]*" id="persona-color"/);
});
test('requested icons, controls, and composer use borderless and transparent styling', () => {
  const settings = read('components/Settings.jsx');
  const mcp = read('components/McpServers.jsx');
  const composer = read('components/ComposerInput.jsx');
  const character = read('components/Character.jsx');
  for (const id of ['refresh-models', 'add-provider', 'update-app', 'restart-app']) {
    assert.match(settings, new RegExp(`class="btn btn-ghost border-0[^\\"]*" id="${id}"`));
  }
  assert.match(mcp, /<button class="btn btn-ghost border-0" disabled=\{busy\} onClick=\{\(\) => open\(\)\}>＋ Add server/);
  assert.match(settings, /card card-border[^\"]*bg-black\/10[^\"]*hover:bg-black\/20/);
  assert.match(composer, /bg-transparent[^\"]*focus:bg-transparent/);
  assert.doesNotMatch(character, /border-\[3px\]/);
});

test('persona tools are in an initially open native disclosure', () => {
  const personas = read('components/Personas.jsx');
  assert.match(personas, /<details class="collapse collapse-arrow[^\"]*" open><summary>Tool permissions<\/summary>/);
  assert.match(personas, /<fieldset class="grid gap-2"><legend class="sr-only">Tool permissions<\/legend>/);
  assert.match(personas, /<\/div><\/fieldset><\/details>/);
});

test('settings section navigation is compact, left-aligned, and has no hover border highlight', () => {
  const settings = read('components/Settings.jsx');
  assert.match(settings, /<nav class="[^\"]*gap-1[^\"]*" aria-label="Settings sections">/);
  assert.equal((settings.match(/btn-ghost w-max sm:w-full shrink-0 justify-start text-left hover:border-transparent/g) || []).length, 5);
});

test('config controls use darker Nord backgrounds and retain a primary keyboard focus indicator', () => {
  const settings = read('components/Settings.jsx');
  const config = settings.match(/<section inert=\{page !== 'config'\}[\s\S]*?<\/section>/)?.[0];
  assert.ok(config);
  assert.equal((config.match(/bg-black\/10/g) || []).length, 3);
  assert.equal((config.match(/focus-visible:outline-primary/g) || []).length, 3);
  assert.equal((config.match(/focus:outline-none/g) || []).length, 3);
});

