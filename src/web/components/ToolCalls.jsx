import { useEffect, useRef, useState } from 'preact/hooks';

export default function ToolCalls({ calls = [] }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  useEffect(() => {
    if (!closing) return;
    const element = dialog.current;
    const durations = getComputedStyle(element).transitionDuration.split(',').map(value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000));
    const timer = setTimeout(() => {
      element.close();
      setOpen(false);
      setClosing(false);
    }, Math.max(0, ...durations.filter(Number.isFinite)));
    return () => clearTimeout(timer);
  }, [closing]);
  const close = () => setClosing(true);
  if (!calls.length) return null;
  const running = calls.some(call => call.status === 'running');
  const names = [...new Set(calls.map(call => call.name))].join(', ');
  return <>
    <button class="toolcalls-row" type="button" onClick={() => setOpen(true)} aria-label={`Show ${calls.length} tool ${calls.length === 1 ? 'call' : 'calls'}`}>
      <span class="toolcalls-indicator" aria-hidden="true">⌘</span>
      <span>{running ? 'Using' : 'Used'} {names}</span>
      <span class="toolcalls-count">{calls.length}</span>
      <span class="toolcalls-open">Details</span>
    </button>
    <dialog class={`toolcalls-dialog${closing ? ' closing' : ''}`} ref={dialog} aria-labelledby="toolcalls-title" onClose={() => { setOpen(false); setClosing(false); }} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
      <header class="toolcalls-header"><div><div class="eyebrow">AGENT ACTIVITY</div><h2 id="toolcalls-title">Tool calls</h2></div><button class="icon-button" type="button" aria-label="Close tool calls" onClick={close}>×</button></header>
      <div class="toolcalls-list">{calls.map((call, index) => <section class="toolcall-detail" key={call.id || index}>
        <div class="toolcall-heading"><strong>{call.name}</strong><span class={`toolcall-status ${call.status || 'completed'}`}>{call.status === 'running' ? 'Running' : call.status === 'failed' ? 'Failed' : 'Succeeded'}</span></div>
        <pre>{JSON.stringify(call.arguments ?? {}, null, 2)}</pre>
      </section>)}</div>
    </dialog>
  </>;
}
