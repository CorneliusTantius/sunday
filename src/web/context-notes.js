export function isAutomaticContextSource(source) {
  return typeof source === 'string' && source.startsWith('auto/');
}

export function groupContextNotes(notes = []) {
  return {
    intentional: notes.filter(note => !isAutomaticContextSource(note.source)),
    automatic: notes.filter(note => isAutomaticContextSource(note.source)),
  };
}
