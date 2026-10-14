import { useEffect, useState } from 'preact/hooks';
import { dashboardGreeting } from './dashboard-time.js';

export default function Dashboard() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <section class="dashboard-page" aria-labelledby="dashboard-title">
    <div class="dashboard-clock">
      <h1 id="dashboard-title" tabIndex="-1">{dashboardGreeting(now)}</h1>
      <time dateTime={now.toISOString()}>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
    </div>
  </section>;
}
