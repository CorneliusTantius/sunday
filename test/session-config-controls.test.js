import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/web/components/SessionConfig.jsx', import.meta.url), 'utf8');

test('agent settings fields use a darker surface and a Nord-primary keyboard focus indicator', () => {
  for (const id of ['session-config-title', 'session-config-persona', 'session-config-model', 'session-config-thinking']) {
    const control = source.match(new RegExp(`<(?:input|select)[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(control, `missing settings control ${id}`);
    assert.match(control, /bg-black\/10/, `${id} needs a darker surface`);
    assert.match(control, /focus:bg-black\/10/, `${id} should keep its dark focus background`);
    assert.match(control, /focus:shadow-none/, `${id} should not show the default focus shadow`);
    assert.match(control, /focus:outline-none/, `${id} should suppress the default focus outline`);
    assert.match(control, /focus-visible:outline-2[^\"]*focus-visible:outline-primary/, `${id} needs a visible Nord-primary keyboard focus indicator`);
  }
});
