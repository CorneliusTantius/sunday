export const chatCommands = [
  { name: 'new', description: 'Start a new session' },
  { name: 'settings', description: 'Open settings' },
  { name: 'compact', description: 'Compact earlier conversation context' },
];

export function skillSlashCommands(skills = []) {
  return skills.filter(skill => skill?.enabled && /^[a-z0-9-]+$/.test(skill.id || ''))
    .map(skill => ({ name: `skill:${skill.id}`, description: `${skill.name}${skill.description ? ` — ${skill.description}` : ''}` }));
}

export function parseSkillCommand(content) {
  const match = typeof content === 'string' ? content.match(/^\/skill:([a-z0-9-]+)(?:\s+([\s\S]*))?$/i) : null;
  return match ? { id: match[1].toLowerCase(), task: match[2] || '' } : null;
}

export function composerToken(text, caret) {
  const before = text.slice(0, caret);
  if (/^\/(?:[a-z]*|skill:[a-z0-9-]*)$/i.test(before)) return { type: 'command', query: before.slice(1), start: 0, end: caret };
  const match = before.match(/(?:^|\s)@([^\s@"']*)$/);
  return match ? { type: 'file', query: match[1], start: caret - match[1].length - 1, end: caret } : null;
}

export function fileReferences(text) {
  const paths = [];
  for (const match of text.matchAll(/(?:^|\s)@("(?:[^"\\]|\\.)*"|[^\s@"']+)/g)) {
    const path = match[1].startsWith('"') ? JSON.parse(match[1]) : match[1];
    if (path.includes('/') && !paths.includes(path)) paths.push(path);
  }
  return paths;
}
