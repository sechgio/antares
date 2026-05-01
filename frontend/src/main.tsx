import './i18n';
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

function restoreCachedTheme() {
  try {
    const cached = localStorage.getItem('hc_theme_css_cache');
    if (!cached) return;

    const themeVars = JSON.parse(cached) as Record<string, string>;
    Object.entries(themeVars).forEach(([name, value]) => {
      if (name.startsWith('--') && typeof value === 'string') {
        document.documentElement.style.setProperty(name, value);
      }
    });

    const mode = localStorage.getItem('hc_theme_mode');
    const density = localStorage.getItem('hc_theme_density');
    if (mode) document.documentElement.dataset.themeMode = mode;
    if (density) document.documentElement.dataset.themeDensity = density;
  } catch {}
}

restoreCachedTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
