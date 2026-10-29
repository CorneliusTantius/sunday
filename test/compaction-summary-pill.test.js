import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../src/web/${path}`, import.meta.url), 'utf8');

test('compaction is surfaced in chat as a pill that opens its summary', () => {
  const app = read('App.jsx');
  const pill = read('components/CompactionSummary.jsx');
  const history = read('components/MessageHistory.jsx');
  const server = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');

  assert.match(app, /<MessageHistory key=\{sessionId\}/);
  assert.match(app, /insert=\{compaction\?\.summary && <CompactionSummary key="compaction-summary" compaction=\{compaction\} \/>\}/);
  assert.match(app, /insertAt=\{compaction\?\.messageIndex \?\? messages\.length\}/);
  assert.doesNotMatch(app, /<CompactionSummary compaction=\{compaction\} \/><MessageHistory/);
  assert.match(history, /insertAt === start \+ index \+ 1/);
  assert.match(server, /function positionedCompaction\(session, compaction\)/);
  assert.match(server, /session\.latestCompaction = \{ summary: compactedSummary, through, updatedAt: Date\.now\(\) \}/);
  assert.match(app, /data\.type === 'compaction'[\s\S]*?setCompaction\(data\.compaction\?\.summary \? data\.compaction : null\)/);
  assert.match(pill, /Session compacted/);
  assert.match(pill, /View summary/);
  assert.match(pill, /aria-haspopup="dialog"/);
  assert.match(pill, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(pill, /id="compaction-summary-title">Earlier conversation summary/);
  assert.match(pill, /\{compaction\.summary\}/);
});
