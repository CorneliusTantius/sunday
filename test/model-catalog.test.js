import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { createModelCatalog } from '../src/server/model-catalog.js';

const terra = {
  id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', api: 'openai-responses', provider: 'openai',
  reasoning: true, input: ['text', 'image'], contextWindow: 272000, maxTokens: 128000, type: 'chat',
};

test('refreshes, exposes, and persists remote provider models', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunday-model-catalog-'));
  const path = join(directory, 'catalogs.json');
  try {
    const catalog = createModelCatalog();
    const provider = catalog.withProvider(openaiProvider());
    assert.equal(provider.getModels().some(model => model.id === terra.id), false);

    const count = await catalog.refresh('openai', path, async (url, options) => {
      assert.equal(url.href, 'https://pi.dev/api/models/providers/openai?types=chat%2Cimage%2Cclassifier');
      assert.ok(options.signal);
      return new Response(JSON.stringify([terra]), { status: 200 });
    });

    assert.equal(count, 1);
    assert.equal(provider.getModels().find(model => model.id === terra.id)?.contextWindow, terra.contextWindow);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).openai[0].id, terra.id);

    const restored = createModelCatalog();
    await restored.load(path);
    assert.equal(restored.withProvider(openaiProvider()).getModels().some(model => model.id === terra.id), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects an empty compatible model response without persisting it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sunday-model-catalog-'));
  try {
    const catalog = createModelCatalog();
    await assert.rejects(
      catalog.refresh('openai', join(directory, 'catalogs.json'), async () => new Response(JSON.stringify([{ ...terra, provider: 'wrong' }]), { status: 200 })),
      /No compatible openai chat models/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
