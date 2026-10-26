import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_GRAPH_HEIGHT, CONTEXT_GRAPH_WIDTH, layoutContextGraph } from '../src/web/context-graph.js';

test('context graph layout is deterministic and keeps note dots inside its canvas', () => {
  const nodes = [
    { id: 'one', source: 'notes/one.md', title: 'One' },
    { id: 'two', source: 'notes/two.md', title: 'Two' },
    { id: 'three', source: 'notes/three.md', title: 'Three' },
    { id: 'four', source: 'notes/four.md', title: 'Four' },
  ];
  const links = [
    { source: 'notes/one.md', target: 'notes/two.md', relation: 'related' },
    { source: 'notes/two.md', target: 'notes/one.md', relation: 'backlink' },
    { source: 'notes/two.md', target: 'notes/three.md', relation: 'supports' },
    { source: 'missing.md', target: 'notes/one.md', relation: 'ignored' },
    { source: 'notes/three.md', target: 'notes/three.md', relation: 'self' },
  ];

  const layout = layoutContextGraph(nodes, links);
  assert.deepEqual(layout, layoutContextGraph(nodes, links));
  assert.deepEqual(layout.map(node => node.degree), [1, 2, 1, 0]);
  for (const node of layout) {
    assert.ok(node.x >= 56 && node.x <= CONTEXT_GRAPH_WIDTH - 56);
    assert.ok(node.y >= 56 && node.y <= CONTEXT_GRAPH_HEIGHT - 56);
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
  }
  assert.ok(nodes.every(node => !('x' in node) && !('y' in node) && !('degree' in node)), 'layout does not mutate the input nodes');

  const pair = nodes.slice(0, 2);
  const linked = layoutContextGraph(pair, [{ source: pair[0].source, target: pair[1].source }]);
  const isolated = layoutContextGraph(pair);
  const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  assert.ok(distance(linked) < distance(isolated), 'linked notes pull closer together than unrelated notes');
});

test('context graph layout handles no notes and a lone unlinked note', () => {
  assert.deepEqual(layoutContextGraph(), []);
  const [node] = layoutContextGraph([{ id: 'alone', source: 'alone.md', title: 'Alone' }]);
  assert.equal(node.degree, 0);
  assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
});
