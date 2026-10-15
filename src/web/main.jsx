import { render } from 'preact';
import App from './App.jsx';
import './style.css';

render(<App />, document.getElementById('app'));

// Keep development free of service workers; installation requires HTTPS or localhost.
if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('Sunday installation support could not start:', error);
    });
  });
}
