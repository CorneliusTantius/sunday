import { getSupportedThinkingLevels as sdkLevels, clampThinkingLevel as sdkClamp } from '@earendil-works/pi-ai';

// “Off” means no application-requested reasoning effort. Some providers may
// still perform mandatory reasoning even when no effort is requested.
export function getSupportedThinkingLevels(model) {
  return [...new Set(['off', ...sdkLevels(model)])];
}

export function clampThinkingLevel(model, level) {
  return level === 'off' ? 'off' : sdkClamp(model, level);
}
