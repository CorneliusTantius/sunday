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
test('persona tools are in an initially open native disclosure', () => {
  assert.match(read('components/Personas.jsx'), /<details class="persona-tools-card" open><summary>Tool permissions<\/summary>/);
  assert.match(read('components/Personas.jsx'), /<\/div><\/fieldset><\/details>/);
});

