import { useEffect, useRef, useState } from 'preact/hooks';

export default function CompactionSummary({ compaction }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef(null);

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  if (!compaction?.summary) return null;
  const close = () => dialog.current?.close();
  return <>
    <button class="btn btn-ghost btn-sm mb-1 inline-flex max-w-full items-center self-start gap-2 rounded-full border border-base-300 bg-base-200/70 px-3 py-1.5 text-xs text-base-content/70 hover:border-primary hover:text-base-content" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span aria-hidden="true">↻</span> Session compacted <span class="whitespace-nowrap font-semibold text-primary">View summary</span>
    </button>
    <dialog class="modal" ref={dialog} aria-labelledby="compaction-summary-title" onClose={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) close(); }}>
      <div class="modal-box flex max-h-[75dvh] w-[min(640px,calc(100%-32px))] max-w-none flex-col overflow-hidden border border-base-300 bg-base-100 p-0 text-base-content shadow-2xl">
        <header class="flex items-center justify-between gap-4 border-b border-base-300 p-4 sm:p-5"><div><div class="mb-1 text-xs font-bold tracking-widest text-primary">CONVERSATION HISTORY</div><h2 class="m-0 text-xl font-bold" id="compaction-summary-title">Earlier conversation summary</h2></div><button class="btn btn-ghost btn-circle btn-sm" type="button" aria-label="Close summary" onClick={close}>×</button></header>
        <div class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 text-sm leading-relaxed text-base-content [overflow-wrap:anywhere] sm:p-6">{compaction.summary}</div>
      </div>
    </dialog>
  </>;
}
