const paths = {
  agents: 'M4 5h16v12H9l-5 4V5Z M8 9h8 M8 13h5',
  repositories: 'M6 3v12a4 4 0 0 0 4 4h7 M17 5v14 M3 3h6 M14 5h6 M14 19h6',
  files: 'M4 6h6l2 2h8v12H4V6Z',
  socials: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M4 21v-2a8 8 0 0 1 16 0v2',
  schedule: 'M8 3v3 M16 3v3 M4 9h16 M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1Z M8 13h3 M8 16h6',
  memory: 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M5 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M19 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M10.5 9.5 6.5 15 M13.5 9.5 17.5 15 M8 18h8',
  skills: 'm12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z',
};

export default function MenuIcon({ name }) {
  return <svg class="menu-icon" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none"><path d={paths[name]} stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>;
}
