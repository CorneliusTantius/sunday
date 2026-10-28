import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_GRAPH_HEIGHT, CONTEXT_GRAPH_WIDTH, animateContextGraph, layoutContextGraph } from '../src/web/context-graph.js';

test('graph spring expands, overshoots, and settles exactly at the layout', () => {
  const layout = [{ id: 'a', x: 700, y: 310, degree: 1 }, { id: 'b', x: 400, y: 350, degree: 1 }];
  assert.equal(animateContextGraph(layout, 0)[0].x, 590);
  assert.ok(animateContextGraph(layout, 0.26)[0].x > layout[0].x);
  assert.deepEqual(animateContextGraph(layout, 1), layout);
  assert.deepEqual(animateContextGraph([], 0.5), []);
  assert.equal(layout[0].x, 700);
});

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

test('larger graphs form a filled radial layout instead of accumulating on canvas edges', () => {
  for (const count of [20, 50, 100, 200]) {
    const nodes = Array.from({ length: count }, (_, index) => ({ id: String(index), source: `note-${index}` }));
    const links = nodes.slice(1, 20).map(node => ({ source: nodes[0].source, target: node.source }));
    for (const graphLinks of [[], links]) {
      const layout = layoutContextGraph(nodes, graphLinks);
      const radii = layout.map(node => Math.hypot(node.x - CONTEXT_GRAPH_WIDTH / 2, node.y - CONTEXT_GRAPH_HEIGHT / 2));
      const maxRadius = CONTEXT_GRAPH_HEIGHT / 2 - 56;
      assert.ok(radii.every(radius => radius <= maxRadius + 1e-8));
      assert.ok(radii.filter(radius => radius > maxRadius - 1).length < count / 4, `${count} nodes should not pile up on the boundary`);
      assert.ok(radii.filter(radius => radius < maxRadius * 0.7).length > count / 3, `${count} nodes should fill the interior`);
    }
  }
});

test('context graph layout handles no notes and a lone unlinked note', () => {
  assert.deepEqual(layoutContextGraph(), []);
  const [node] = layoutContextGraph([{ id: 'alone', source: 'alone.md', title: 'Alone' }]);
  assert.equal(node.degree, 0);
  assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
});
