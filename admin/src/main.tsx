import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { initTheme } from './window/settings';

import './styles.css';

initTheme();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Editlet admin: #root element is missing');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
