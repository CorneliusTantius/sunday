const paths = {
  agents: 'M4 5h16v12H9l-5 4V5Z M8 9h8 M8 13h5',
  repositories: 'M6 3v12a4 4 0 0 0 4 4h7 M17 5v14 M3 3h6 M14 5h6 M14 19h6',
  schedule: 'M8 3v3 M16 3v3 M4 9h16 M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1Z M8 13h3 M8 16h6',
  memory: 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M5 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M19 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M10.5 9.5 6.5 15 M13.5 9.5 17.5 15 M8 18h8',
  skills: 'm12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z',
  mcp: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M7 7h10a3 3 0 0 1 3 3v7H4v-7a3 3 0 0 1 3-3Z M9 17v4 M15 17v4 M9 12h.01 M15 12h.01',
};

export default function MenuIcon({ name }) {
  return <svg class="size-5 shrink-0 text-base-content/70" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none"><path d={paths[name]} stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>;
}
