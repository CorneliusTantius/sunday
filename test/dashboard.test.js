import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dashboardGreeting } from '../src/web/components/dashboard-time.js';

test('dashboard greeting follows local time across day boundaries', () => {
  for (const [hour, greeting] of [[0, 'Good morning'], [11, 'Good morning'], [12, 'Good afternoon'], [17, 'Good afternoon'], [18, 'Good evening'], [23, 'Good evening']]) {
    assert.equal(dashboardGreeting(new Date(2026, 0, 1, hour)), greeting);
  }
});
test('dashboard navigation precedes agents and clock timer cleans up', () => {
  const app = readFileSync(new URL('../src/web/App.jsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../src/web/components/Dashboard.jsx', import.meta.url), 'utf8');
  assert.ok(app.indexOf('id="dashboard-link"') < app.indexOf('class="agents-feature"'));
  assert.match(app, /page === 'dashboard' && <Dashboard/);
  assert.match(dashboard, /clearInterval\(timer\)/);
  assert.match(dashboard, /now.toLocaleTimeString/);
});
