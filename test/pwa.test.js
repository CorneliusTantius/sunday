import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../src/web/${path}`, import.meta.url));

test('install manifest supplies standalone app identity and correctly sized PNG icons', async () => {
  const manifest = JSON.parse(await read('public/manifest.webmanifest'));
  assert.equal(manifest.name, 'Sunday');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}`);
    assert.ok(icon);
    assert.equal(icon.type, 'image/png');
    const png = await read(`public${icon.src}`);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  const apple = await read('public/icon-180.png');
  assert.equal(apple.readUInt32BE(16), 180);
  assert.equal(apple.readUInt32BE(20), 180);
});

test('installation is production-only and service worker does not cache private data', async () => {
  const html = (await read('index.html')).toString();
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  const main = (await read('main.jsx')).toString();
  assert.match(main, /import.meta.env.PROD && window.isSecureContext/);
  assert.match(main, /register\('\/sw.js'\)/);
  const worker = (await read('public/sw.js')).toString();
  assert.doesNotMatch(worker, /caches\.|respondWith|fetch\(/);
});
