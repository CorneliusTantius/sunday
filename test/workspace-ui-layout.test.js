import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../src/web/components/${path}`, import.meta.url), 'utf8');
const buttonClasses = source => [...source.matchAll(/<button[^>]*class="([^"]*)"[^>]*>/g)]
  .map(match => match[1]).filter(classes => classes.includes('btn'));

test('Repositories retains manual pulls but no longer contains automatic pull code or controls', () => {
  const source = read('Repositories.jsx');
  assert.match(source, /id="pull-all-repos"/);
  assert.match(source, /onClick=\{syncAll\}/);
  assert.match(source, /onClick=\{\(\) => sync\(repo\)\}/);
  assert.doesNotMatch(source, /autoPull|AUTO_PULL|auto-pull|Automatic pull|sunday-repositories-auto-pull/i);
});

test('Repositories and Files buttons have no borders; Files directory control only offers Up', () => {
  const repositories = buttonClasses(read('Repositories.jsx'));
  const filesSource = read('CodeEditor.jsx');
  const files = buttonClasses(filesSource);
  assert.ok(repositories.length > 0);
  assert.ok(files.length > 0);
  for (const classes of [...repositories, ...files]) assert.match(classes, /(?:^|\s)border-0(?:\s|$)/, classes);
  assert.match(filesSource, />Up<\/button>/);
  assert.doesNotMatch(filesSource, />Open<\/button>|btn-outline/);
});

test('Automation builder has consistent responsive margins and full-width controls', () => {
  const source = read('ScheduledJobs.jsx');
  assert.match(source, /grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-/);
  assert.match(source, /card card-bordered w-full min-w-0 gap-0 bg-base-200 p-4 sm:p-6/);
  assert.match(source, /grid min-w-0 gap-x-4 gap-y-5 pt-5 sm:grid-cols-2/);
  for (const id of ['scheduled-job-name', 'scheduled-job-agent', 'scheduled-job-model', 'scheduled-job-thinking', 'scheduled-job-frequency', 'scheduled-job-timezone']) {
    assert.match(source, new RegExp(`class="(?:input|select) [^\\"]*w-full[^\\"]*" id="${id}"`), `${id} should fill its grid cell`);
  }
});
