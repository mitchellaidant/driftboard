/* Driftboard demo backend — a browser-only port of server.js.
 *
 * When demo mode is on (see config.js), app.js routes every api() call here
 * instead of to the network, and resolves fileUrl() to object URLs from blobs
 * stored locally. Board metadata lives in IndexedDB (mirroring board.json);
 * uploaded files live as Blobs in a second store (mirroring data/uploads/).
 *
 * This script is inert until handle() is first called, so including it in the
 * server-backed app costs nothing. It intentionally mirrors server.js's route
 * bodies 1:1 so behaviour (migration-free defaults, trash/undo, reindexing,
 * attachment sorting) is identical.
 */
(() => {
  'use strict';

  const STARTER_BINDERS = ['To Do', 'In Progress', 'Blocked', 'Reviewing', 'Completed'];
  const TRASH_CAP = 40;
  const DB_NAME = 'driftboard-demo';

  const now = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));
  const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x))); // emulate the JSON-over-HTTP boundary
  const extname = (name) => { const i = String(name || '').lastIndexOf('.'); return i > 0 ? name.slice(i) : ''; };
  const err = (message) => new Error(message);

  // --- Storage state (in memory; persisted to IndexedDB) ---------------------
  let db = null;
  let state = null;
  let initPromise = null;
  const urlByFilename = new Map(); // filename -> object URL, so fileUrl() stays synchronous

  function makeBinders(titles) {
    return titles.map((title, i) => ({ id: uuid(), title, x: 40 + i * 340, y: 40 }));
  }
  function starterWorkspace(name = 'My Board') {
    return { id: uuid(), name, view: { panX: 0, panY: 0, zoom: 1 }, binders: makeBinders(STARTER_BINDERS), cards: [] };
  }
  function defaultState() {
    const ws = starterWorkspace();
    return { version: 2, activeWorkspaceId: ws.id, workspaces: [ws], trash: [] };
  }

  // --- Lookup helpers (mirror server.js) -------------------------------------
  const getWorkspace = (id) => state.workspaces.find((w) => w.id === id);
  function getBinder(id) {
    for (const ws of state.workspaces) {
      const binder = ws.binders.find((b) => b.id === id);
      if (binder) return { ws, binder };
    }
    return null;
  }
  function getCard(id) {
    for (const ws of state.workspaces) {
      const card = ws.cards.find((c) => c.id === id);
      if (card) return { ws, card };
    }
    return null;
  }
  function reindexBinder(ws, binderId) {
    if (!binderId) return;
    ws.cards.filter((c) => c.binderId === binderId).sort((a, b) => a.order - b.order).forEach((c, i) => { c.order = i; });
  }
  function uniqueWorkspaceName(base) {
    const names = new Set(state.workspaces.map((w) => w.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }
  function attachmentType(mimeType) {
    if (mimeType?.startsWith('image/')) return 'image';
    if (mimeType?.startsWith('video/')) return 'video';
    return 'file';
  }
  // Soft-delete: overflow purges the oldest entry's files for real.
  function pushTrash(entry) {
    state.trash.push(entry);
    while (state.trash.length > TRASH_CAP) {
      const old = state.trash.shift();
      if (old.type === 'card') (old.card.attachments || []).filter((a) => a.filename).forEach((a) => deleteBlob(a.filename));
    }
  }

  // --- IndexedDB plumbing ----------------------------------------------------
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains('kv')) database.createObjectStore('kv', { keyPath: 'key' });
        if (!database.objectStoreNames.contains('blobs')) database.createObjectStore('blobs', { keyPath: 'filename' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const idbReq = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const txDone = (t) => new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });

  async function persist() { // mirror of server's persist(): rewrite the whole board
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put({ key: 'state', value: state });
    await txDone(t);
  }
  async function putBlob(filename, blob) {
    const t = db.transaction('blobs', 'readwrite');
    t.objectStore('blobs').put({ filename, blob });
    await txDone(t);
    urlByFilename.set(filename, URL.createObjectURL(blob));
  }
  async function deleteBlob(filename) {
    try { const t = db.transaction('blobs', 'readwrite'); t.objectStore('blobs').delete(filename); await txDone(t); } catch { /* best effort */ }
    const url = urlByFilename.get(filename);
    if (url) { URL.revokeObjectURL(url); urlByFilename.delete(filename); }
  }

  function ready() { if (!initPromise) initPromise = init(); return initPromise; }
  async function init() {
    db = await openDb();
    const rec = await idbReq(db.transaction('kv', 'readonly').objectStore('kv').get('state'));
    state = rec ? rec.value : defaultState();
    if (!Array.isArray(state.trash)) state.trash = [];
    const blobs = await idbReq(db.transaction('blobs', 'readonly').objectStore('blobs').getAll());
    for (const b of blobs) urlByFilename.set(b.filename, URL.createObjectURL(b.blob));
    if (!rec) await persist();
  }

  // --- Route dispatch (mirrors server.js endpoints) --------------------------
  async function dispatch(method, url, body, isForm) {
    const seg = url.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean); // ['api','cards','ID','move']
    const j = (!isForm && body) ? body : {};

    // ---- Workspaces ----
    if (seg[0] === 'api' && seg[1] === 'state' && seg.length === 2) {
      if (method === 'GET') return { activeWorkspaceId: state.activeWorkspaceId, workspaces: state.workspaces.map((w) => ({ id: w.id, name: w.name })) };
      if (method === 'PATCH') { if (getWorkspace(j.activeWorkspaceId)) state.activeWorkspaceId = j.activeWorkspaceId; await persist(); return { ok: true }; }
    }
    if (seg[0] === 'api' && seg[1] === 'workspaces' && seg.length === 2 && method === 'POST') {
      const name = (j.name || '').trim() || uniqueWorkspaceName('New board');
      const ws = { id: uuid(), name, view: { panX: 0, panY: 0, zoom: 1 }, binders: [], cards: [] };
      state.workspaces.push(ws); state.activeWorkspaceId = ws.id; await persist(); return ws;
    }
    if (seg[0] === 'api' && seg[1] === 'workspaces' && seg.length === 3) {
      const ws = getWorkspace(seg[2]);
      if (method === 'GET') { if (!ws) throw err('workspace not found'); return ws; }
      if (method === 'PATCH') {
        if (!ws) throw err('workspace not found');
        if (typeof j.name === 'string' && j.name.trim()) ws.name = j.name.trim();
        if (j.view && typeof j.view === 'object') {
          ws.view = { panX: Number(j.view.panX) || 0, panY: Number(j.view.panY) || 0, zoom: Math.min(2.5, Math.max(0.25, Number(j.view.zoom) || 1)) };
        }
        await persist(); return { id: ws.id, name: ws.name, view: ws.view };
      }
      if (method === 'DELETE') {
        const index = state.workspaces.findIndex((w) => w.id === seg[2]);
        if (index === -1) throw err('workspace not found');
        if (state.workspaces.length === 1) throw err('cannot delete the last workspace');
        const [removed] = state.workspaces.splice(index, 1);
        if (state.activeWorkspaceId === removed.id) state.activeWorkspaceId = state.workspaces[0].id;
        await persist();
        for (const c of removed.cards) for (const a of (c.attachments || [])) if (a.filename) await deleteBlob(a.filename);
        return { ok: true, activeWorkspaceId: state.activeWorkspaceId };
      }
    }
    // ---- Binders ----
    if (seg[0] === 'api' && seg[1] === 'workspaces' && seg[3] === 'binders' && seg.length === 4 && method === 'POST') {
      const ws = getWorkspace(seg[2]); if (!ws) throw err('workspace not found');
      const binder = { id: uuid(), title: (j.title || 'New binder').trim() || 'New binder', x: Number(j.x) || 48, y: Number(j.y) || 48 };
      ws.binders.push(binder); await persist(); return binder;
    }
    if (seg[0] === 'api' && seg[1] === 'binders' && seg.length === 3) {
      const found = getBinder(seg[2]); if (!found) throw err('binder not found');
      const { ws, binder } = found;
      if (method === 'PATCH') {
        if (typeof j.title === 'string' && j.title.trim()) binder.title = j.title.trim();
        if (j.x !== undefined) binder.x = Number(j.x);
        if (j.y !== undefined) binder.y = Number(j.y);
        if (typeof j.color === 'string') binder.color = j.color;
        if (typeof j.description === 'string') binder.description = j.description;
        await persist(); return binder;
      }
      if (method === 'DELETE') {
        const members = ws.cards.filter((c) => c.binderId === binder.id).sort((a, b) => a.order - b.order).map((c) => ({ id: c.id, order: c.order }));
        ws.cards.filter((c) => c.binderId === binder.id).forEach((c, i) => { c.binderId = null; c.x = binder.x + 16 + (i % 3) * 24; c.y = binder.y + 64 + i * 28; });
        ws.binders = ws.binders.filter((b) => b.id !== binder.id);
        pushTrash({ type: 'binder', workspaceId: ws.id, binder, members });
        await persist(); return { ok: true };
      }
    }
    // ---- Cards ----
    if (seg[0] === 'api' && seg[1] === 'workspaces' && seg[3] === 'cards' && seg.length === 4 && method === 'POST') {
      const ws = getWorkspace(seg[2]); if (!ws) throw err('workspace not found');
      const title = (j.title || '').trim(); if (!title) throw err('title is required');
      const binderId = ws.binders.some((b) => b.id === j.binderId) ? j.binderId : null;
      const card = {
        id: uuid(), title, description: '', attachments: [], binderId,
        order: binderId ? ws.cards.filter((c) => c.binderId === binderId).length : 0,
        x: Number(j.x) || 80, y: Number(j.y) || 80, createdAt: now(), updatedAt: now(),
      };
      ws.cards.push(card); await persist(); return card;
    }
    if (seg[0] === 'api' && seg[1] === 'cards' && seg.length === 3) {
      const found = getCard(seg[2]); if (!found) throw err('card not found');
      const { card } = found;
      if (method === 'PATCH') {
        if (typeof j.title === 'string') card.title = j.title;
        if (typeof j.description === 'string') card.description = j.description;
        if (typeof j.attSort === 'string' && ['newest', 'oldest', 'custom'].includes(j.attSort)) card.attSort = j.attSort;
        card.updatedAt = now(); await persist(); return card;
      }
      if (method === 'DELETE') {
        const { ws } = found;
        ws.cards = ws.cards.filter((c) => c.id !== card.id);
        if (card.binderId) reindexBinder(ws, card.binderId);
        pushTrash({ type: 'card', workspaceId: ws.id, card });
        await persist(); return { ok: true };
      }
    }
    if (seg[0] === 'api' && seg[1] === 'cards' && seg[3] === 'move' && seg.length === 4 && method === 'POST') {
      const found = getCard(seg[2]); if (!found) throw err('card not found');
      const { ws, card } = found;
      const fromBinderId = card.binderId;
      const targetBinder = ws.binders.find((b) => b.id === j.binderId);
      if (targetBinder) {
        const column = ws.cards.filter((c) => c.binderId === targetBinder.id && c.id !== card.id).sort((a, b) => a.order - b.order);
        let index = Number.isInteger(j.toIndex) ? j.toIndex : column.length;
        index = Math.max(0, Math.min(index, column.length));
        column.splice(index, 0, card); card.binderId = targetBinder.id; column.forEach((c, i) => { c.order = i; });
      } else {
        card.binderId = null;
        if (j.x !== undefined) card.x = Number(j.x);
        if (j.y !== undefined) card.y = Number(j.y);
      }
      if (fromBinderId && fromBinderId !== card.binderId) reindexBinder(ws, fromBinderId);
      card.updatedAt = now(); await persist(); return { ok: true };
    }
    // ---- Undo ----
    if (seg[0] === 'api' && seg[1] === 'undo' && seg.length === 2 && method === 'POST') {
      const entry = state.trash.pop();
      if (!entry) return { ok: false, empty: true };
      const ws = getWorkspace(entry.workspaceId);
      if (!ws) { await persist(); return { ok: false }; }
      if (entry.type === 'card') {
        const card = entry.card;
        if (card.binderId && !ws.binders.some((b) => b.id === card.binderId)) card.binderId = null;
        ws.cards.push(card);
        if (card.binderId) reindexBinder(ws, card.binderId);
        await persist(); return { ok: true, kind: 'card', workspaceId: ws.id };
      }
      ws.binders.push(entry.binder);
      entry.members.forEach((m) => { const c = ws.cards.find((cc) => cc.id === m.id); if (c) { c.binderId = entry.binder.id; c.order = m.order; } });
      reindexBinder(ws, entry.binder.id);
      await persist(); return { ok: true, kind: 'binder', workspaceId: ws.id };
    }
    // ---- Attachments ----
    if (seg[0] === 'api' && seg[1] === 'cards' && seg[3] === 'attachments' && seg.length === 4 && method === 'POST') {
      const found = getCard(seg[2]); if (!found) throw err('card not found');
      const { card } = found;
      let attachment;
      const file = isForm ? body.get('file') : null;
      if (file) {
        const filename = `${uuid()}${extname(file.name)}`;
        await putBlob(filename, file);
        attachment = { id: uuid(), type: attachmentType(file.type), filename, originalName: file.name, mimeType: file.type, size: file.size, createdAt: now() };
      } else if (j.type === 'text') {
        attachment = { id: uuid(), type: 'text', content: j.content || '', createdAt: now() };
      } else if (j.type === 'url') {
        const url2 = (j.url || '').trim(); if (!url2) throw err('url is required');
        attachment = { id: uuid(), type: 'url', url: url2, title: (j.title || '').trim(), createdAt: now() };
      } else {
        throw err('unsupported attachment');
      }
      attachment.order = card.attachments.length;
      card.attachments.push(attachment); card.updatedAt = now(); await persist(); return attachment;
    }
    if (seg[0] === 'api' && seg[1] === 'cards' && seg[3] === 'attachments' && seg[4] === 'reorder' && seg.length === 5 && method === 'POST') {
      const found = getCard(seg[2]); if (!found) throw err('card not found');
      const { card } = found;
      const ids = Array.isArray(j.orderedIds) ? j.orderedIds : [];
      ids.forEach((id, i) => { const a = card.attachments.find((x) => x.id === id); if (a) a.order = i; });
      card.attSort = 'custom'; card.updatedAt = now(); await persist(); return { ok: true };
    }
    if (seg[0] === 'api' && seg[1] === 'cards' && seg[3] === 'attachments' && seg.length === 5) {
      const found = getCard(seg[2]); if (!found) throw err('card not found');
      const att = (found.card.attachments || []).find((a) => a.id === seg[4]);
      if (!att) throw err('attachment not found');
      if (method === 'PATCH') {
        if (att.type === 'text' && typeof j.content === 'string') att.content = j.content;
        if (att.type === 'url' && typeof j.url === 'string' && j.url.trim()) att.url = j.url.trim();
        if (typeof j.title === 'string') att.title = j.title;
        found.card.updatedAt = now(); await persist(); return att;
      }
      if (method === 'DELETE') {
        const { card } = found;
        const index = card.attachments.findIndex((a) => a.id === seg[4]);
        const [removed] = card.attachments.splice(index, 1);
        card.updatedAt = now(); await persist();
        if (removed.filename) await deleteBlob(removed.filename);
        return { ok: true };
      }
    }

    throw err(`demo: unhandled ${method} ${url}`);
  }

  async function handle(method, url, body, isForm) {
    await ready();
    const result = await dispatch(method.toUpperCase(), url, body, isForm);
    return clone(result); // hand back copies, exactly like the JSON-over-HTTP server would
  }

  function fileUrl(filename) { return urlByFilename.get(filename) || ''; }

  async function reset() {
    await ready();
    for (const url of urlByFilename.values()) URL.revokeObjectURL(url);
    urlByFilename.clear();
    const t = db.transaction(['kv', 'blobs'], 'readwrite');
    t.objectStore('kv').clear();
    t.objectStore('blobs').clear();
    await txDone(t);
    state = defaultState();
    await persist();
  }

  window.DriftboardDemo = { handle, fileUrl, reset };
})();
