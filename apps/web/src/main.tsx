import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startConnectionCheck } from './lib/connection';
// The design's font, Archivo with its width axis, bundled with the app so it looks the same
// offline (NFR-03). Only the subsets a page uses are downloaded (₱ is in latin-ext).
import '@fontsource-variable/archivo/wdth.css';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// Online or offline for real, not just "connected to Wi-Fi" (lib/connection.ts).
startConnectionCheck();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
