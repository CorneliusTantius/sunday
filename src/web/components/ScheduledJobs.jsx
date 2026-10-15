export default function ScheduledJobs() {
  return <section class="scheduled-jobs-page" aria-labelledby="scheduled-job-title">
    <header class="scheduled-job-header">
      <div>
        <p class="eyebrow">AUTOMATION</p>
        <h1 id="scheduled-job-title" tabIndex="-1">Scheduled job</h1>
        <p class="field-note">Set up a recurring task and choose which agent should take care of it.</p>
      </div>
      <span class="scheduled-job-preview-badge">UI PREVIEW</span>
    </header>

    <div class="scheduled-job-layout">
      <form class="scheduled-job-builder" onSubmit={event => event.preventDefault()}>
        <div class="scheduled-job-section-heading">
          <div><p class="eyebrow">NEW AUTOMATION</p><h2>Build a scheduled job</h2></div>
          <span class="scheduled-job-step">01 / 01</span>
        </div>
        <div class="scheduled-job-fields">
          <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-name">Job name</label>
            <input class="text-input" id="scheduled-job-name" type="text" defaultValue="Weekly repository review" />
          </div>
          <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-agent">Run with agent</label>
            <select class="select" id="scheduled-job-agent" defaultValue="">
              <option value="" disabled>Choose an agent</option>
              <option>Code reviewer</option>
              <option>Research assistant</option>
              <option>Project planner</option>
            </select>
          </div>
          <div class="scheduled-job-field scheduled-job-field-wide">
            <label class="field-label" for="scheduled-job-task">What should the agent do?</label>
            <textarea class="text-input scheduled-job-task" id="scheduled-job-task" rows="5" placeholder="Describe the recurring task for your agent…">Review recent changes in the connected repositories. Summarize important updates, flag possible issues, and list anything that needs my attention.</textarea>
            <p class="field-note">The agent will receive this task each time the schedule runs.</p>
          </div>
          <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-frequency">Repeat</label>
            <select class="select" id="scheduled-job-frequency" defaultValue="Weekly">
              <option>Daily</option><option>Weekly</option><option>Monthly</option>
            </select>
          </div>
          <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-day">On</label>
            <select class="select" id="scheduled-job-day" defaultValue="Monday">
              <option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option><option>Saturday</option><option>Sunday</option>
            </select>
          </div>
          <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-time">At</label>
            <input class="text-input" id="scheduled-job-time" type="time" defaultValue="09:00" />
          </div>
          <div class="scheduled-job-field">
            <label class="field-label" for="scheduled-job-timezone">Timezone</label>
            <select class="select" id="scheduled-job-timezone" defaultValue="local">
              <option value="local">Local time</option><option>UTC</option><option>America/Los_Angeles</option><option>America/New_York</option><option>Europe/London</option>
            </select>
          </div>
          <label class="scheduled-job-checkbox"><input type="checkbox" checked /> <span>Wait until the agent is idle before running</span></label>
        </div>
        <div class="scheduled-job-actions">
          <a class="secondary-button scheduled-job-cancel" href="#chat">Cancel</a>
          <button class="primary-button" type="button" disabled title="Scheduling will be available in a future update">Create scheduled job</button>
        </div>
        <p class="scheduled-job-notice">This is a design preview. Scheduled jobs are not active yet.</p>
      </form>

      <aside class="scheduled-job-aside" aria-label="Schedule preview">
        <article class="scheduled-job-summary">
          <div class="scheduled-job-summary-top"><span class="scheduled-job-calendar-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M8 3v3m8-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg></span><span class="scheduled-job-draft">DRAFT</span></div>
          <p class="eyebrow">SCHEDULE PREVIEW</p>
          <h2>Weekly repository review</h2>
          <p class="scheduled-job-agent-preview">Assigned to <strong>Code reviewer</strong></p>
          <div class="scheduled-job-next-run"><span>Repeats every</span><strong>Monday at 9:00 AM</strong><small>Using your local timezone</small></div>
          <div class="scheduled-job-task-preview"><span>AGENT TASK</span><p>Review repository updates and flag anything that needs attention.</p></div>
        </article>
        <div class="scheduled-job-empty-state"><span class="scheduled-job-clock-icon" aria-hidden="true">◷</span><div><strong>Your schedule is ready to configure</strong><p>Once scheduling is available, saved jobs and their next run times will appear here.</p></div></div>
      </aside>
    </div>
  </section>;
}
