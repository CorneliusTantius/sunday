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
    <button class="skill-command-pill" type="button" onClick={() => setOpen(true)} aria-label={`Show details for skill ${skillId}`}>
      <span aria-hidden="true">✦</span> {skillId}
    </button>
    <dialog class="toolcalls-dialog skill-details-dialog" ref={dialog} aria-labelledby={titleId} onClose={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <header class="toolcalls-header"><div><div class="eyebrow">ENABLED SKILL</div><h2 id={titleId}>{skill?.name || skillId}</h2></div><button class="icon-button" type="button" aria-label="Close skill details" onClick={() => dialog.current?.close()}>×</button></header>
      <div class="skill-details-body">
        {loading && <p role="status">Loading skill details…</p>}
        {error && <p role="status" class="error-text">{error}</p>}
        {skill && <>
          {skill.description && <p class="skill-detail-description">{skill.description}</p>}
          <p class="skill-detail-source">{skill.source?.type === 'device' ? `Installed on device${skill.source.location ? ` · ${skill.source.location}` : ''}` : skill.source?.type === 'npm' ? 'Imported skill' : 'Sunday skill'}</p>
          <h3>Instructions</h3>
          <pre class="skill-detail-content">{skill.content}</pre>
        </>}
      </div>
    </dialog>
  </>;
}
