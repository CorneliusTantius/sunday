// Literal dynamic imports let the bundler defer parsers until a matching file opens.
export async function loadLanguage(path) {
  const extension = path.split('.').pop().toLowerCase();
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(extension)) {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: ['jsx', 'tsx'].includes(extension), typescript: ['ts', 'tsx'].includes(extension) });
  }
  if (extension === 'json') return (await import('@codemirror/lang-json')).json();
  if (extension === 'py') return (await import('@codemirror/lang-python')).python();
  if (['html', 'htm'].includes(extension)) return (await import('@codemirror/lang-html')).html();
  if (extension === 'css') return (await import('@codemirror/lang-css')).css();
  return [];
}
