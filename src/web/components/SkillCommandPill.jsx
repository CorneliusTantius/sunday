import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { request } from '../api.js';

export default function SkillCommandPill({ skillId }) {
  const [open, setOpen] = useState(false);
  const [skill, setSkill] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const titleId = `skill-detail-title-${useId()}`;

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      request('/api/skills', { signal: abort.signal }),
      request('/api/skills/device', { signal: abort.signal }),
    ]).then(([managed, device]) => {
      if (abort.signal.aborted) return;
      const found = [...(managed.skills || []), ...(device.skills || [])].find(item => item.id === skillId);
      setSkill(found || null);
      if (!found) setError('This skill is no longer available.');
    }).catch(reason => {
      if (!abort.signal.aborted) setError(reason.message || 'Could not load skill details.');
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [open, skillId]);

  return <>
    <button class="badge badge-soft badge-primary mb-2 inline-flex max-w-full cursor-pointer gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" type="button" onClick={() => setOpen(true)} aria-label={`Show details for skill ${skillId}`}>
      <span aria-hidden="true">✦</span> {skillId}
    </button>
    <dialog class="modal" ref={dialog} aria-labelledby={titleId} onClose={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div class="modal-box flex max-h-[75dvh] w-[min(680px,calc(100%-32px))] max-w-none flex-col overflow-hidden border border-base-300 bg-base-100 p-0 text-base-content shadow-2xl">
        <header class="flex items-center justify-between gap-4 border-b border-base-300 p-5"><div><div class="mb-1 text-xs font-bold tracking-widest text-primary">ENABLED SKILL</div><h2 class="m-0 text-xl font-bold" id={titleId}>{skill?.name || skillId}</h2></div><button class="btn btn-ghost btn-circle btn-sm" type="button" aria-label="Close skill details" onClick={() => dialog.current?.close()}>×</button></header>
        <div class="min-h-0 flex-1 overflow-auto p-4 sm:px-6 sm:pb-6">
        {loading && <p role="status">Loading skill details…</p>}
        {error && <p role="status" class="text-error">{error}</p>}
        {skill && <>
          {skill.description && <p class="mb-2 text-base-content">{skill.description}</p>}
          <p class="text-xs text-base-content/70">{skill.source?.type === 'device' ? `Installed on device${skill.source.location ? ` · ${skill.source.location}` : ''}` : skill.source?.type === 'npm' ? 'Imported skill' : 'Sunday skill'}</p>
          <h3 class="mb-2 mt-5 text-base font-bold">Instructions</h3>
          <pre class="mockup-code m-0 max-h-[48dvh] overflow-auto whitespace-pre-wrap rounded-field border border-base-300 bg-base-200 p-3 text-[13px] leading-relaxed text-base-content">{skill.content}</pre>
        </>}
        </div>
      </div>
    </dialog>
  </>;
}
