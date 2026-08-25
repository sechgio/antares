import './i18n';
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { restoreCachedTheme } from './utils/themeApplier';
import { initRUM } from './utils/rum';

restoreCachedTheme();
// RUM: sampled 10% web-vitals → backend stderr (budget-safe dynamic import)
initRUM();

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Use StrictMode only in development to avoid double renders in production
const isDev = import.meta.env.DEV;

root.render(
  isDev ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ) : (
    <App />
  ),
);
