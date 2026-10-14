import { useEffect, useState } from 'preact/hooks';
import { request } from '../api.js';
import { chatCommands, composerToken } from '../composer.js';

export default function ComposerInput({ value, onChange, inputRef, sessionId, disabled }) {
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(0);
  const token = !disabled && !dismissed ? composerToken(value, caret) : null;
  const type = token?.type, query = token?.query;
  useEffect(() => {
    setSelected(0); setFiles([]); setStatus('');
    if (type !== 'file' || !sessionId) return;
    const abort = new AbortController();
    setStatus('Searching files…');
    const timer = setTimeout(async () => {
      try {
        const data = await request(`/api/sessions/${encodeURIComponent(sessionId)}/files?q=${encodeURIComponent(query)}`, { signal: abort.signal });
        if (!abort.signal.aborted) { setFiles(data.files || []); setStatus(data.files?.length ? '' : 'No matching files in this session’s repositories.'); }
      } catch (error) { if (!abort.signal.aborted) setStatus(error.message); }
    }, 120);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [type, query, sessionId]);
  useEffect(() => { setDismissed(false); setCaret(0); }, [sessionId]);
  const options = type === 'command'
    ? chatCommands.filter(command => command.name.startsWith(query.toLowerCase()))
    : type === 'file' ? files.slice(0, 8).map(path => ({ name: path })) : [];
  const expanded = Boolean(token && (options.length || status));
  function updateCaret(event) {
    setCaret(event.currentTarget.selectionStart); setDismissed(false);
  }
  function accept(option) {
    const replacement = type === 'file' ? `@${JSON.stringify(option.name)} ` : `/${option.name} `;
    const next = value.slice(0, token.start) + replacement + value.slice(token.end);
    const position = token.start + replacement.length;
    onChange(next); setDismissed(true); setCaret(position);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(position, position); });
  }
  function keydown(event) {
    if (event.isComposing) return;
    if (expanded) {
      if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); return; }
      if (options.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); setSelected((selected + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length); return;
      }
      if (options.length && (event.key === 'Tab' && !event.shiftKey || event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault(); accept(options[selected] || options[0]); return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); }
  }
  return <div class="composer-input-wrap">
    {expanded && <div class="composer-suggestions">
      <div id="composer-options" role="listbox" aria-label={type === 'file' ? 'Reference a file' : 'Chat commands'}>
        {options.map((option, index) => <button key={option.name} id={`composer-option-${index}`} type="button" role="option" aria-selected={index === selected} tabIndex="-1" onMouseDown={event => event.preventDefault()} onClick={() => accept(option)}>
          <strong>{type === 'command' ? '/' : ''}{option.name}</strong>{option.description && <span>{option.description}</span>}
        </button>)}
      </div>
      {status && <div class="composer-suggestion-status" role="status">{status}</div>}
    </div>}
    <textarea ref={inputRef} id="prompt" rows="1" placeholder="Message Sunday…" aria-label="Message Sunday" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? 'composer-options' : undefined} aria-activedescendant={expanded && options.length ? `composer-option-${Math.min(selected, options.length - 1)}` : undefined} value={value} disabled={disabled} onInput={event => { onChange(event.currentTarget.value); updateCaret(event); }} onClick={updateCaret} onSelect={updateCaret} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateCaret(event); }} onKeyDown={keydown} />
  </div>;
}
