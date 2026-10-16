const paths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  agents: 'M4 5h16v12H9l-5 4V5Z M8 9h8 M8 13h5',
  repositories: 'M6 3v12a4 4 0 0 0 4 4h7 M17 5v14 M3 3h6 M14 5h6 M14 19h6',
  files: 'M4 6h6l2 2h8v12H4V6Z',
  socials: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M4 21v-2a8 8 0 0 1 16 0v2',
  schedule: 'M8 3v3 M16 3v3 M4 9h16 M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1Z M8 13h3 M8 16h6',
  finance: 'M3 3v18h18 M7 14l4-4 4 3 6-7 M16 6h5v5',
  memory: 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M5 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M19 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M10.5 9.5 6.5 15 M13.5 9.5 17.5 15 M8 18h8',
};

export default function MenuIcon({ name }) {
  return <svg class="menu-icon" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none"><path d={paths[name]} stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>;
}
