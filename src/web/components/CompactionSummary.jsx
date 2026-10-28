import { useEffect, useRef, useState } from 'preact/hooks';

export default function CompactionSummary({ compaction }) {
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

  if (!compaction?.summary) return null;
  const close = () => setClosing(true);
  return <>
    <button class="compaction-summary-pill btn btn-ghost btn-sm text-base-content/70 hover:text-base-content" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span aria-hidden="true">↻</span> Earlier conversation summarized <span class="compaction-summary-open">View summary</span>
    </button>
    <dialog class={`compaction-summary-dialog modal${closing ? ' closing' : ''}`} ref={dialog} aria-labelledby="compaction-summary-title" onClose={() => { setOpen(false); setClosing(false); }} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
      <div class="modal-box flex max-h-[75dvh] max-w-3xl flex-col overflow-hidden bg-base-100 p-0 text-base-content">
        <header class="compaction-summary-header flex items-center justify-between gap-4 border-b border-base-300 p-5"><div><div class="eyebrow">CONVERSATION HISTORY</div><h2 id="compaction-summary-title">Earlier conversation summary</h2></div><button class="icon-button btn btn-ghost btn-circle btn-sm" type="button" aria-label="Close summary" onClick={close}>×</button></header>
        <div class="compaction-summary-content min-h-0 flex-1 overflow-auto whitespace-pre-wrap">{compaction.summary}</div>
      </div>
    </dialog>
  </>;
}
