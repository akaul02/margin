import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/inter';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import HostedApp from './Auth';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{import.meta.env.VITE_MARGIN_MODE === 'hosted' ? <HostedApp /> : <App />}</React.StrictMode>,
);
