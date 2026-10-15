const transactions = [
  { merchant: 'Grocery Market', category: 'Food & groceries', date: 'Today', amount: '-$64.28', type: 'expense' },
  { merchant: 'Monthly paycheck', category: 'Income', date: 'Yesterday', amount: '+$2,925.00', type: 'income' },
  { merchant: 'City Power', category: 'Utilities', date: 'May 18', amount: '-$82.16', type: 'expense' },
  { merchant: 'Coffee House', category: 'Dining', date: 'May 17', amount: '-$8.50', type: 'expense' },
];
const weeklySpending = [
  { day: 'Mon', height: 36 }, { day: 'Tue', height: 58 }, { day: 'Wed', height: 44 },
  { day: 'Thu', height: 76 }, { day: 'Fri', height: 52 }, { day: 'Sat', height: 92 }, { day: 'Sun', height: 30 },
];

export default function FinancialTracker() {
  return <section class="financial-page" aria-labelledby="financial-tracker-title">
    <header class="financial-header">
      <div><p class="eyebrow">PERSONAL FINANCE</p><h1 id="financial-tracker-title" tabIndex="-1">Financial tracker</h1><p class="field-note">A clear picture of your money, built around your needs.</p></div>
      <span class="financial-preview-badge">DESIGN PREVIEW · SAMPLE DATA</span>
    </header>

    <div class="financial-period"><div><span class="financial-period-label">OVERVIEW</span><strong>May 2026</strong></div><button class="secondary-button" type="button" disabled aria-label="Change month (preview only)">‹ <span>May</span> ›</button></div>
    <section class="financial-metrics" aria-label="Monthly summary (illustrative sample data)">
      <article class="financial-metric financial-balance"><span class="financial-metric-label">TOTAL BALANCE</span><strong>$16,890.42</strong><small>Across 3 accounts</small><span class="financial-trend">↗ 4.2% this month</span></article>
      <article class="financial-metric"><span class="financial-metric-label">INCOME</span><strong>$5,850.00</strong><small>Planned income this month</small></article>
      <article class="financial-metric"><span class="financial-metric-label">SPENDING</span><strong>$2,184.76</strong><small>Across 8 categories</small></article>
      <article class="financial-metric"><span class="financial-metric-label">SAVINGS RATE</span><strong>31.4%</strong><small>Of monthly income</small></article>
    </section>

    <div class="financial-dashboard-grid">
      <section class="financial-panel financial-spending" aria-labelledby="financial-spending-title">
        <div class="financial-panel-heading"><div><p class="eyebrow">SPENDING</p><h2 id="financial-spending-title">This week</h2></div><span class="financial-chart-total">$384 <small>spent</small></span></div>
        <div class="financial-chart" role="img" aria-label="Illustrative weekly spending: Monday 36, Tuesday 58, Wednesday 44, Thursday 76, Friday 52, Saturday 92, Sunday 30 dollars">{weeklySpending.map(day => <div class="financial-chart-column" key={day.day}><div class="financial-chart-track"><span style={{ height: `${day.height}%` }} /></div><small>{day.day}</small></div>)}</div>
        <p class="financial-chart-caption">Your spending at a glance. Connect accounts to see your real activity.</p>
      </section>

      <section class="financial-panel financial-accounts" aria-labelledby="financial-accounts-title">
        <div class="financial-panel-heading"><div><p class="eyebrow">ACCOUNTS</p><h2 id="financial-accounts-title">Your accounts</h2></div><button class="financial-text-button" type="button" disabled>Manage</button></div>
        <ul class="financial-account-list">
          <li><span class="financial-account-icon checking-icon" aria-hidden="true">↗</span><span class="financial-account-name"><strong>Everyday checking</strong><small>Checking · Sample Bank</small></span><strong>$4,250.18</strong></li>
          <li><span class="financial-account-icon savings-icon" aria-hidden="true">⌂</span><span class="financial-account-name"><strong>Rainy day savings</strong><small>Savings · Sample Bank</small></span><strong>$12,640.24</strong></li>
          <li><span class="financial-account-icon card-icon" aria-hidden="true">▤</span><span class="financial-account-name"><strong>Everyday card</strong><small>Credit card · Sample Card</small></span><strong class="financial-debt">−$428.60</strong></li>
        </ul>
      </section>

      <section class="financial-panel financial-transactions" aria-labelledby="financial-transactions-title">
        <div class="financial-panel-heading"><div><p class="eyebrow">RECENT ACTIVITY</p><h2 id="financial-transactions-title">Transactions</h2></div><button class="financial-text-button" type="button" disabled>View all</button></div>
        <div class="financial-transaction-list" role="list">{transactions.map(transaction => <div class="financial-transaction" role="listitem" key={transaction.merchant}><span class={`financial-transaction-icon ${transaction.type}`} aria-hidden="true">{transaction.type === 'income' ? '↓' : '↗'}</span><span class="financial-transaction-name"><strong>{transaction.merchant}</strong><small>{transaction.category} · {transaction.date}</small></span><strong class={transaction.type}>{transaction.amount}</strong></div>)}</div>
      </section>

      <aside class="financial-preview-callout"><span class="financial-lock-icon" aria-hidden="true">◇</span><div><strong>Your money, on your terms.</strong><p>Sunday’s personal tracker is a future project. This concept uses sample data only—no accounts are linked, and no financial information is collected.</p></div></aside>
    </div>
  </section>;
}
