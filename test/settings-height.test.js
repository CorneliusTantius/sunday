import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// Run Settings' real sizing effect without JSX; model untransformed layout APIs.
function mount({ observer = true, height = 280, viewportHeight = 800, visualHeight = viewportHeight, maxHeight = '760px' } = {}) {
  const source = readFileSync(new URL('../src/web/components/Settings.jsx', import.meta.url), 'utf8');
  const body = source.slice(0, source.indexOf('  return <')).replace(/^import .*;\n/gm, '').replace('export default function', 'function');
  const effects = [], cleanups = [], observed = [], writes = [], flushes = [];
  let notify, disconnected = false;
  const listeners = new Map(), visualListeners = new Map();
  const container = { clientHeight: viewportHeight, computed: { paddingTop: '20px', paddingBottom: '20px' } };
  const header = { offsetHeight: 100 }, footer = { offsetHeight: 80 };
  const frame = {
    clientHeight: parseFloat(maxHeight),
    computed: { maxHeight, paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '1px', borderBottomWidth: '1px' },
    querySelector: selector => selector === '[data-settings-header]' ? header : selector === '[data-settings-footer]' ? footer : null,
  };
  const visualViewport = {
    height: visualHeight,
    addEventListener: (name, handler) => visualListeners.set(name, handler),
    removeEventListener: name => visualListeners.delete(name),
  };
  const context = {
    useState: value => [value, () => {}],
    useRef: value => ({ current: value }),
    useEffect: effect => effects.push(effect),
    useLayoutEffect: effect => effects.push(effect),
    getComputedStyle: element => element.computed,
    window: {
      visualViewport,
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: name => listeners.delete(name),
    },
    document: { addEventListener() {}, removeEventListener() {} },
    clearTimeout() {},
  };
  if (observer) context.ResizeObserver = class {
    constructor(callback) { notify = callback; }
    observe(element) { observed.push(element); }
    disconnect() { disconnected = true; }
  };
  const Settings = vm.runInNewContext(`${body}\nreturn { backdrop, contentViewport, contentLayout };\n}\nSettings`, context);
  const refs = Settings({ settings: {}, onClose() {} });
  const style = {
    set height(value) { this._height = value; writes.push(value); },
    get height() { return this._height; },
    removeProperty(key) { if (key === 'height') delete this._height; else if (key === 'max-height') delete this.maxHeight; else delete this[key]; },
  };
  refs.backdrop.current = container;
  refs.contentViewport.current = {
    style, dataset: {}, parentElement: frame,
    get offsetHeight() { flushes.push({ height: style.height }); return parseFloat(style.height); },
  };
  refs.contentLayout.current = { offsetHeight: height, querySelector: () => null };
  for (const effect of effects) cleanups.push(effect());
  return {
    style, refs, observed, writes, flushes, header, footer, frame, container, listeners, visualListeners,
    get disconnected() { return disconnected; },
    resize(height) { refs.contentLayout.current.offsetHeight = height; notify(); },
    viewportResize(height) { container.clientHeight = height; listeners.get('resize')(); },
    visualResize(height) { visualViewport.height = height; visualListeners.get('resize')(); },
    chromeResize() { notify(); },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
  };
}

test('Settings locks its initial capped height without animation, then tracks growth and shrink', () => {
  const modal = mount();
  assert.equal(modal.style.height, '280px');
  assert.deepEqual(modal.flushes, [{ height: '280px' }], 'initial height is committed before observation begins');
  assert.deepEqual(modal.observed, [modal.refs.contentLayout.current, modal.header, modal.footer, modal.container]);
  assert.ok(!modal.observed.includes(modal.refs.contentViewport.current));
  assert.ok(!modal.observed.includes(modal.frame), 'never observe the animated modal');
  for (const [natural, target] of [[540, 540], [320, 320], [900, 578], [280, 280]]) {
    modal.resize(natural);
    assert.equal(modal.style.height, `${target}px`);
  }
  modal.unmount();
  assert.equal(modal.disconnected, true);
  assert.equal(modal.style.height, undefined);
  assert.equal(modal.style.maxHeight, undefined);
  assert.equal(modal.refs.contentViewport.current.dataset.sized, undefined);
  assert.equal(modal.listeners.size, 0);
  assert.equal(modal.visualListeners.size, 0);
});

test('oversized Personas and async intermediate heights share the same capped target', () => {
  const modal = mount({ height: 1200 });
  assert.equal(modal.style.height, '578px');
  for (const height of [1600, 950, 1300, 700]) modal.resize(height);
  assert.deepEqual(modal.writes, ['578px'], 'no redundant height writes while loading tall content');
  modal.resize(300);
  modal.resize(1500);
  modal.resize(260);
  assert.deepEqual(modal.writes, ['578px', '300px', '578px', '260px'], 'rapid navigation always uses the latest capped endpoint');
  modal.unmount();
});

test('async content can grow from zero and shrink below the cap', () => {
  const modal = mount({ height: 0 });
  assert.equal(modal.style.height, '0px');
  assert.equal(modal.observed[0], modal.refs.contentLayout.current);
  modal.resize(1000);
  assert.equal(modal.style.height, '578px');
  modal.resize(400);
  assert.equal(modal.style.height, '400px');
  modal.unmount();
});

test('viewport, visual viewport and fixed chrome changes recalculate available space', () => {
  const modal = mount({ height: 1200 });
  modal.viewportResize(600);
  assert.equal(modal.style.height, '378px');
  assert.equal(modal.style.maxHeight, '378px', 'new budget clamps immediately while height transitions');
  modal.visualResize(500);
  assert.equal(modal.style.height, '278px');
  modal.header.offsetHeight = 120;
  modal.footer.offsetHeight = 90;
  modal.frame.computed.paddingTop = '10px';
  modal.frame.computed.paddingBottom = '12px';
  modal.chromeResize();
  assert.equal(modal.style.height, '226px');
  modal.visualResize(100);
  assert.equal(modal.style.height, '0px', 'never assign negative content height');
  modal.unmount();
});

test('Settings respects the CSS maximum independently of available backdrop height', () => {
  const modal = mount({ height: 1200, viewportHeight: 1000, maxHeight: '600px' });
  assert.equal(modal.style.height, '418px');
  modal.unmount();
});

test('Settings retains natural CSS sizing for navigation and async updates without ResizeObserver', () => {
  const modal = mount({ observer: false, height: 1200 });
  assert.equal(modal.style.height, undefined);
  assert.equal(modal.style.maxHeight, undefined);
  assert.equal(modal.refs.contentViewport.current.dataset.sized, undefined);
  assert.deepEqual(modal.observed, []);
  for (const height of [280, 1500, 0, 700]) {
    modal.refs.contentLayout.current.offsetHeight = height;
    assert.equal(modal.style.height, undefined, 'no stale inline height overrides natural flex sizing');
  }
  modal.unmount();
  assert.equal(modal.listeners.size, 0);
});

