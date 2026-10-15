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
    <button class="compaction-summary-pill" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span aria-hidden="true">↻</span> Earlier conversation summarized <span class="compaction-summary-open">View summary</span>
    </button>
    <dialog class={`compaction-summary-dialog${closing ? ' closing' : ''}`} ref={dialog} aria-labelledby="compaction-summary-title" onClose={() => { setOpen(false); setClosing(false); }} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
      <header class="compaction-summary-header"><div><div class="eyebrow">CONVERSATION HISTORY</div><h2 id="compaction-summary-title">Earlier conversation summary</h2></div><button class="icon-button" type="button" aria-label="Close summary" onClick={close}>×</button></header>
      <div class="compaction-summary-content">{compaction.summary}</div>
    </dialog>
  </>;
}
