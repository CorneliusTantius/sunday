import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

let bundle;
before(async () => {
  const result = await build({
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./fixtures/scheduled-jobs-app.jsx', import.meta.url)), formats: ['iife'], name: 'ScheduledJobsTest' } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  bundle = outputs.flatMap(output => output.output).find(output => output.type === 'chunk' && output.isEntry).code;
});

function deferredDelay() { return new Promise(resolve => setTimeout(resolve, 10)); }
async function waitFor(check) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try { check(); return; } catch (error) { await deferredDelay(); if (Date.now() >= deadline) throw error; }
  }
  check();
}

async function mount(t) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost:3000', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.confirm = () => true;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const personas = [{ id: 'persona-a', name: 'Code reviewer' }];
  const repos = [{ name: 'repo-a' }, { name: 'repo-b' }];
  const jobs = [];
  const histories = {};
  const calls = [];
  const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  window.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method, body });
    if (url === '/api/scheduled-jobs' && method === 'GET') return response({ jobs: [...jobs] });
    if (url === '/api/personas') return response({ personas });
    if (url === '/api/repos') return response({ repos });
    if (url === '/api/settings') return response({ model: 'model-a', thinkingLevel: 'off', selectedProvider: 'openai', selectedMode: 'api_key', connectedModels: [
      { id: 'model-a', name: 'Model A', provider: 'openai', providerName: 'OpenAI', mode: 'api_key', thinkingLevels: ['off', 'high'] },
      { id: 'model-b', name: 'Model B', provider: 'anthropic', providerName: 'Anthropic', mode: 'api_key', thinkingLevels: ['off', 'high'] },
    ] });
    if (url === '/api/sessions/session-run') return response({ session: { messages: [{ role: 'user', content: 'Review it' }, { role: 'assistant', content: 'Reviewed.' }] } });
    if (url === '/api/scheduled-jobs' && method === 'POST') {
      const job = { ...body, id: `job-${jobs.length + 1}`, enabled: true, createdAt: 1000, updatedAt: 1000 };
      jobs.unshift(job);
      histories[job.id] = [
        { id: 'run-ok', status: 'completed', scheduledFor: 1700000000000, sessionId: 'session-run', result: 'Review completed successfully.', error: null },
        { id: 'run-error', status: 'failed', scheduledFor: 1690000000000, result: null, error: 'Provider is not connected.' },
      ];
      return response({ job }, 201);
    }
    const runMatch = url.match(/^\/api\/scheduled-jobs\/(.+)\/runs$/);
    if (runMatch && method === 'GET') return response({ runs: histories[runMatch[1]] || [] });
    const match = url.match(/^\/api\/scheduled-jobs\/(.+)$/);
    if (match && method === 'PATCH') {
      const index = jobs.findIndex(job => job.id === match[1]);
      if (index < 0) return response({ error: 'Scheduled job not found' }, 404);
      jobs[index] = { ...jobs[index], ...body };
      return response({ job: jobs[index] });
    }
    if (match && method === 'DELETE') {
      const index = jobs.findIndex(job => job.id === match[1]);
      if (index < 0) return response({ error: 'Scheduled job not found' }, 404);
      jobs.splice(index, 1);
      return response({ deleted: true });
    }
    assert.fail(`Unexpected request ${method} ${url}`);
  };
  window.eval(bundle);
  const $ = selector => window.document.querySelector(selector);
  const click = element => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const setValue = async (element, value, event = 'input') => {
    element.value = value;
    element.dispatchEvent(new window.Event(event, { bubbles: true }));
    await deferredDelay();
  };
  await waitFor(() => {
    assert.equal($('#scheduled-job-title')?.textContent, 'Automations');
    const content = $('section[aria-labelledby="scheduled-job-title"]');
    assert.equal(content.classList.contains('flex-1'), true);
    assert.equal(content.classList.contains('min-h-0'), true);
    assert.equal(content.classList.contains('overflow-y-auto'), true);
    assert.equal($('form').classList.contains('overflow-y-auto'), false);
    assert.equal($('form').className.includes('max-h-'), false);
    assert.equal($('#scheduled-job-agent')?.disabled, false);
  });
  return { window, $, click, setValue, calls, jobs };
}

test('the application title uses Automations for the automation page', async () => {
  const source = await readFile(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /'scheduled-job': 'Automations'/);
});

test('scheduled jobs UI creates, edits, enables, disables, deletes, and displays run history', async t => {
  const h = await mount(t);
  const { window, $, click, setValue, calls, jobs } = h;

  await setValue($('#scheduled-job-name'), 'Weekly repository review');
  await setValue($('#scheduled-job-agent'), 'persona-a', 'change');
  await setValue($('#scheduled-job-model'), 'api_key:anthropic:model-b', 'change');
  await setValue($('#scheduled-job-thinking'), 'high', 'change');
  await setValue($('#scheduled-job-task'), 'Review changes in the selected repository.');
  await setValue($('#scheduled-job-frequency'), 'weekly', 'change');
  await waitFor(() => assert.ok($('#scheduled-job-day')));
  await setValue($('#scheduled-job-day'), '5', 'change');
  await setValue($('#scheduled-job-time'), '08:15');
  await setValue($('#scheduled-job-timezone'), 'America/New_York');
  const repo = [...window.document.querySelectorAll('input[type="checkbox"]')].find(input => input.value === 'repo-a');
  repo.click();
  await deferredDelay();
  $('#scheduled-job-name').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => assert.equal(jobs.length, 1));
  assert.deepEqual(calls.find(call => call.method === 'POST').body, {
    name: 'Weekly repository review', personaId: 'persona-a', task: 'Review changes in the selected repository.',
    allowedRepositories: ['repo-a'], schedule: { type: 'weekly', timezone: 'America/New_York', time: '08:15', weekday: 5 },
    model: 'model-b', provider: 'anthropic', mode: 'api_key', thinkingLevel: 'high',
  });

  const jobCard = () => $('aside[aria-label="Automations"] article');
  await waitFor(() => assert.ok(jobCard()));
  let card = jobCard();
  click([...card.querySelectorAll('button')].find(button => button.textContent === 'Show run history'));
  await waitFor(() => assert.match(card.textContent, /Review completed successfully\./));
  assert.match(card.textContent, /completed/);
  assert.match(card.textContent, /Provider is not connected\./);
  assert.match(card.textContent, /failed/);
  const transcriptDialog = () => $('dialog[aria-labelledby="scheduled-job-transcript-title"]');
  click([...card.querySelectorAll('button[aria-haspopup="dialog"]')].find(button => !button.disabled));
  await waitFor(() => assert.equal(transcriptDialog().open, true));
  await waitFor(() => assert.match(transcriptDialog().textContent, /Reviewed\./));
  click(transcriptDialog().querySelector('[aria-label="Close transcript"]'));
  await waitFor(() => assert.equal(transcriptDialog().open, false));

  click([...card.querySelectorAll('button')].find(button => button.textContent === 'Edit'));
  await waitFor(() => assert.equal($('#scheduled-job-name').value, 'Weekly repository review'));
  assert.equal($('#scheduled-job-model').value, 'api_key:anthropic:model-b');
  assert.equal($('#scheduled-job-thinking').value, 'high');
  await setValue($('#scheduled-job-name'), 'Monthly repository review');
  await setValue($('#scheduled-job-frequency'), 'monthly', 'change');
  await waitFor(() => assert.ok($('#scheduled-job-day-of-month')));
  await setValue($('#scheduled-job-day-of-month'), '31', 'change');
  await setValue($('#scheduled-job-frequency'), 'every_n_minutes', 'change');
  await waitFor(() => assert.equal($('#scheduled-job-interval')?.max, '59'));
  await setValue($('#scheduled-job-interval'), '20');
  await setValue($('#scheduled-job-frequency'), 'every_n_hours', 'change');
  assert.equal($('#scheduled-job-interval').max, '24');
  await setValue($('#scheduled-job-interval'), '4');
  await setValue($('#scheduled-job-frequency'), 'monthly', 'change');
  await setValue($('#scheduled-job-day-of-month'), '31', 'change');
  $('#scheduled-job-name').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => assert.equal(jobs[0].name, 'Monthly repository review'));
  const update = calls.filter(call => call.method === 'PATCH').at(-1);
  assert.equal(update.body.schedule.type, 'monthly');
  assert.equal(update.body.schedule.dayOfMonth, 31);
  assert.equal(update.body.model, 'model-b');
  assert.equal(update.body.thinkingLevel, 'high');

  card = jobCard();
  click([...card.querySelectorAll('button')].find(button => button.textContent === 'Disable'));
  await waitFor(() => assert.match(jobCard().textContent, /Disabled/));
  click([...jobCard().querySelectorAll('button')].find(button => button.textContent === 'Enable'));
  await waitFor(() => assert.match(jobCard().textContent, /Enabled/));
  click([...jobCard().querySelectorAll('button')].find(button => button.textContent === 'Delete'));
  await waitFor(() => assert.equal(jobCard(), null));
});
