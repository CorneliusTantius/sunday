import { createModels } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';

export const providers = [
  { ...openaiProvider(), modes: ['api_key', 'oauth'] },
  { ...anthropicProvider(), modes: ['api_key'] },
  { ...googleProvider(), modes: ['api_key'] },
];
export const credentialId = (provider, mode) => mode === 'oauth' ? 'openai-chatgpt' : provider;

export function createModelsByMode(credentials) {
  return Object.fromEntries(['api_key', 'oauth'].map(mode => {
    const store = {
      async read(id, options) { const value = await credentials.read(credentialId(id, mode)); options?.signal?.throwIfAborted(); return value?.type === mode ? value : undefined; },
      async list() { const entries = await Promise.all(providers.filter(p => p.modes.includes(mode)).map(async p => ({ providerId: p.id, value: await this.read(p.id) }))); return entries.filter(entry => entry.value).map(entry => ({ providerId: entry.providerId, type: mode })); },
      modify: (id, fn, options) => credentials.modify(credentialId(id, mode), async current => { options?.signal?.throwIfAborted(); const value = await fn(current?.type === mode ? current : undefined); options?.signal?.throwIfAborted(); return value; }),
      delete: (id, options) => { options?.signal?.throwIfAborted(); return credentials.delete(credentialId(id, mode)); },
    };
    const models = createModels({ credentials: store, ...(mode === 'oauth' ? { authContext: { env: async () => undefined, fileExists: async () => false } } : {}) });
    for (const provider of providers.filter(p => p.modes.includes(mode))) models.setProvider({ ...provider, auth: mode === 'oauth' ? { oauth: provider.auth.oauth } : { apiKey: provider.auth.apiKey } });
    return [mode, models];
  }));
}
