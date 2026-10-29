import { isAutomaticContextSource } from './context-notes.js';

export const CONTEXT_GRAPH_WIDTH = 1000;
export const CONTEXT_GRAPH_HEIGHT = 620;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// A damped spring expands the settled layout from the center and gently overshoots.
export function animateContextGraph(nodes, progress, height = CONTEXT_GRAPH_HEIGHT) {
  if (progress >= 1) return nodes;
  const time = Math.max(0, progress);
  const scale = 1 - 0.55 * Math.exp(-5 * time) * Math.cos(12 * time);
  const centerX = CONTEXT_GRAPH_WIDTH / 2, centerY = height / 2;
  return nodes.map(node => ({ ...node, x: centerX + (node.x - centerX) * scale, y: centerY + (node.y - centerY) * scale }));
}

/** Lay out context notes with a small deterministic force simulation. */
export function layoutContextGraph(nodes = [], links = []) {
  if (!nodes.length) return [];

  const count = nodes.length;
  const centerX = CONTEXT_GRAPH_WIDTH / 2;
  const centerY = CONTEXT_GRAPH_HEIGHT / 2;
  const maxRadius = Math.min(centerX, centerY) - 56;
  const positions = nodes.map((_, index) => {
    const angle = index * GOLDEN_ANGLE;
    const radius = Math.min(180, 32 + Math.sqrt((index + 1) / count) * 130);
    return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius, vx: 0, vy: 0 };
  });
  const nodeIndex = new Map(nodes.map((node, index) => [node.source || node.id, index]));
  const edgeKeys = new Set();
  const edges = [];
  const degree = new Array(count).fill(0);
  for (const link of links) {
    const from = nodeIndex.get(link.source), to = nodeIndex.get(link.target);
    if (from === undefined || to === undefined || from === to) continue;
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push([from, to]);
    degree[from]++;
    degree[to]++;
  }

  // Scale repulsion with graph size so large graphs fill the canvas rather than
  // accumulating at its boundary. Links still draw related notes together.
  const repulsion = 18 * Math.min(1, 20 / count);
  const iterations = count < 50 ? 150 : count < 120 ? 100 : count < 300 ? 65 : count < 700 ? 30 : 16;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const forces = positions.map(() => ({ x: 0, y: 0 }));
    for (let left = 0; left < count; left++) {
      for (let right = left + 1; right < count; right++) {
        const dx = positions[right].x - positions[left].x;
        const dy = positions[right].y - positions[left].y;
        const distanceSquared = Math.max(25, dx * dx + dy * dy);
        const repel = repulsion / distanceSquared;
        const fx = dx * repel, fy = dy * repel;
        forces[left].x -= fx; forces[left].y -= fy;
        forces[right].x += fx; forces[right].y += fy;
      }
    }
    for (const [from, to] of edges) {
      const dx = positions[to].x - positions[from].x;
      const dy = positions[to].y - positions[from].y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const spring = (distance - 35) * 0.025;
      const fx = dx / distance * spring, fy = dy / distance * spring;
      forces[from].x += fx; forces[from].y += fy;
      forces[to].x -= fx; forces[to].y -= fy;
    }
    const damping = 0.82;
    for (let index = 0; index < count; index++) {
      const point = positions[index], force = forces[index];
      force.x += (centerX - point.x) * 0.01;
      force.y += (centerY - point.y) * 0.01;
      point.vx = (point.vx + force.x) * damping;
      point.vy = (point.vy + force.y) * damping;
      const speed = Math.hypot(point.vx, point.vy);
      if (speed > 10) { point.vx *= 10 / speed; point.vy *= 10 / speed; }
      point.x += point.vx;
      point.y += point.vy;
      // A radial boundary avoids piling nodes along the four sides of the canvas.
      const dx = point.x - centerX, dy = point.y - centerY;
      const radius = Math.hypot(dx, dy);
      if (radius > maxRadius) {
        point.x = centerX + dx * maxRadius / radius;
        point.y = centerY + dy * maxRadius / radius;
        // Remove outward velocity while allowing motion around the boundary.
        const outward = (point.vx * dx + point.vy * dy) / radius;
        if (outward > 0) { point.vx -= outward * dx / radius; point.vy -= outward * dy / radius; }
      }
    }
  }

  return nodes.map((node, index) => ({ ...node, x: positions[index].x, y: positions[index].y, degree: degree[index] }));
}

/** Lay out automatic and intentional notes in separate graph lanes. */
export function layoutSeparatedContextGraph(nodes = [], links = [], vertical = false) {
  if (!nodes.length) return [];

  const allSources = new Set(nodes.map(node => node.source || node.id));
  const totalDegree = new Map([...allSources].map(source => [source, 0]));
  const countedEdges = new Set();
  for (const link of links) {
    if (!allSources.has(link.source) || !allSources.has(link.target) || link.source === link.target) continue;
    const edge = JSON.stringify([link.source, link.target].sort());
    if (countedEdges.has(edge)) continue;
    countedEdges.add(edge);
    totalDegree.set(link.source, totalDegree.get(link.source) + 1);
    totalDegree.set(link.target, totalDegree.get(link.target) + 1);
  }

  return [false, true].flatMap(automatic => {
    const groupNodes = nodes.filter(node => isAutomaticContextSource(node.source) === automatic);
    const groupSources = new Set(groupNodes.map(node => node.source || node.id));
    const groupLinks = links.filter(link => groupSources.has(link.source) && groupSources.has(link.target));
    const centerX = vertical ? CONTEXT_GRAPH_WIDTH / 2 : CONTEXT_GRAPH_WIDTH * (automatic ? 0.75 : 0.25);
    const centerY = vertical ? CONTEXT_GRAPH_HEIGHT * (automatic ? 1.5 : 0.5) : CONTEXT_GRAPH_HEIGHT / 2;
    return layoutContextGraph(groupNodes, groupLinks).map(node => ({
      ...node,
      automatic,
      degree: totalDegree.get(node.source || node.id) || 0,
      x: vertical ? centerX + (node.x - CONTEXT_GRAPH_WIDTH / 2) * 0.84 : centerX + (node.x - CONTEXT_GRAPH_WIDTH / 2) * 0.42,
      y: vertical ? centerY + (node.y - CONTEXT_GRAPH_HEIGHT / 2) * 0.84 : node.y,
    }));
  });
}
