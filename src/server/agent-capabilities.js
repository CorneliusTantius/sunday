import { REPOSITORY_TOOL_NAMES, validateTools } from './tools.js';

const childManagementTools = new Set(['subagent_create', 'subagent_send_prompt', 'subagent_list']);

// The same effective grants drive tool exposure, prompt guidance, and dispatch.
export function resolveAgentTools(profile, {
  hasRepositories = false,
  isChild = false,
  subagentsEnabled = true,
  allowWhisper = true,
  hasWhisperTargets = true,
} = {}) {
  return validateTools(profile.allowedTools).filter(name => {
    if (REPOSITORY_TOOL_NAMES.includes(name) && !hasRepositories) return false;
    if (childManagementTools.has(name) && (isChild || !subagentsEnabled)) return false;
    if (name === 'agent_whisper' && (isChild || !allowWhisper || !hasWhisperTargets)) return false;
    return true;
  });
}
