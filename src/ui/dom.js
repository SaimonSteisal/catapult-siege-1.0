// ============================================================================
//  ui/dom.js — tiny DOM toolkit for the HUD/screens (no framework)
// ============================================================================
export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function resChip(id, value, icon, label) {
  return `<span class="res" data-res="${id}" title="${label || ''}"><span class="ic">${icon}</span><span class="v">${value}</span></span>`;
}

let toastRoot = null;
export function toast(msg, kind = '', ms = 2400) {
  if (!toastRoot) toastRoot = qs('#toasts') || (() => { const d = el('div', { id: 'toasts' }); document.body.appendChild(d); return d; })();
  const t = el('div', { class: 'toast ' + kind, text: msg });
  toastRoot.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0'; t.style.transform = 'translateY(-6px)';
    setTimeout(() => t.remove(), 320);
  }, ms);
  while (toastRoot.children.length > 4) toastRoot.firstChild.remove();
}

export function modal({ title, body, actions = [], dismissable = true }) {
  return new Promise((resolve) => {
    const bg = el('div', { class: 'modal-bg' });
    const box = el('div', { class: 'modal' });
    if (title) box.appendChild(el('h2', { text: title }));
    if (typeof body === 'string') box.appendChild(el('div', { html: body }));
    else if (body) box.appendChild(body);
    const row = el('div', { class: 'row wrap', style: { marginTop: '14px', justifyContent: 'flex-end', gap: '8px' } });
    for (const a of actions) {
      const b = el('button', { class: 'btn ' + (a.class || ''), text: a.label, onclick: () => { close(); resolve(a.value); } });
      row.appendChild(b);
    }
    box.appendChild(row);
    bg.appendChild(box);
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) { close(); resolve(null); } };
    bg.addEventListener('click', (e) => { if (e.target === bg && dismissable) { close(); resolve(null); } });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
  });
}

export function confirmBox(title, text, okLabel = 'OK', cancelLabel = '—') {
  return modal({
    title, body: `<div style="line-height:1.5">${text}</div>`,
    actions: [{ label: cancelLabel, value: false, class: 'ghost' }, { label: okLabel, value: true, class: 'danger' }],
  });
}

/** simple hold-to-activate button (repair) */
export function holdButton(node, ms, onHold, onTick) {
  let raf = 0, t0 = 0, holding = false;
  const start = (e) => {
    e.preventDefault();
    holding = true; t0 = performance.now();
    node.classList.add('holding');
    const loop = () => {
      if (!holding) return;
      const k = Math.min(1, (performance.now() - t0) / ms);
      if (onTick) onTick(k);
      node.style.setProperty('--p', (k * 100) + '%');
      if (k >= 1) { holding = false; node.classList.remove('holding'); onHold(); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  };
  const stop = () => { holding = false; cancelAnimationFrame(raf); node.classList.remove('holding'); node.style.setProperty('--p', '0%'); if (onTick) onTick(0); };
  node.addEventListener('touchstart', start, { passive: false });
  node.addEventListener('touchend', stop);
  node.addEventListener('touchcancel', stop);
  node.addEventListener('mousedown', start);
  window.addEventListener('mouseup', stop);
  return { stop };
}

export function setUiScale(v) { document.documentElement.style.setProperty('--ui-scale', String(v)); }

export function applyA11y(settings) {
  const b = document.body;
  b.classList.toggle('reduce-motion', !!settings.reduceMotion);
  b.classList.toggle('left-handed', !!settings.leftHanded);
  for (const m of ['deuteranopia', 'protanopia', 'tritanopia']) b.classList.toggle('cb-' + m, settings.colorBlind === m);
  setUiScale(settings.uiScale || 1);
}
