export function isAutomaticContextSource(source) {
  return typeof source === 'string' && source.startsWith('auto/');
}

export function groupContextNotes(notes = []) {
  return {
    intentional: notes.filter(note => !isAutomaticContextSource(note.source)),
    automatic: notes.filter(note => isAutomaticContextSource(note.source)),
  };
}

export function filterContextNotes(notes = [], filter = 'all') {
  if (filter === 'intentional') return notes.filter(note => !isAutomaticContextSource(note.source));
  if (filter === 'automatic') return notes.filter(note => isAutomaticContextSource(note.source));
  return notes;
}
