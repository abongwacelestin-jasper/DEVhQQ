import './index.css';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { prefetchPath } from './routes/lazyPages';

// Start fetching the landing route's chunk now, in parallel with the session probe,
// instead of after it (the route only renders once the probe answers).
prefetchPath(window.location.pathname);

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}
