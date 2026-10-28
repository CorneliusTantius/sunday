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
  const uniqueNames = [...new Set(calls.map(call => call.name))];
  const names = uniqueNames.join(', ');
  const compactNames = uniqueNames.slice(0, 3).join(', ');
  const remainingNames = uniqueNames.length - 3;
  return <>
    <button class="toolcalls-row btn btn-ghost btn-sm text-base-content/70 hover:text-base-content" type="button" onClick={() => setOpen(true)} aria-label={`Show ${calls.length} tool ${calls.length === 1 ? 'call' : 'calls'}: ${names}`}>
      <span class="toolcalls-indicator" aria-hidden="true">⌘</span>
      <span class="toolcalls-label">{running ? 'Using' : 'Used'} {names}</span>
      <span class="toolcalls-label-mobile" aria-hidden="true">{compactNames}{remainingNames > 0 ? `, +${remainingNames}` : ''}</span>
      <span class="toolcalls-count badge badge-ghost badge-sm">{calls.length}</span>
      <span class="toolcalls-open">Details</span>
    </button>
    <dialog class={`toolcalls-dialog modal${closing ? ' closing' : ''}`} ref={dialog} aria-labelledby="toolcalls-title" onClose={() => { setOpen(false); setClosing(false); }} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
      <div class="modal-box flex h-full max-h-full max-w-none flex-col overflow-hidden bg-base-100 p-0 text-base-content">
        <header class="toolcalls-header flex items-center justify-between gap-4 border-b border-base-300 p-5"><div><div class="eyebrow">AGENT ACTIVITY</div><h2 id="toolcalls-title">Tool calls</h2></div><button class="icon-button btn btn-ghost btn-circle btn-sm" type="button" aria-label="Close tool calls" onClick={close}>×</button></header>
        <div class="toolcalls-list">{calls.map((call, index) => <section class="toolcall-detail" key={call.id || index}>
        <div class="toolcall-heading"><strong>{call.name}</strong><span class={`toolcall-status badge ${call.status === 'failed' ? 'badge-error' : call.status === 'running' ? 'badge-info' : 'badge-success'}`}>{call.status === 'running' ? 'Running' : call.status === 'failed' ? 'Failed' : 'Succeeded'}</span></div>
        <div><strong>Arguments</strong><pre class="mockup-code max-h-60 overflow-auto whitespace-pre-wrap bg-base-200 p-3 text-base-content">{JSON.stringify(call.arguments ?? {}, null, 2)}</pre></div>
        {call.result !== undefined && <div><strong>Result</strong><pre class="mockup-code max-h-60 overflow-auto whitespace-pre-wrap bg-base-200 p-3 text-base-content">{call.result}</pre></div>}
        </section>)}</div>
      </div>
    </dialog>
  </>;
}
