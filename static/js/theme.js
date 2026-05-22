/* IMSERV - Theme Manager */
(function () {
  const html = document.documentElement;
  const stored = localStorage.getItem('imserv-theme') || 'dark';
  html.setAttribute('data-theme', stored);

  window.toggleTheme = function () {
    const current = html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('imserv-theme', next);

    const icon = document.getElementById('theme-icon');
    if (icon && window.IMSERV?.setElementIcon) {
      delete icon.dataset.iconReady;
      IMSERV.setElementIcon(icon, next === 'dark' ? 'moon' : 'sun');
    } else if (icon) {
      icon.textContent = next === 'dark' ? 'Dark' : 'Light';
    }
  };
})();
