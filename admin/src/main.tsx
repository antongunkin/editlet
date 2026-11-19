import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { trackModality } from './window/modality';
import { initTheme } from './window/settings';

import './app.css';

initTheme();
trackModality();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Editlet admin: #root element is missing');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
