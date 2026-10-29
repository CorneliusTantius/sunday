import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../src/web/${path}`, import.meta.url), 'utf8');

test('compaction is surfaced in chat as a pill that opens its summary', () => {
  const app = read('App.jsx');
  const pill = read('components/CompactionSummary.jsx');

  assert.match(app, /<CompactionSummary compaction=\{compaction\} \/>/);
  assert.match(app, /data\.type === 'compaction'[\s\S]*?setCompaction\(data\.compaction\?\.summary \? data\.compaction : null\)/);
  assert.match(pill, /Session compacted/);
  assert.match(pill, /View summary/);
  assert.match(pill, /aria-haspopup="dialog"/);
  assert.match(pill, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(pill, /id="compaction-summary-title">Earlier conversation summary/);
  assert.match(pill, /\{compaction\.summary\}/);
});
