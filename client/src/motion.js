const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const easing = 'cubic-bezier(.22, 1, .36, 1)';
const animations = new Set();
const dropdowns = new WeakMap();
let revealObserver;

function animate(element, frames, duration) {
  const animation = element.animate(frames, { duration, easing, fill: 'both' });
  animations.add(animation);
  animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
  return animation;
}

reducedMotion.addEventListener('change', () => {
  if (!reducedMotion.matches) return;
  animations.forEach((animation) => { try { animation.finish(); } catch { animation.cancel(); } });
  document.querySelectorAll('.scroll-reveal').forEach((element) => element.classList.remove('scroll-reveal'));
});

export function scrollToSection(section) {
  if (section) revealObserver?.unobserve(section);
  section?.classList.remove('scroll-reveal');
  if (section) section.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
  else window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
}

export function closeAccountDropdown(dropdown) {
  dropdowns.get(dropdown)?.setOpen(false);
}

export function bindAccountDropdown(dropdown) {
  if (!dropdown) return;
  const trigger = dropdown.querySelector('summary');
  const panel = dropdown.querySelector('.account-menu');
  let desired = dropdown.open;
  let animation;
  let timer;
  function setOpen(open) {
    clearTimeout(timer);
    if (desired === open) return;
    desired = open;
    const wasClosed = !dropdown.open;
    if (open) dropdown.open = true;
    const style = getComputedStyle(panel);
    const from = { opacity: wasClosed ? 0 : style.opacity, transform: wasClosed ? 'translateY(-7px)' : style.transform };
    animation?.cancel();
    panel.style.pointerEvents = open ? '' : 'none';
    if (reducedMotion.matches || !panel.animate) {
      dropdown.open = open;
      panel.style.pointerEvents = '';
      return;
    }
    const current = animate(panel, [from, { opacity: open ? 1 : 0, transform: open ? 'translateY(0)' : 'translateY(-5px)' }], open ? 300 : 220);
    animation = current;
    current.finished.then(() => {
      if (animation !== current) return;
      dropdown.open = desired;
      panel.style.pointerEvents = '';
      current.cancel();
      animation = null;
    }, () => {});
  }
  dropdowns.set(dropdown, { setOpen });
  trigger.addEventListener('click', (event) => { event.preventDefault(); setOpen(!desired); });
  dropdown.addEventListener('pointerenter', (event) => {
    clearTimeout(timer);
    if (event.pointerType === 'mouse' && matchMedia('(hover: hover)').matches) timer = setTimeout(() => setOpen(true), 80);
  });
  dropdown.addEventListener('pointerleave', () => {
    clearTimeout(timer);
    if (!dropdown.contains(document.activeElement)) timer = setTimeout(() => setOpen(false), 140);
  });
  dropdown.addEventListener('focusout', (event) => {
    if (!dropdown.contains(event.relatedTarget)) setOpen(false);
  });
}

function bindFaqMotion(root) {
  root.querySelectorAll('.faq-item').forEach((item) => {
    const summary = item.querySelector('summary');
    const answer = item.querySelector('p');
    let expanded = item.open;
    let animation;
    summary.addEventListener('click', (event) => {
      event.preventDefault();
      expanded = !expanded;
      const startHeight = item.getBoundingClientRect().height;
      animation?.cancel();
      if (reducedMotion.matches || !item.animate) { item.open = expanded; item.style.overflow = ''; return; }
      item.open = true;
      const height = summary.getBoundingClientRect().height + (expanded ? answer.getBoundingClientRect().height : 0) + 1;
      item.style.overflow = 'hidden';
      const current = animate(item, [{ height: `${startHeight}px` }, { height: `${height}px` }], expanded ? 360 : 280);
      animation = current;
      current.finished.then(() => {
        if (animation !== current) return;
        item.open = expanded;
        item.style.overflow = '';
        current.cancel();
        animation = null;
      }, () => {});
    });
  });
}

export function bindPageMotion(root) {
  revealObserver?.disconnect();
  bindFaqMotion(root);
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
  revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(({ isIntersecting, target }) => {
      if (!isIntersecting) return;
      target.classList.remove('scroll-reveal');
      observer.unobserve(target);
      if (!reducedMotion.matches && target.animate) {
        const animation = animate(target, [{ opacity: 0, translate: '0 14px' }, { opacity: 1, translate: '0 0' }], 620);
        animation.finished.then(() => animation.cancel(), () => {});
      }
    });
  }, { threshold: .08, rootMargin: '0px 0px -24px 0px' });
  root.querySelectorAll('.home-page > section:not(.hydra-hero), .catalog-page .catalog-product, .product-page > section, .workspace-section').forEach((element) => {
    if (element.getBoundingClientRect().top < innerHeight) return;
    element.classList.add('scroll-reveal');
    revealObserver.observe(element);
  });
}
