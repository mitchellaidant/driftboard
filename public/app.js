/* global marked, DOMPurify */

// ---------- icons ----------
const ICON = {
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4" stroke-linecap="round"/></svg>',
  clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 6"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  grip: '<svg viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>',
};
const BINDER_COLORS = ['#646d72', '#e76125', '#d21419', '#b8860b', '#2e8b57', '#3b7dd8', '#8e44ad'];
const GRID = 26;

// ---------- state ----------
let wsList = [];
let activeWorkspaceId = null;
let ws = null;
let panX = 0, panY = 0, zoom = 1;
let currentCardId = null;
let descEditing = false;
let pendingPopId = null;
let theme = localStorage.getItem('tt-theme') || 'light';
let snapEnabled = localStorage.getItem('tt-snap') !== 'off';
const editingAtts = new Set();

const $ = (id) => document.getElementById(id);
const snap = (v) => (snapEnabled ? Math.round(v / GRID) * GRID : v);

// ---------- api ----------
async function api(method, url, body, isForm) {
  const opts = { method };
  if (isForm) opts.body = body;
  else if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'request failed');
  }
  return res.status === 204 ? null : res.json();
}

// ---------- utils ----------
const currentCard = () => ws && ws.cards.find((c) => c.id === currentCardId);
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function toastAction(msg, label, fn) {
  const el = document.createElement('div');
  el.className = 'toast';
  const s = document.createElement('span'); s.textContent = msg; el.appendChild(s);
  const b = document.createElement('button'); b.textContent = label;
  b.addEventListener('click', () => { el.remove(); fn(); }); el.appendChild(b);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}
function shortDate(iso) {
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function renderMarkdown(text) { return DOMPurify.sanitize(marked.parse(text || '', { breaks: true })); }
function stripMd(s) {
  return String(s || '')
    .replace(/!\[.*?\]\(.*?\)/g, '')            // images
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')          // links -> text
    .replace(/[#>*_`~-]+/g, ' ')                 // markdown punctuation
    .replace(/\s+/g, ' ')
    .trim();
}
const fileUrl = (a) => `/uploads/${a.filename}`;
const looksLikeImage = (u) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|#|$)/i.test(u);
const looksLikeVideo = (u) => /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(u);
const clampZoom = (z) => Math.min(2.5, Math.max(0.25, z));

// ---------- theme / snap ----------
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('tt-theme', t);
  $('theme-toggle').innerHTML = t === 'dark' ? ICON.sun : ICON.moon;
}
$('theme-toggle').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; applyTheme(theme); });
applyTheme(theme);

function updateSnapBtn() { $('snap-toggle').classList.toggle('active', snapEnabled); }
$('snap-toggle').addEventListener('click', () => {
  snapEnabled = !snapEnabled;
  localStorage.setItem('tt-snap', snapEnabled ? 'on' : 'off');
  updateSnapBtn();
});
updateSnapBtn();

// ---------- canvas transform ----------
const viewport = $('viewport');
const world = $('world');

function updateTransform() {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  viewport.style.backgroundPosition = `${panX}px ${panY}px`;
  viewport.style.backgroundSize = `${GRID * zoom}px ${GRID * zoom}px`;
  $('zoom-reset').textContent = `${Math.round(zoom * 100)}%`;
}
function screenToWorld(clientX, clientY) {
  const r = viewport.getBoundingClientRect();
  return { x: (clientX - r.left - panX) / zoom, y: (clientY - r.top - panY) / zoom };
}
function viewCenterWorld() {
  const r = viewport.getBoundingClientRect();
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}
function zoomAt(clientX, clientY, newZoom) {
  const r = viewport.getBoundingClientRect();
  const before = screenToWorld(clientX, clientY);
  zoom = clampZoom(newZoom);
  panX = (clientX - r.left) - before.x * zoom;
  panY = (clientY - r.top) - before.y * zoom;
  updateTransform(); saveView();
}
let viewTimer;
function saveView() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => { if (ws) api('PATCH', `/api/workspaces/${ws.id}`, { view: { panX, panY, zoom } }).catch(() => {}); }, 400);
}

// ---------- load / render ----------
async function loadState() {
  const s = await api('GET', '/api/state');
  wsList = s.workspaces; activeWorkspaceId = s.activeWorkspaceId;
  renderTabs();
  await loadWorkspace(activeWorkspaceId);
}
async function loadWorkspace(id) {
  ws = await api('GET', `/api/workspaces/${id}`);
  activeWorkspaceId = id;
  panX = ws.view?.panX || 0; panY = ws.view?.panY || 0; zoom = clampZoom(ws.view?.zoom || 1);
  updateTransform(); renderWorkspace(); renderTabs();
}
async function reloadWorkspace() {
  ws = await api('GET', `/api/workspaces/${activeWorkspaceId}`);
  renderWorkspace();
}

function renderTabs() {
  const nav = $('workspaces');
  nav.innerHTML = '';
  wsList.forEach((w) => {
    const tab = document.createElement('div');
    tab.className = 'ws-tab' + (w.id === activeWorkspaceId ? ' active' : '');
    tab.setAttribute('role', 'button');
    const name = document.createElement('span'); name.className = 'ws-name'; name.textContent = w.name;
    tab.appendChild(name);
    if (w.id === activeWorkspaceId) {
      const dot = document.createElement('span'); dot.className = 'ws-menu-dot'; dot.textContent = '⋯';
      dot.addEventListener('click', (e) => { e.stopPropagation(); openWorkspaceMenu(e, w); });
      tab.appendChild(dot);
    }
    tab.addEventListener('click', () => { if (w.id !== activeWorkspaceId) switchWorkspace(w.id); });
    name.addEventListener('dblclick', (e) => { e.stopPropagation(); startTabRename(w, name); });
    nav.appendChild(tab);
  });
}

function startTabRename(w, nameSpan) {
  const input = document.createElement('input');
  input.className = 'ws-name-edit'; input.value = w.name;
  nameSpan.replaceWith(input); input.focus(); input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return; done = true;
    if (save) {
      const name = input.value.trim();
      if (name && name !== w.name) {
        try { await api('PATCH', `/api/workspaces/${w.id}`, { name }); w.name = name; const s = await api('GET', '/api/state'); wsList = s.workspaces; }
        catch (e) { toast(e.message); }
      }
    }
    renderTabs();
  };
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') commit(false);
  });
}

function renderWorkspace() {
  world.innerHTML = '';
  const origin = document.createElement('div');
  origin.className = 'origin-marker';
  origin.innerHTML = '<div class="cross"></div><div class="origin-label">0, 0</div>';
  world.appendChild(origin);
  ws.binders.forEach((b, i) => world.appendChild(makeBinderEl(b, i)));
  ws.cards.filter((c) => !c.binderId).forEach((c) => world.appendChild(makeCardEl(c, true)));
  pendingPopId = null;
}

function cardBadges(card) {
  const atts = card.attachments || [];
  const badges = atts.length ? `<div class="card-badges"><span class="badge">${ICON.clip} ${atts.length}</span></div>` : '';
  const thumbs = atts.filter((a) => a.type === 'image').slice(0, 4).map((a) => `<img src="${fileUrl(a)}" alt="">`).join('');
  return `${badges}${thumbs ? `<div class="card-thumbs">${thumbs}</div>` : ''}`;
}

function makeCardEl(card, free) {
  const el = document.createElement('div');
  el.className = 'card' + (free ? ' free' : '') + (card.id === pendingPopId ? ' pop-in' : '');
  el.dataset.id = card.id;
  if (free) { el.style.left = card.x + 'px'; el.style.top = card.y + 'px'; }
  el.innerHTML = `<div class="card-accent"></div><div class="card-title-txt"></div><div class="card-desc"></div>${cardBadges(card)}`;
  el.querySelector('.card-title-txt').textContent = card.title;
  const descEl = el.querySelector('.card-desc');
  const preview = stripMd(card.description);
  if (preview) descEl.textContent = preview; else descEl.remove();

  const del = document.createElement('button');
  del.className = 'icon-btn danger card-del';
  del.innerHTML = ICON.trash; del.title = 'Delete card';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    const title = card.title;
    el.classList.add('removing');
    await new Promise((r) => setTimeout(r, 150));
    try { await api('DELETE', `/api/cards/${card.id}`); await reloadWorkspace(); toastAction(`Deleted “${title}”`, 'Undo', undo); }
    catch (err) { el.classList.remove('removing'); toast(err.message); }
  });
  el.appendChild(del);
  return el;
}

const binderColor = (binder, index) => binder.color || BINDER_COLORS[index % BINDER_COLORS.length];

function makeBinderEl(binder, index) {
  const el = document.createElement('div');
  el.className = 'binder' + (binder.id === pendingPopId ? ' pop-in' : '');
  el.dataset.id = binder.id;
  el.style.left = binder.x + 'px'; el.style.top = binder.y + 'px';
  el.style.setProperty('--binder-color', binderColor(binder, index));
  const cards = ws.cards.filter((c) => c.binderId === binder.id).sort((a, b) => a.order - b.order);
  el.innerHTML = `
    <div class="binder-head">
      <span class="binder-title" title="Double-click to edit"></span>
      <span class="binder-count">${cards.length}</span>
      <button class="icon-btn danger delete-binder" title="Delete binder">${ICON.trash}</button>
    </div>
    ${binder.description ? '<div class="binder-desc"></div>' : ''}
    <div class="binder-cards ${cards.length ? '' : 'empty'}"></div>
    <button class="binder-add">+ Add a card</button>`;
  el.querySelector('.binder-title').textContent = binder.title;
  if (binder.description) el.querySelector('.binder-desc').textContent = binder.description;
  const cardsEl = el.querySelector('.binder-cards');
  cards.forEach((c) => cardsEl.appendChild(makeCardEl(c, false)));

  el.querySelector('.binder-title').addEventListener('dblclick', (e) => { e.stopPropagation(); openBinderEditor(binder.id); });

  el.querySelector('.delete-binder').addEventListener('click', async () => {
    const title = binder.title;
    el.classList.add('removing');
    await new Promise((r) => setTimeout(r, 150));
    try { await api('DELETE', `/api/binders/${binder.id}`); await reloadWorkspace(); toastAction(`Deleted binder “${title}”`, 'Undo', undo); }
    catch (e) { el.classList.remove('removing'); toast(e.message); }
  });

  wireBinderAdd(el, binder);
  return el;
}

function wireBinderAdd(binderEl, binder) {
  const addBtn = binderEl.querySelector('.binder-add');
  addBtn.addEventListener('click', () => {
    const composer = document.createElement('div');
    composer.className = 'composer';
    composer.innerHTML = `<textarea rows="2" placeholder="Card title…"></textarea>
      <div class="row"><button class="btn-primary">Add</button><button class="btn">Cancel</button></div>`;
    addBtn.replaceWith(composer);
    const ta = composer.querySelector('textarea'); ta.focus();
    const done = () => composer.replaceWith(addBtn);
    const save = async () => {
      const title = ta.value.trim();
      if (!title) return done();
      try { const c = await api('POST', `/api/workspaces/${ws.id}/cards`, { title, binderId: binder.id }); pendingPopId = c.id; await reloadWorkspace(); }
      catch (e) { toast(e.message); }
    };
    composer.querySelector('.btn-primary').addEventListener('click', save);
    composer.querySelector('.btn').addEventListener('click', done);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
      if (e.key === 'Escape') done();
    });
  });
}

// ---------- drag system ----------
let insertLineEl = null;
let lastDropBinder = null;
function clearInsert() {
  if (insertLineEl) { insertLineEl.remove(); insertLineEl = null; }
  if (lastDropBinder) { lastDropBinder.classList.remove('drop-target'); lastDropBinder = null; }
}
function binderElAt(x, y) {
  for (const el of document.elementsFromPoint(x, y)) {
    const b = el.closest && el.closest('.binder');
    if (b && world.contains(b)) return b;
  }
  return null;
}
function insertionIndex(binderEl, y, draggingId) {
  const items = [...binderEl.querySelectorAll('.binder-cards > .card')].filter((c) => c.dataset.id !== draggingId);
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) return i;
  }
  return items.length;
}
function showInsert(binderEl, index, draggingId) {
  const cardsEl = binderEl.querySelector('.binder-cards');
  const items = [...cardsEl.children].filter((c) => c.classList.contains('card') && c.dataset.id !== draggingId);
  const line = document.createElement('div'); line.className = 'insert-line'; insertLineEl = line;
  if (index >= items.length) cardsEl.appendChild(line); else cardsEl.insertBefore(line, items[index]);
}

viewport.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const interactive = e.target.closest('input, textarea, button, a, .composer');
  const cardEl = e.target.closest('.card');
  const headEl = e.target.closest('.binder-head');
  if (cardEl && !interactive) startCardDrag(e, cardEl);
  else if (headEl && !interactive) startBinderDrag(e, headEl.closest('.binder'));
  else if (!e.target.closest('.binder') && !cardEl) startPan(e);
});

function startPan(e) {
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY, px = panX, py = panY;
  viewport.classList.add('panning');
  const move = (ev) => { panX = px + (ev.clientX - sx); panY = py + (ev.clientY - sy); updateTransform(); };
  const up = () => { viewport.classList.remove('panning'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); saveView(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

function startBinderDrag(e, binderEl) {
  e.preventDefault();
  const binder = ws.binders.find((b) => b.id === binderEl.dataset.id);
  const sx = e.clientX, sy = e.clientY, x0 = binder.x, y0 = binder.y;
  const head = binderEl.querySelector('.binder-head');
  let moved = false;
  const move = (ev) => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
    moved = true; head.classList.add('grabbing');
    binder.x = snap(x0 + (ev.clientX - sx) / zoom);
    binder.y = snap(y0 + (ev.clientY - sy) / zoom);
    binderEl.style.left = binder.x + 'px'; binderEl.style.top = binder.y + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    head.classList.remove('grabbing');
    if (moved) api('PATCH', `/api/binders/${binder.id}`, { x: binder.x, y: binder.y }).catch((err) => toast(err.message));
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

function startCardDrag(e, cardEl) {
  e.preventDefault();
  const cardId = cardEl.dataset.id;
  const sx = e.clientX, sy = e.clientY;
  const rect = cardEl.getBoundingClientRect();
  const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
  let ghost = null, moved = false, drop = null;

  const move = (ev) => {
    if (!moved) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      ghost = cardEl.cloneNode(true);
      ghost.classList.add('drag-ghost'); ghost.classList.remove('pop-in');
      ghost.style.width = rect.width + 'px';
      document.body.appendChild(ghost);
      cardEl.classList.add('drag-source');
    }
    ghost.style.left = (ev.clientX - offX) + 'px';
    ghost.style.top = (ev.clientY - offY) + 'px';
    clearInsert();
    const binderEl = binderElAt(ev.clientX, ev.clientY);
    if (binderEl) {
      const index = insertionIndex(binderEl, ev.clientY, cardId);
      binderEl.classList.add('drop-target'); lastDropBinder = binderEl;
      showInsert(binderEl, index, cardId);
      drop = { binderId: binderEl.dataset.id, toIndex: index };
    } else { drop = null; }
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    if (ghost) ghost.remove();
    cardEl.classList.remove('drag-source');
    clearInsert();
    if (!moved) { openCard(cardId); return; }
    if (drop) applyMove(cardId, drop);
    else {
      const w = screenToWorld(ev.clientX - offX, ev.clientY - offY);
      applyMove(cardId, { binderId: null, x: snap(Math.round(w.x)), y: snap(Math.round(w.y)) });
    }
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}

async function applyMove(cardId, payload) {
  try { await api('POST', `/api/cards/${cardId}/move`, payload); await reloadWorkspace(); }
  catch (e) { toast(e.message); await reloadWorkspace(); }
}

// ---------- wheel ----------
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, zoom * Math.exp(-e.deltaY * 0.0015));
  else { panX -= e.deltaX; panY -= e.deltaY; updateTransform(); saveView(); }
}, { passive: false });

$('zoom-in').addEventListener('click', () => { const r = viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, zoom * 1.2); });
$('zoom-out').addEventListener('click', () => { const r = viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, zoom / 1.2); });
$('zoom-reset').addEventListener('click', () => { zoom = 1; panX = 0; panY = 0; updateTransform(); saveView(); });

// ---------- toolbar add ----------
$('add-card-btn').addEventListener('click', async () => {
  const c = viewCenterWorld();
  try {
    const card = await api('POST', `/api/workspaces/${ws.id}/cards`, { title: 'New card', x: snap(Math.round(c.x - 132)), y: snap(Math.round(c.y - 40)) });
    pendingPopId = card.id;
    await reloadWorkspace();
    openCard(card.id); titleInput.focus(); titleInput.select();
  } catch (e) { toast(e.message); }
});
$('add-binder-btn').addEventListener('click', async () => {
  const c = viewCenterWorld();
  try {
    const b = await api('POST', `/api/workspaces/${ws.id}/binders`, { title: 'New binder', x: snap(Math.round(c.x - 156)), y: snap(Math.round(c.y - 40)) });
    pendingPopId = b.id;
    await reloadWorkspace();
    openBinderEditor(b.id);
  } catch (e) { toast(e.message); }
});

// ---------- workspaces ----------
async function switchWorkspace(id) {
  await api('PATCH', '/api/state', { activeWorkspaceId: id }).catch(() => {});
  await loadWorkspace(id);
}
$('ws-add').addEventListener('click', async () => {
  try {
    const created = await api('POST', '/api/workspaces', {});
    const s = await api('GET', '/api/state'); wsList = s.workspaces;
    await loadWorkspace(created.id);
  } catch (e) { toast(e.message); }
});

let openMenuEl = null;
function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; document.removeEventListener('pointerdown', onDocDown, true); } }
function onDocDown(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }
function showMenu(x, y, items) {
  closeMenu();
  const menu = document.createElement('div'); menu.className = 'popup-menu';
  items.forEach((it) => {
    const b = document.createElement('button');
    b.textContent = it.label; if (it.danger) b.className = 'danger';
    b.addEventListener('click', () => { closeMenu(); it.onClick(); });
    menu.appendChild(b);
  });
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  document.body.appendChild(menu); openMenuEl = menu;
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
}
function openWorkspaceMenu(e, w) {
  const r = e.target.getBoundingClientRect();
  showMenu(r.left - 100, r.bottom + 6, [
    { label: 'Rename', onClick: () => { const tab = [...document.querySelectorAll('.ws-tab')].find((t) => t.querySelector('.ws-name')?.textContent === w.name); if (tab) startTabRename(w, tab.querySelector('.ws-name')); } },
    { label: 'Delete board', danger: true, onClick: async () => {
      if (wsList.length === 1) return toast('Cannot delete the last board');
      if (!confirm(`Delete board “${w.name}” and everything in it? (This cannot be undone.)`)) return;
      try { const res = await api('DELETE', `/api/workspaces/${w.id}`); const s = await api('GET', '/api/state'); wsList = s.workspaces; await loadWorkspace(res.activeWorkspaceId); }
      catch (err) { toast(err.message); }
    } },
  ]);
}

// ---------- undo ----------
async function undo() {
  try {
    const r = await api('POST', '/api/undo');
    if (r.empty) { toast('Nothing to undo'); return; }
    if (!r.ok) { toast('Could not undo'); return; }
    if (r.workspaceId && r.workspaceId !== activeWorkspaceId) await switchWorkspace(r.workspaceId);
    else await reloadWorkspace();
  } catch (e) { toast(e.message); }
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    e.preventDefault(); undo();
  }
});

// ---------- modal ----------
const overlay = $('modal-overlay');
const modal = $('modal');
const titleInput = $('card-title');
const descView = $('desc-view');
const descEdit = $('desc-edit');
const descToggle = $('desc-toggle');
const attachmentsEl = $('attachments');
const addDrop = $('add-drop');

$('modal-close').innerHTML = ICON.close;
$('delete-card').innerHTML = ICON.trash;

function openCard(id) {
  currentCardId = id; descEditing = false; editingAtts.clear();
  const card = currentCard(); if (!card) return;
  titleInput.value = card.title;
  $('card-meta').textContent = `Created ${shortDate(card.createdAt)} · Updated ${shortDate(card.updatedAt)}`;
  renderDescription(); renderAttachments(); updateSortBtn();
  overlay.classList.remove('hidden');
}
function closeModal() { overlay.classList.add('hidden'); currentCardId = null; }
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
$('modal-close').addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal(); });

titleInput.addEventListener('change', async () => {
  const card = currentCard(); if (!card) return;
  const title = titleInput.value.trim();
  if (!title || title === card.title) { titleInput.value = card.title; return; }
  try { const u = await api('PATCH', `/api/cards/${card.id}`, { title }); Object.assign(card, u); renderWorkspace(); }
  catch (e) { toast(e.message); }
});

descToggle.className = 'icon-btn desc-edit-btn';
descToggle.title = 'Edit description';
descToggle.innerHTML = ICON.pencil;

function renderDescription() {
  const card = currentCard();
  if (descEditing) { descEdit.value = card.description || ''; descEdit.classList.remove('hidden'); descView.classList.add('hidden'); }
  else { descView.innerHTML = renderMarkdown(card.description); descView.classList.remove('hidden'); descEdit.classList.add('hidden'); }
}
function enterDescEdit() {
  if (descEditing) return;
  descEditing = true; renderDescription(); descEdit.focus();
}
async function saveDesc() {
  if (!descEditing) return;
  descEditing = false;
  const card = currentCard();
  if (card && descEdit.value !== card.description) {
    try { const u = await api('PATCH', `/api/cards/${card.id}`, { description: descEdit.value }); Object.assign(card, u); }
    catch (e) { toast(e.message); }
  }
  renderDescription(); renderWorkspace();
}
descToggle.addEventListener('click', () => { if (descEditing) saveDesc(); else enterDescEdit(); });
descView.addEventListener('dblclick', enterDescEdit);
descEdit.addEventListener('blur', saveDesc);

// ----- attachments -----
const attMode = (card) => (card && card.attSort) || 'newest';
function sortedAttachments(card) {
  const list = [...(card.attachments || [])];
  if (attMode(card) === 'custom') return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return attMode(card) === 'newest' ? list.reverse() : list;
}
function updateSortBtn() {
  const m = attMode(currentCard());
  $('att-sort').textContent = m === 'newest' ? 'Newest first ↓' : m === 'oldest' ? 'Oldest first ↑' : 'Custom order ↕';
}
$('att-sort').addEventListener('click', async () => {
  const card = currentCard(); if (!card) return;
  const m = attMode(card);
  const next = m === 'newest' ? 'oldest' : m === 'oldest' ? 'custom' : 'newest';
  if (next === 'custom') {
    await reorderAtts(card, sortedAttachments(card).map((a) => a.id)); // freeze current view as custom
  } else {
    card.attSort = next;
    try { await api('PATCH', `/api/cards/${card.id}`, { attSort: next }); } catch (e) { toast(e.message); }
  }
  updateSortBtn(); renderAttachments();
});
async function reorderAtts(card, ids) {
  card.attSort = 'custom';
  ids.forEach((id, i) => { const a = card.attachments.find((x) => x.id === id); if (a) a.order = i; });
  try { await api('POST', `/api/cards/${card.id}/attachments/reorder`, { orderedIds: ids }); } catch (e) { toast(e.message); }
}
function startAttReorder(e, attEl) {
  e.preventDefault();
  const card = currentCard(); if (!card) return;
  attEl.classList.add('att-dragging');
  const move = (ev) => {
    const others = [...attachmentsEl.querySelectorAll('.attachment')].filter((el) => el !== attEl);
    const before = others.find((el) => { const r = el.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
    if (before) attachmentsEl.insertBefore(attEl, before); else attachmentsEl.appendChild(attEl);
  };
  const up = async () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    attEl.classList.remove('att-dragging');
    const ids = [...attachmentsEl.querySelectorAll('.attachment')].map((el) => el.dataset.attId);
    await reorderAtts(card, ids);
    updateSortBtn(); renderAttachments();
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function renderAttachments() {
  const card = currentCard();
  attachmentsEl.innerHTML = '';
  sortedAttachments(card).forEach((att) => attachmentsEl.appendChild(renderAttachment(att)));
}
function attachmentBody(att) {
  if (att.type === 'text') {
    if (editingAtts.has(att.id)) return `<textarea class="att-text-edit" placeholder="Write markdown…"></textarea>`;
    return `<div class="markdown">${renderMarkdown(att.content)}</div>`;
  }
  if (att.type === 'url') {
    const u = att.url;
    if (looksLikeImage(u)) return `<a href="${u}" target="_blank" rel="noopener">${escapeHtml(u)}</a><img src="${u}" alt="" style="margin-top:6px">`;
    if (looksLikeVideo(u)) return `<a href="${u}" target="_blank" rel="noopener">${escapeHtml(u)}</a><video src="${u}" controls style="margin-top:6px"></video>`;
    return `<a href="${u}" target="_blank" rel="noopener">${escapeHtml(att.title || u)}</a>`;
  }
  if (att.type === 'image') return `<a href="${fileUrl(att)}" target="_blank" rel="noopener"><img src="${fileUrl(att)}" alt=""></a>`;
  if (att.type === 'video') return `<video src="${fileUrl(att)}" controls></video>`;
  return `<a href="${fileUrl(att)}" download="${escapeHtml(att.originalName || '')}">⬇ ${escapeHtml(att.originalName || 'download')}</a> <span style="color:var(--muted);font-size:12px">(${formatBytes(att.size)})</span>`;
}
function renderAttachment(att) {
  const el = document.createElement('div');
  el.className = 'attachment'; el.dataset.attId = att.id;
  const editing = editingAtts.has(att.id);
  const canEdit = att.type === 'text' && !editing;
  el.innerHTML = `
    <div class="att-head">
      <span class="att-grip" title="Drag to reorder">${ICON.grip}</span>
      <span class="att-type">${att.type}</span>
      ${att.originalName ? `<span class="att-name">${escapeHtml(att.originalName)}</span>` : ''}
      <span class="att-time">${shortDate(att.createdAt)}</span>
      ${editing ? '' : `<span class="att-actions">
        ${canEdit ? `<button class="icon-btn" data-a="edit" title="Edit">${ICON.pencil}</button>` : ''}
        <button class="icon-btn danger" data-a="remove" title="Remove">${ICON.trash}</button>
      </span>`}
    </div>
    <div class="att-body">${attachmentBody(att)}</div>`;

  el.querySelector('.att-grip').addEventListener('pointerdown', (e) => startAttReorder(e, el));

  if (editing) {
    const ta = el.querySelector('.att-text-edit');
    ta.value = att.content || '';
    setTimeout(() => ta.focus(), 0);
    ta.addEventListener('blur', () => commitText(att, ta.value));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') ta.blur(); });
  } else {
    const rm = el.querySelector('[data-a="remove"]'); if (rm) rm.addEventListener('click', () => removeAttachment(att.id));
    const ed = el.querySelector('[data-a="edit"]'); if (ed) ed.addEventListener('click', () => { editingAtts.add(att.id); renderAttachments(); });
  }
  return el;
}
async function commitText(att, value) {
  if (!editingAtts.has(att.id)) return;
  editingAtts.delete(att.id);
  const card = currentCard(); if (!card) return;
  if (!value.trim()) {
    try { await api('DELETE', `/api/cards/${card.id}/attachments/${att.id}`); } catch {}
    card.attachments = card.attachments.filter((a) => a.id !== att.id);
    renderAttachments(); renderWorkspace(); return;
  }
  if (value !== att.content) {
    try { const u = await api('PATCH', `/api/cards/${card.id}/attachments/${att.id}`, { content: value }); Object.assign(att, u); }
    catch (e) { toast(e.message); }
  }
  renderAttachments(); renderWorkspace();
}
async function removeAttachment(attId) {
  const card = currentCard();
  try {
    await api('DELETE', `/api/cards/${card.id}/attachments/${attId}`);
    card.attachments = card.attachments.filter((a) => a.id !== attId);
    editingAtts.delete(attId); renderAttachments(); renderWorkspace();
  } catch (e) { toast(e.message); }
}
async function addJsonAttachment(payload) {
  const card = currentCard();
  const att = await api('POST', `/api/cards/${card.id}/attachments`, payload);
  card.attachments.push(att);
  return att;
}
async function uploadFiles(files) {
  const card = currentCard(); if (!card) return;
  for (const file of files) {
    const fd = new FormData(); fd.append('file', file);
    try { const att = await api('POST', `/api/cards/${card.id}/attachments`, fd, true); card.attachments.push(att); }
    catch (e) { toast(`${file.name}: ${e.message}`); }
  }
  renderAttachments(); renderWorkspace();
}

// big + / drop button
addDrop.addEventListener('click', async () => {
  try {
    const att = await addJsonAttachment({ type: 'text', content: '' });
    editingAtts.add(att.id); renderAttachments();
  } catch (e) { toast(e.message); }
});
document.addEventListener('paste', (e) => {
  if (overlay.classList.contains('hidden')) return;
  const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); uploadFiles(files); }
});
['dragenter', 'dragover'].forEach((evt) => modal.addEventListener(evt, (e) => {
  if (e.dataTransfer?.types?.includes('Files') || e.dataTransfer?.types?.includes('text/uri-list')) { e.preventDefault(); addDrop.classList.add('dragover'); }
}));
modal.addEventListener('dragleave', (e) => { if (e.target === modal) addDrop.classList.remove('dragover'); });
modal.addEventListener('drop', async (e) => {
  addDrop.classList.remove('dragover');
  const dt = e.dataTransfer; if (!dt) return;
  if (dt.files && dt.files.length) { e.preventDefault(); uploadFiles(dt.files); return; }
  const uri = dt.getData('text/uri-list') || dt.getData('text/plain');
  if (uri && /^https?:\/\//i.test(uri.trim())) { e.preventDefault(); await addJsonAttachment({ type: 'url', url: uri.trim() }); renderAttachments(); renderWorkspace(); }
});

// delete card (trash icon, undoable)
$('delete-card').addEventListener('click', async () => {
  const card = currentCard(); if (!card) return;
  const title = card.title;
  try { await api('DELETE', `/api/cards/${card.id}`); closeModal(); await reloadWorkspace(); toastAction(`Deleted “${title}”`, 'Undo', undo); }
  catch (e) { toast(e.message); }
});

// ---------- binder editor ----------
let currentBinderId = null;
const binderOverlay = $('binder-overlay');
const binderColorBar = $('binder-color-bar');
const binderColorInput = $('binder-color-input');
$('binder-close').innerHTML = ICON.close;
$('binder-delete').innerHTML = ICON.trash;
const currentBinder = () => ws && ws.binders.find((b) => b.id === currentBinderId);

function openBinderEditor(binderId) {
  currentBinderId = binderId;
  const b = currentBinder(); if (!b) return;
  const color = binderColor(b, ws.binders.indexOf(b));
  $('binder-name').value = b.title;
  $('binder-desc').value = b.description || '';
  binderColorBar.style.setProperty('--binder-color', color);
  if (/^#[0-9a-fA-F]{6}$/.test(color)) binderColorInput.value = color;
  binderOverlay.classList.remove('hidden');
  $('binder-name').focus(); $('binder-name').select();
}
function closeBinderEditor() { binderOverlay.classList.add('hidden'); currentBinderId = null; }

binderColorBar.addEventListener('click', () => binderColorInput.click());
binderColorInput.addEventListener('input', () => {
  const b = currentBinder(); if (!b) return;
  b.color = binderColorInput.value;
  binderColorBar.style.setProperty('--binder-color', b.color);
  renderWorkspace(); // live preview on the canvas
});
binderColorInput.addEventListener('change', async () => {
  const b = currentBinder(); if (!b) return;
  try { await api('PATCH', `/api/binders/${b.id}`, { color: b.color }); } catch (e) { toast(e.message); }
});
async function saveBinderName() {
  const b = currentBinder(); if (!b) return;
  const name = $('binder-name').value.trim();
  if (name && name !== b.title) { b.title = name; try { await api('PATCH', `/api/binders/${b.id}`, { title: name }); renderWorkspace(); } catch (e) { toast(e.message); } }
}
$('binder-name').addEventListener('blur', saveBinderName);
$('binder-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('binder-name').blur(); } });
$('binder-desc').addEventListener('blur', async () => {
  const b = currentBinder(); if (!b) return;
  const desc = $('binder-desc').value;
  if (desc !== (b.description || '')) { b.description = desc; try { await api('PATCH', `/api/binders/${b.id}`, { description: desc }); renderWorkspace(); } catch (e) { toast(e.message); } }
});
$('binder-close').addEventListener('click', closeBinderEditor);
$('binder-delete').addEventListener('click', async () => {
  const b = currentBinder(); if (!b) return;
  const title = b.title;
  closeBinderEditor();
  try { await api('DELETE', `/api/binders/${b.id}`); await reloadWorkspace(); toastAction(`Deleted binder “${title}”`, 'Undo', undo); }
  catch (e) { toast(e.message); }
});
binderOverlay.addEventListener('click', (e) => { if (e.target === binderOverlay) closeBinderEditor(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !binderOverlay.classList.contains('hidden')) closeBinderEditor(); });

// ---------- go ----------
loadState().catch((e) => toast('Failed to load: ' + e.message));
