export default function Socials() {
  return <section class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6" aria-labelledby="socials-title">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><p class="text-xs font-bold tracking-widest text-primary">CONNECTED APPS</p><h1 id="socials-title" tabIndex="-1">Socials</h1><p class="mt-2 text-sm leading-relaxed text-base-content/70">A shared space for conversations, updates, and the services your agents can help with.</p></div>
      <span class="badge badge-primary badge-outline">DESIGN PREVIEW</span>
    </header>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,.8fr)]">
      <article class="card card-bordered bg-base-200 p-6">
        <p class="text-xs font-bold tracking-widest text-primary">YOUR COMMUNICATIONS, TOGETHER</p>
        <h2>Keep conversations close to the work.</h2>
        <p>Bring the places you already talk into Sunday. Find important messages, catch up on updates, and ask an agent to help draft a reply or summarize a thread.</p>
        <ul class="mt-5 grid list-none gap-3 p-0 sm:grid-cols-3">
          <li><span>01</span> One place for your messages</li>
          <li><span>02</span> Agent assistance when you want it</li>
          <li><span>03</span> You choose what to connect</li>
        </ul>
      </article>

      <aside class="card card-bordered bg-base-200 p-5" aria-label="Example unified inbox preview">
        <div class="mb-3 flex items-center justify-between gap-3"><div><p class="text-xs font-bold tracking-widest text-primary">UNIFIED INBOX</p><strong>A quick look</strong></div><span class="badge badge-outline badge-sm">SAMPLE</span></div>
        <article class="flex items-start gap-3 border-t border-base-300 py-3"><span class="grid size-9 shrink-0 place-items-center rounded-box border border-base-300 text-lg font-bold text-primary" aria-hidden="true">#</span><div><div class="flex items-center justify-between gap-2"><strong>Slack · #product</strong><time>12m</time></div><p>Launch review is ready for your feedback.</p><small>Maya Chen</small></div></article>
        <article class="flex items-start gap-3 border-t border-base-300 py-3"><span class="grid size-9 shrink-0 place-items-center rounded-box border border-base-300 text-lg font-bold text-error" aria-hidden="true">M</span><div><div class="flex items-center justify-between gap-2"><strong>Gmail · Inbox</strong><time>34m</time></div><p>Friday’s sprint summary</p><small>Alex Morgan</small></div></article>
        <p class="mt-2 text-xs text-base-content/70">Example messages only — nothing is connected.</p>
      </aside>
    </div>

    <section class="mt-6" aria-labelledby="socials-integrations-title">
      <div class="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p class="text-xs font-bold tracking-widest text-primary">PLANNED INTEGRATIONS</p><h2 id="socials-integrations-title">Bring your tools to Sunday</h2></div><p>No platforms are connected yet.</p></div>
      <div class="grid gap-3 md:grid-cols-2">
        <article class="card card-bordered bg-base-200 p-4"><div class="flex min-w-0 items-center gap-3"><span class="grid size-9 shrink-0 place-items-center rounded-box border border-base-300 text-lg font-bold text-primary" aria-hidden="true">#</span><div><h3>Slack</h3><p>Channels and direct messages</p></div><span class="badge badge-outline badge-sm">PLANNED</span></div><div class="mt-4 flex flex-col justify-between gap-3 border-t border-base-300 pt-3 sm:flex-row sm:items-center"><span>Connect a workspace to catch up with an agent.</span><button class="btn btn-ghost" type="button" disabled>Coming soon</button></div></article>
        <article class="card card-bordered bg-base-200 p-4"><div class="flex min-w-0 items-center gap-3"><span class="grid size-9 shrink-0 place-items-center rounded-box border border-base-300 text-lg font-bold text-error" aria-hidden="true">M</span><div><h3>Gmail</h3><p>Email and important threads</p></div><span class="badge badge-outline badge-sm">PLANNED</span></div><div class="mt-4 flex flex-col justify-between gap-3 border-t border-base-300 pt-3 sm:flex-row sm:items-center"><span>Bring your inbox into your daily workflow.</span><button class="btn btn-ghost" type="button" disabled>Coming soon</button></div></article>
      </div>
    </section>
    <p class="mt-4 text-right text-sm text-base-content/70">This page is a design preview. Connections, messages, and agent actions are not available yet.</p>
  </section>;
}
