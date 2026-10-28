export default function Socials() {
  return <section class="socials-page" aria-labelledby="socials-title">
    <header class="socials-header">
      <div><p class="eyebrow">CONNECTED APPS</p><h1 id="socials-title" tabIndex="-1">Socials</h1><p class="field-note">A shared space for conversations, updates, and the services your agents can help with.</p></div>
      <span class="socials-preview-badge">DESIGN PREVIEW</span>
    </header>

    <div class="socials-overview">
      <article class="card card-bordered bg-base-200 p-6">
        <p class="eyebrow">YOUR COMMUNICATIONS, TOGETHER</p>
        <h2>Keep conversations close to the work.</h2>
        <p>Bring the places you already talk into Sunday. Find important messages, catch up on updates, and ask an agent to help draft a reply or summarize a thread.</p>
        <ul class="socials-benefits">
          <li><span>01</span> One place for your messages</li>
          <li><span>02</span> Agent assistance when you want it</li>
          <li><span>03</span> You choose what to connect</li>
        </ul>
      </article>

      <aside class="card card-bordered bg-base-200 p-5" aria-label="Example unified inbox preview">
        <div class="socials-inbox-top"><div><p class="eyebrow">UNIFIED INBOX</p><strong>A quick look</strong></div><span class="socials-sample-tag">SAMPLE</span></div>
        <article class="socials-message-preview"><span class="socials-source-mark slack-mark" aria-hidden="true">#</span><div><div class="socials-message-meta"><strong>Slack · #product</strong><time>12m</time></div><p>Launch review is ready for your feedback.</p><small>Maya Chen</small></div></article>
        <article class="socials-message-preview"><span class="socials-source-mark gmail-mark" aria-hidden="true">M</span><div><div class="socials-message-meta"><strong>Gmail · Inbox</strong><time>34m</time></div><p>Friday’s sprint summary</p><small>Alex Morgan</small></div></article>
        <p class="socials-preview-footnote">Example messages only — nothing is connected.</p>
      </aside>
    </div>

    <section class="socials-integrations" aria-labelledby="socials-integrations-title">
      <div class="socials-section-heading"><div><p class="eyebrow">PLANNED INTEGRATIONS</p><h2 id="socials-integrations-title">Bring your tools to Sunday</h2></div><p>No platforms are connected yet.</p></div>
      <div class="socials-connector-grid">
        <article class="card card-bordered bg-base-200 p-4"><div class="socials-connector-brand"><span class="socials-source-mark slack-mark" aria-hidden="true">#</span><div><h3>Slack</h3><p>Channels and direct messages</p></div><span class="socials-coming-soon">PLANNED</span></div><div class="socials-connector-footer"><span>Connect a workspace to catch up with an agent.</span><button class="btn btn-ghost" type="button" disabled>Coming soon</button></div></article>
        <article class="card card-bordered bg-base-200 p-4"><div class="socials-connector-brand"><span class="socials-source-mark gmail-mark" aria-hidden="true">M</span><div><h3>Gmail</h3><p>Email and important threads</p></div><span class="socials-coming-soon">PLANNED</span></div><div class="socials-connector-footer"><span>Bring your inbox into your daily workflow.</span><button class="btn btn-ghost" type="button" disabled>Coming soon</button></div></article>
      </div>
    </section>
    <p class="socials-preview-note">This page is a design preview. Connections, messages, and agent actions are not available yet.</p>
  </section>;
}
