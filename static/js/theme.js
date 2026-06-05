/* ABC - Theme Manager */
(function () {
  const html = document.documentElement;
  const themeVersion = 'abc-json-theme-v1';
  if (localStorage.getItem('abc-theme-version') !== themeVersion) {
    localStorage.setItem('abc-theme', 'light');
    localStorage.setItem('abc-theme-version', themeVersion);
  }
  const stored = localStorage.getItem('abc-theme') || 'light';
  html.setAttribute('data-theme', stored);

  window.toggleTheme = function () {
    const current = html.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('abc-theme', next);
    window.ABC?.applyChartTheme?.(next);
    window.dispatchEvent(new CustomEvent('abc:themechange', { detail: { theme: next } }));

    const icon = document.getElementById('theme-icon');
    if (icon && window.ABC?.setElementIcon) {
      delete icon.dataset.iconReady;
      ABC.setElementIcon(icon, next === 'dark' ? 'moon' : 'sun');
    } else if (icon) {
      icon.textContent = next === 'dark' ? 'Dark' : 'Light';
    }
  };
})();
