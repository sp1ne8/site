let listener = () => {};
export function navigate(path, { replace = false } = {}) {
  const target = new URL(path, location.origin);
  if (target.origin !== location.origin) throw new Error('Переход на внешний адрес запрещён.');
  history[replace ? 'replaceState' : 'pushState']({}, '', `${target.pathname}${target.search}${target.hash}`);
  listener();
}
export function startRouter(onChange) {
  listener = onChange;
  window.addEventListener('popstate', listener);
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[data-link]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(anchor.href);
  });
  listener();
}
