export default function Skills() {
  return <section class="context-page skills-page" aria-labelledby="skills-title">
    <header class="context-header">
      <div>
        <p class="eyebrow">CONTEXT MODE</p>
        <h1 id="skills-title" tabIndex="-1">Skills</h1>
        <p>Reusable instructions that help Sunday agents handle a kind of task consistently.</p>
      </div>
      <div class="context-header-actions">
        <span class="skills-blueprint-badge">Blueprint</span>
        <button class="context-button" type="button" disabled title="Skill creation is not available in this preview">＋ Create skill</button>
      </div>
    </header>

    <nav class="context-section-tabs" aria-label="Context sections">
      <a href="#context">Memory</a>
      <a href="#context/skills" aria-current="page">Skills</a>
    </nav>

    <section class="skills-intro context-panel" aria-labelledby="skills-intro-title">
      <div>
        <p class="eyebrow">PROJECT-MANAGED</p>
        <h2 id="skills-intro-title">A shared library of agent know-how</h2>
        <p>Skills are reusable guidance, not executable tools. Sunday can manage its own skills, and a future version could support reviewed imports from npm.</p>
      </div>
      <div class="skills-flow" aria-label="Planned skill lifecycle">
        <span><b>1</b> Create or import</span><span aria-hidden="true">→</span>
        <span><b>2</b> Review instructions</span><span aria-hidden="true">→</span>
        <span><b>3</b> Enable for agents</span>
      </div>
    </section>

    <div class="skills-library-heading">
      <div><h2>Skill library</h2><p>A preview of the information and controls planned for each skill.</p></div>
      <span class="skills-count">0 installed</span>
    </div>

    <section class="skills-empty context-panel" aria-labelledby="skills-empty-title">
      <div class="skills-empty-icon" aria-hidden="true">✦</div>
      <h2 id="skills-empty-title">Your skills will live here</h2>
      <p>When skill management is implemented, this space can show each skill’s description, source, and which agents can use it.</p>
      <div class="skills-preview-grid">
        <article class="skills-preview-card">
          <span class="skills-card-kind">EXAMPLE SKILL</span>
          <h3>Code review</h3>
          <p>Review a change for correctness, edge cases, and clear test coverage.</p>
          <small>Project skill · enabled per agent</small>
        </article>
        <article class="skills-preview-card skills-preview-card-muted">
          <span class="skills-card-kind">FUTURE SOURCE</span>
          <h3>npm package</h3>
          <p>Import a published skill, inspect its instructions, then choose whether to enable it.</p>
          <small>Not available yet</small>
        </article>
      </div>
      <p class="skills-preview-note">Examples above are illustrative only. No skills are installed or loaded by this page.</p>
    </section>
  </section>;
}
