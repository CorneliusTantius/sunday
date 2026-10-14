import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../src/web/${path}`, import.meta.url), 'utf8');
test('settings dropdowns use shared balanced rows', () => {
  const settings = read('components/Settings.jsx');
  assert.equal((settings.match(/class="settings-select-row"/g) || []).length, 6);
  assert.match(read('style.css'), /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(read('components/Personas.jsx'), /persona-color-field settings-select-row/);
});
test('persona tools are in an initially open native disclosure', () => {
  assert.match(read('components/Personas.jsx'), /<details class="persona-tools-card" open><summary>Tool permissions<\/summary>/);
  assert.match(read('components/Personas.jsx'), /<\/div><\/fieldset><\/details>/);
});
