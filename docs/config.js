// Picks which backend app.js talks to.
//
//   Demo mode  -> browser-only, persisted in IndexedDB (see demo-api.js).
//   Server mode -> the Express + disk-JSON backend (see server.js).
//
// Auto-on for GitHub Pages (*.github.io) and when the URL carries ?demo=1
// (handy for trying the demo against the local server). If you host the demo
// on a custom domain, set `window.DRIFTBOARD_DEMO = true` before this script.
window.DRIFTBOARD_DEMO = window.DRIFTBOARD_DEMO
  ?? (/\.github\.io$/.test(location.hostname)
      || new URLSearchParams(location.search).has('demo'));
