import { useEffect, useRef, useState } from 'preact/hooks';

export default function ToolCalls({ calls = [] }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  const close = () => dialog.current?.close();
  if (!calls.length) return null;
  const running = calls.some(call => call.status === 'running');
  const uniqueNames = [...new Set(calls.map(call => call.name))];
  const names = uniqueNames.join(', ');
  const compactNames = uniqueNames.slice(0, 3).join(', ');
  const remainingNames = uniqueNames.length - 3;
  return <>
    <button class="btn btn-ghost btn-sm mt-2 flex min-h-7 max-w-full min-w-0 items-center gap-2 rounded-field border border-base-300 px-2 text-xs text-base-content/70 hover:text-base-content" type="button" onClick={() => setOpen(true)} aria-label={`Show ${calls.length} tool ${calls.length === 1 ? 'call' : 'calls'}: ${names}`}>
      <span class="text-primary" aria-hidden="true">⌘</span>
      <span class="hidden min-w-0 overflow-hidden text-ellipsis whitespace-nowrap sm:inline">{running ? 'Using' : 'Used'} {names}</span>
      <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap sm:hidden" aria-hidden="true">{compactNames}{remainingNames > 0 ? `, +${remainingNames}` : ''}</span>
      <span class="badge badge-ghost badge-sm flex-none">{calls.length}</span>
      <span class="flex-none text-primary">Details</span>
    </button>
    <dialog class="modal" ref={dialog} aria-labelledby="toolcalls-title" onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) close(); }}>
      <div class="modal-box flex h-[75dvh] max-h-[calc(100dvh-40px)] w-[min(560px,calc(100%-32px))] max-w-none flex-col overflow-hidden border border-base-300 bg-base-100 p-0 text-base-content shadow-2xl">
        <header class="flex items-center justify-between gap-4 border-b border-base-300 p-4 sm:p-5"><div><div class="mb-1 text-xs font-bold tracking-widest text-primary">AGENT ACTIVITY</div><h2 class="m-0 text-xl font-bold" id="toolcalls-title">Tool calls</h2></div><button class="btn btn-ghost btn-circle btn-sm" type="button" aria-label="Close tool calls" onClick={close}>×</button></header>
        <div class="min-h-0 flex-1 overflow-auto px-4 py-2 sm:px-6">{calls.map((call, index) => <section class="space-y-3 border-b border-base-300 py-3" key={call.id || index}>
        <div class="flex items-center justify-between gap-3 capitalize"><strong>{call.name}</strong><span class={`badge ${call.status === 'failed' ? 'badge-error' : call.status === 'running' ? 'badge-info' : 'badge-success'}`}>{call.status === 'running' ? 'Running' : call.status === 'failed' ? 'Failed' : 'Succeeded'}</span></div>
        <div><strong>Arguments</strong><pre class="mockup-code max-h-60 overflow-auto whitespace-pre-wrap bg-base-200 p-3 text-base-content">{JSON.stringify(call.arguments ?? {}, null, 2)}</pre></div>
        {call.result !== undefined && <div><strong>Result</strong><pre class="mockup-code max-h-60 overflow-auto whitespace-pre-wrap bg-base-200 p-3 text-base-content">{call.result}</pre></div>}
        </section>)}</div>
      </div>
    </dialog>
  </>;
}
