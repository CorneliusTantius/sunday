import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

const CATALOG_BASE_URL = 'https://pi.dev';
const MODEL_TYPES = 'chat,image,classifier';
const MAX_CATALOG_MODELS = 1000;
function validModel(model, provider) {
  return model && typeof model === 'object'
    && model.provider === provider
    && model.type === 'chat'
    && typeof model.id === 'string' && model.id.length > 0 && model.id.length <= 200
    && typeof model.name === 'string' && model.name.length > 0 && model.name.length <= 300
    && typeof model.api === 'string' && model.api.length > 0 && model.api.length <= 100
    && Number.isSafeInteger(model.contextWindow) && model.contextWindow > 0
    && Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0
    && Array.isArray(model.input) && model.input.every(value => value === 'text' || value === 'image');
}

function mergeModels(baseline, dynamic) {
  const merged = new Map(baseline.map(model => [model.id, model]));
  for (const model of dynamic) merged.set(model.id, model);
  return [...merged.values()];
}

export function createModelCatalog() {
  const catalogs = new Map();
  const refreshes = new Map();

  function withProvider(provider) {
    const getModels = provider.getModels.bind(provider);
    const getAllModels = provider.getAllModels.bind(provider);
    return {
      ...provider,
      getModels: () => mergeModels(getModels(), catalogs.get(provider.id) || []),
      getAllModels: () => mergeModels(getAllModels(), catalogs.get(provider.id) || []),
    };
  }

  async function load(path) {
    try {
      const persisted = JSON.parse(await readFile(path, 'utf8'));
      if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return;
      for (const [provider, models] of Object.entries(persisted)) {
        if (Array.isArray(models) && models.length <= MAX_CATALOG_MODELS) {
          catalogs.set(provider, models.filter(model => validModel(model, provider)));
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }

  async function persist(path) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(Object.fromEntries(catalogs)), { mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
  }

  function refresh(provider, path, fetcher = fetch) {
    if (refreshes.has(provider)) return refreshes.get(provider);
    const operation = (async () => {
      const url = new URL(`/api/models/providers/${encodeURIComponent(provider)}`, CATALOG_BASE_URL);
      url.searchParams.set('types', MODEL_TYPES);
      const response = await fetcher(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`Model catalog refresh failed (${response.status})`);
      const result = await response.json();
      if (!Array.isArray(result) || result.length > MAX_CATALOG_MODELS) throw new Error('Invalid model catalog response');
      const models = result.filter(model => validModel(model, provider));
      if (!models.length) throw new Error(`No compatible ${provider} chat models were returned`);
      const previous = catalogs.get(provider);
      catalogs.set(provider, models);
      try {
        await persist(path);
      } catch (error) {
        if (previous) catalogs.set(provider, previous);
        else catalogs.delete(provider);
        throw error;
      }
      return models.length;
    })().finally(() => refreshes.delete(provider));
    refreshes.set(provider, operation);
    return operation;
  }

  return { withProvider, load, refresh };
}

export const modelCatalog = createModelCatalog();
export const withRemoteCatalog = provider => modelCatalog.withProvider(provider);
export const loadModelCatalogs = path => modelCatalog.load(path);
export const refreshModelCatalog = (provider, path, fetcher) => modelCatalog.refresh(provider, path, fetcher);
