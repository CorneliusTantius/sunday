import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('session actions re-enable after creating or opening a session', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('async function createSession('), source.indexOf('async function initSessions('));
  const state = { busy: false, loadingSession: false, sessionId: null };
  const renders = [];
  const session = { id: 'session-1', messages: [] };
  const context = {
    state, localStorage: { setItem() {} }, location: {},
    $: () => ({ value: '', focus() {} }),
    request: async () => ({ json: async () => ({ session }) }),
    clearChat() {}, updateBotProfile() {}, closeMobileSidebar() {},
    renderSessions: () => renders.push(state.loadingSession),
    loadSessions: async () => renders.push(state.loadingSession),
    toast: message => assert.fail(message),
  };
  runInNewContext(`${functions}; globalThis.actions = { createSession, openSession };`, context);
  await context.actions.createSession(false);
  assert.equal(state.loadingSession, false);
  assert.equal(renders.at(-1), false);
  session.id = 'session-2';
  await context.actions.openSession('session-2', false);
  assert.equal(state.loadingSession, false);
  assert.equal(renders.at(-1), false);
});
