(function () {
  try {
    var cache = localStorage.getItem('hc_theme_css_cache');
    if (cache) {
      var vars = JSON.parse(cache);
      var root = document.documentElement;
      for (var key in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, key)) {
          root.style.setProperty(key, vars[key]);
        }
      }
    }
    var mode = localStorage.getItem('hc_theme_mode');
    if (mode) {
      root.dataset.themeMode = mode;
      if (mode === 'dark') {
        root.classList.add('theme-dark');
        root.classList.remove('theme-light');
      } else if (mode === 'light') {
        root.classList.add('theme-light');
        root.classList.remove('theme-dark');
      } else {
        var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (systemDark) {
          root.classList.add('theme-dark');
          root.classList.remove('theme-light');
        } else {
          root.classList.add('theme-light');
          root.classList.remove('theme-dark');
        }
      }
    }
    var density = localStorage.getItem('hc_theme_density');
    if (density) {
      root.dataset.themeDensity = density;
    }
  } catch (e) {}
})();
