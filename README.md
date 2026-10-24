# Torlink GUI

A mouse-friendly web app for [torlink](https://torlink.bairon.dev) — the zero-setup
torrent finder/downloader (`npx torlnk`). It keeps the terminal where it belongs and
puts search, downloads, seeding, and file streaming in a clickable interface.

It reuses torlink's own engine: the backend spawns `torlnk serve` (download API) and
`torlnk files` (download folder HTTP server), and the search box runs the same
10 search sources the CLI does (YTS, Pirate Bay, 1337x, EZTV, FitGirl, Nyaa,
SubsPlease, BitTorrented).

## Quick start

### Double-click (no terminal, no commands)

- **`Torlink.app`** — double-click it (it's also in `/Applications`). It starts the
  server in the background, opens your browser, and shows no terminal window. Clicking
  it again later just reopens the app. Drag it to your Dock for one-click access.
  - If you move the project folder, re-run `bash make-app.sh` to rebuild the app with
    the new path.
- **`launch.command`** — double-click to start the server with a Terminal window showing
  the live log (close it with Ctrl-C to stop the server).

### From the terminal

```bash
npm install
npm start
```

Open http://localhost:4040 — the app starts the Torlink engine automatically.
`torlnk` is resolved from your existing npx cache; if it can't find it, it falls
back to `npx --yes torlnk`.

For development (hot reload + dev server):

```bash
npm run dev
```

Then open http://localhost:5173.

## What you can do

- **Search** — one query hits every source at once; results are deduped and sorted
  by seeders, just like the TUI. Filter by category (Movies / TV / Anime / Games)
  or leave the box empty and hit **Browse** for the latest releases.
- **Download** — click the Download button on any result, or paste a magnet link /
  info hash via **Add magnet**.
- **Downloads** — live progress bars, speed, peers; pause / resume / delete.
- **Seeds** — see what you're giving back; stop seeding or remove torrents.
- **Files** — browse finished files served by torlink's files server and stream
  them in the browser (Range requests pass through, so videos seek fine).
- **Settings** — choose the download folder (applies on restart) and see engine
  status.

## How it fits together

```
Browser (React)  →  server/index.js (Express on :4040)  →  torlnk serve (API :9161)
                          ├── /api/search   (in-process, same sources as the CLI)
                          ├── /api/add|downloads|control  → forwarded to torlnk
                          └── /files/*      → proxied to torlnk files (:9160)
```

The server auto-starts `torlnk serve` and `torlnk files` on `127.0.0.1` (their
default ports) when you launch the app, and shuts them down when it exits. If you
already run `torlnk serve` yourself, the app detects it and connects instead.

## Scripts

| Command            | What it does                          |
| ------------------ | ------------------------------------- |
| `npm start`        | Run API + serve the built app (:4040) |
| `npm run dev`      | API (:4040) + Vite dev server (:5173) |
| `npm run build`    | Build the frontend into `dist/`       |
| `npm run preview`  | Vite preview of the built app         |

## Notes

- The Torlink engine and files server listen on loopback only (no token needed).
- Search results are cached for 5 minutes per query, matching torlink's behavior.
- Download folder defaults to `~/Downloads/torlink` unless you change it in Settings.

<!-- Made by Ulug'bek -->