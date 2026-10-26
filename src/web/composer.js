export const chatCommands = [
  { name: 'new', description: 'Start a new session' },
  { name: 'settings', description: 'Open settings' },
  { name: 'compact', description: 'Compact earlier conversation context' },
];

export function composerToken(text, caret) {
  const before = text.slice(0, caret);
  if (/^\/[a-z]*$/i.test(before)) return { type: 'command', query: before.slice(1), start: 0, end: caret };
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
