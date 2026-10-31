import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// The design's fonts, bundled with the app so it looks the same offline (NFR-03).
import '@fontsource/caprasimo/latin-400.css';
import '@fontsource/figtree/latin-400.css';
import '@fontsource/figtree/latin-600.css';
import '@fontsource/figtree/latin-700.css';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
