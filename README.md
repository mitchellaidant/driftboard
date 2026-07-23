# Driftboard

Driftboard is a local, disk-backed visual to-do board built on an **infinite
canvas**. Cards
can float freely anywhere on the canvas or be filed into **binders** — little
containers that hold an ordered stack of cards. You can keep as many independent
**workspaces** as you like, each with its own canvas.

Every card has a title, a markdown description, and a list of removable
attachments: markdown text, links, images, videos, and arbitrary files.

## Two ways to run it

Driftboard runs in **two modes from a single codebase** (`docs/`):

- **Server mode** (the real app) — the browser talks to the Express + disk-JSON
  backend in `server.js`. Your board and uploads live on disk under `data/`.
- **Demo mode** (browser-only) — no server. Everything is stored locally in the
  browser via **IndexedDB** (metadata) and **Blobs** (uploaded files), so it can
  be hosted as a static site on **GitHub Pages** with nothing to run.

**Live demo:** https://mitchellaidant.github.io/driftboard/

## Why a local server instead of localStorage

Card metadata is stored as JSON in `data/board.json`, and pasted/dropped media
are saved as real files under `data/uploads/`. This is far more durable than
`localStorage` (capped at a few MB and wiped when you clear browser data), and
your images and videos live on disk where you can back them up or inspect them
directly.

## Run it

```sh
npm install      # first time only
npm start        # then open http://localhost:4321
```

Set a different port with `PORT=5000 npm start`.

## Using it

### Canvas
- **Pan** — drag empty canvas, or scroll (trackpad two-finger works too).
- **Zoom** — ⌘/Ctrl + scroll, or the `+` / `−` / `100%` controls in the toolbar.
  `100%` resets the view.

### Boards (workspaces)
- Switch with the tabs in the header, Excel-style. **+** instantly creates a new
  **empty** board named "New board" (no dialog) and opens it.
- **Double-click a tab's name** to rename it inline (Enter to save, Esc to
  cancel). The **⋯** on the active tab also offers Rename / Delete board.

### Appearance
- **Light / dark** toggle at the top-right (remembered per browser).
- **Snap to grid** toggle in the toolbar — on by default, so binders and cards
  align to the dotted grid as you drag. Toggle it off for free placement.

### Binders & cards
- **Add a binder** or a **free card** from the bottom toolbar. A binder can also
  add its own cards via *+ Add a card*.
- **Move a card** — drag it. Drop it inside a binder to file it (with a live
  insertion indicator), or drop it on open canvas to leave it floating anywhere.
- **Move a binder** — drag it by its title bar. **Delete a card** quickly with
  the 🗑 that appears on the card when you hover it (undoable).
- **Edit a binder** — **double-click its title** to open the binder editor:
  rename it, pick its accent **color** (click the color bar at the top), and give
  it a **description** (shown under the binder title on the canvas).
- **Open a card** — click it. Edit the **title** (saves on blur) and the
  **description** — click the ✏ pencil *or double-click the description*, then
  just click away to save. A card's description also previews under its title on
  the board.

### Attachments
- The big **+** button: **click** it to add a markdown text note, or **drag a
  file onto it** (or paste with ⌘/Ctrl+V anywhere on the card) to upload images,
  videos, and files. Dropping a link adds it as a URL.
- Text notes **auto-save when you click away** — no save button.
- Sort button cycles **Newest first → Oldest first → Custom order**. Drag any
  attachment by its grip handle to reorder it — that automatically switches the
  card to custom order and remembers it.
- **Edit** a text note with the ✏ pencil; **remove** any attachment with the 🗑
  trash icon.

### Undo
Deleting a card or a binder is **undoable** — hit the **Undo** button on the
toast that appears, or press **⌘/Ctrl+Z**. Undo restores the item (and a card's
uploaded files) exactly as it was; a binder's cards get re-filed into it. The
last 40 deletions are recoverable, even across restarts.

## Data & backups

Everything lives in `data/`:

```
data/
  board.json      # workspaces, binders, cards, positions, attachment metadata
  uploads/        # the actual image/video/file bytes
```

Copy that folder to back up or move everything. Deleting a card, binder's cards,
or a whole workspace also deletes the associated files from `data/uploads/`.

## Layout

```
server.js          Express API + static host (serves docs/), JSON persistence, file uploads
docs/index.html    App shell (shared by both modes; also the GitHub Pages entry)
docs/styles.css    Styling (Mujin palette, Roboto)
docs/app.js        Canvas, custom drag, workspaces, binders, modal, attachments
docs/config.js     Chooses server vs demo backend (github.io / ?demo=1)
docs/demo-api.js   Browser-only backend: IndexedDB + Blobs (demo mode)
docs/vendor/       Vendored marked + dompurify (so the static site is self-contained)
```

`docs/` is both the static site the local server hosts and the GitHub Pages
source, so there is only one copy of the frontend.
