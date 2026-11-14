import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// The design's font, Archivo with its width axis, bundled with the app so it looks the same
// offline (NFR-03). Only the subsets a page uses are downloaded (₱ is in latin-ext).
import '@fontsource-variable/archivo/wdth.css';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
