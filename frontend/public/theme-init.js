(function () {
  try {
    var root = document.documentElement;
    var cache = localStorage.getItem('hc_theme_css_cache');
    if (cache) {
      var vars = JSON.parse(cache);
      for (var key in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, key)) {
          root.style.setProperty(key, vars[key]);
        }
      }
    }
    var mode = localStorage.getItem('hc_theme_mode');
    if (mode) {
      root.dataset.themeMode = mode;
      var isLightMode = mode === 'light';
      if (mode === 'dark') {
        root.classList.add('theme-dark');
        root.classList.remove('theme-light');
      } else if (mode === 'light') {
        root.classList.add('theme-light');
        root.classList.remove('theme-dark');
      } else {
        var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        isLightMode = !systemDark;
        if (systemDark) {
          root.classList.add('theme-dark');
          root.classList.remove('theme-light');
        } else {
          root.classList.add('theme-light');
          root.classList.remove('theme-dark');
        }
      }
      root.dataset.theme = isLightMode ? 'light' : 'dark';
    }
    var density = localStorage.getItem('hc_theme_density');
    if (density) {
      root.dataset.themeDensity = density;
    }
  } catch (e) {}
})();
