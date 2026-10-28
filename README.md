# Torlink GUI

A mouse-friendly desktop app for [torlink](https://torlink.bairon.dev) — the
zero-setup torrent finder and downloader. Search, download, seed, and stream
files from a clean web interface instead of a terminal.

Torlink GUI reuses torlink's own engine. The backend starts `torlnk serve` (the
download API) and `torlnk files` (the file server), and the search box queries
the same public sources the CLI uses.

Works on **Windows 10/11**, **macOS**, and **Linux**.

## Windows: double-click install

> **You do not need to install Node.js, npm, or anything else first.**
> The first run downloads a private Node.js runtime into the app folder.

1. Download or clone this folder and keep all files together.
2. Double-click **`Torlink.vbs`**.
   - Windows may hide the `.vbs` extension, so it can appear as **Torlink**.
   - If Windows shows a SmartScreen or "Open File" warning because the folder
     came from the internet, choose **More info → Run anyway**. The app only
     uses local files.
3. The first run opens a setup window. It downloads a portable Node.js 22
   runtime (about 30 MB), installs dependencies, builds the interface, and
   creates Desktop and Start Menu shortcuts. This can take a few minutes.
4. Torlink opens in your default browser. From then on, use the **Torlink**
   shortcut or `Torlink.vbs` again — setup is skipped and the app starts hidden.

You can also run **`Setup Torlink.bat`** directly if you prefer a visible setup
window. Administrator rights are not required.

### Everyday use on Windows

| What you want | Do this |
| --- | --- |
| Open Torlink | Desktop **Torlink** shortcut, Start Menu **Torlink**, or `Torlink.vbs` |
| See the live log / troubleshoot | Double-click **`Start Torlink.bat`** (keeps a console window open) |
| Stop Torlink | **Settings → Quit Torlink**, Start Menu **Stop Torlink**, or `Stop Torlink.bat` |
| Change the download folder | **Settings → Download folder → Browse… → Save & restart engine** |
| Open the download folder | **Settings → Open folder** |

Closing the browser tab does **not** stop Torlink. Downloads and seeding keep
running in the background. Use **Quit Torlink** or **Stop Torlink.bat** when you
want everything to stop.

### Where things live on Windows

| Item | Location |
| --- | --- |
| App and private runtime | the Torlink folder (`.runtime\node`) |
| Logs | `Torlink folder\.runtime\logs\` (`setup.log`, `setup-npm.log`, `server.*.log`) |
| Settings | `%APPDATA%\torlink-gui\settings.json` |
| Default downloads | `%USERPROFILE%\Downloads\torlink` |
| Torrent engine API | `127.0.0.1:9161` (local only) |
| File server | `127.0.0.1:9160` (local only) |
| App server | `127.0.0.1:4040` |

The app listens on loopback only. Windows Firewall may still ask about Node.js
the first time; allowing **private networks** is enough. Torrent traffic needs
outbound access, not an inbound firewall rule.

### Troubleshooting on Windows

| Problem | Fix |
| --- | --- |
| Double-click does nothing | Run **`Start Torlink.bat`** to see the error, then check `.runtime\logs\setup.log` and `.runtime\logs\server.err.log`. |
| "scripts\launch-windows.ps1 is missing" | The folder is incomplete. Extract the whole ZIP to a normal folder (do not run `Torlink.vbs` from inside the ZIP) so `Torlink.vbs`, `scripts\`, `server\` and `node_modules\` sit side by side. If Windows antivirus removed the scripts, restore them from quarantine. |
| Setup says it could not reach nodejs.org | Check your internet connection, then run **`Setup Torlink.bat`** again. Behind a proxy, install Node.js 22 from [nodejs.org](https://nodejs.org) and run setup again. |
| "Port 4040 is already used" | Another Torlink or another app is using the port. Run **`Stop Torlink.bat`**, or find the program with `netstat -ano \| findstr :4040`. |
| Engine shows offline / starting forever | Open **Settings → Show recent logs**. Check that antivirus did not quarantine files in `node_modules`, then run setup again. |
| Setup was interrupted | Run **`Setup Torlink.bat`** again. To force a clean dependency install and rebuild, run `Setup Torlink.bat -Force`. |
| Windows blocks the `.vbs` file | Right-click the file → **Properties** → check **Unblock**, or use the Desktop shortcut created by setup. |
| I moved the folder | Run **`Setup Torlink.bat`** once so the shortcuts point to the new location. |

### Updating and uninstalling

- **Update:** close Torlink, replace the app files with the new version (keep
  your `.runtime` folder if you want to reuse the Node runtime), then run
  **`Setup Torlink.bat`**.
- **Uninstall:** run **`Stop Torlink.bat`**, delete the Torlink folder, then
  delete the Desktop and Start Menu shortcuts. Optionally delete
  `%APPDATA%\torlink-gui` and your downloads folder.

## macOS

The macOS launcher still works exactly as before.

- **`Torlink.app`** — double-click it (or drag it to `/Applications` / your
  Dock). It installs/builds if needed, starts the server hidden, and opens your
  browser. Re-run `bash make-app.sh` if you move the project folder.
- **`launch.command`** — double-click for a Terminal window with the live log;
  close it or press Ctrl-C to stop the server.
- **`launch.sh`** — the headless launcher used by `Torlink.app`.

Node.js **22 or newer** is required. The launchers install missing dependencies
(including the local `torlnk` package) and rebuild the interface when it is
stale. If Node is missing or too old, they show a clear message with the
nodejs.org link.

macOS locations:

- Settings: `~/Library/Application Support/torlink-gui/settings.json`
- Default downloads: `~/Downloads/torlink`
- Headless log: `$TMPDIR/torlink-gui.log`

## Linux

Use Node.js 22 or newer:

```bash
npm install
npm run build
npm start
```

Open <http://127.0.0.1:4040>. The folder picker uses `zenity` or `kdialog` when
available. Settings are stored in `~/.config/torlink-gui/settings.json`.

## Command line and development

```bash
npm install       # install dependencies (includes the torlnk engine)
npm start         # API + built interface on http://127.0.0.1:4040
npm run dev       # API on :4040 + Vite hot reload on http://127.0.0.1:5173
npm run build     # build the interface into dist/
npm test          # unit tests
```

`torlnk` is installed as a normal dependency, so the app does not depend on an
npx cache. If you prefer a different engine build, set `TORLINK_BIN` to its
`dist/cli.cjs` path.

Useful environment variables:

| Variable | Purpose |
| --- | --- |
| `TORLINK_GUI_PORT` | Change the app port (default `4040`) |
| `TORLINK_BIN` | Use a specific `torlnk` `cli.cjs` |
| `TORLINK_NODE` | Use a specific Node.js executable |

## What you can do

- **Search** — one query hits every source at once, with results deduped and
  sorted by seeders. Filter by Movies / TV / Anime / Games, or leave the box
  empty and press **Browse** for the latest releases.
- **Download** — click Download on a result, or paste a magnet link / info hash
  with **Add magnet**.
- **Downloads** — live progress, speed, peers; pause, resume, or delete.
- **Seeds** — see what you are sharing; stop seeding or remove torrents.
- **Files** — browse finished files and stream them in the browser. Range
  requests pass through, so video seeking works and long movies do not time
  out.
- **Settings** — choose and browse to a download folder, open it in Explorer /
  Finder, see engine and platform status, view recent engine logs, restart the
  engine, or quit the app.

## How it fits together

```
Browser (React)
      |
      v
server/index.js (Express, 127.0.0.1:4040)
      |-- /api/search    in-process, same sources as the CLI
      |-- /api/add|downloads|control  -> torlnk serve (127.0.0.1:9161)
      |-- /files/*       -> torlnk files (127.0.0.1:9160)
      '-- /api/settings|open-folder|browse-folder|shutdown|logs
```

On startup the server launches the engine automatically. If the engine exits
unexpectedly it is restarted a few times. If you already run `torlnk serve`
yourself, the app connects to it instead of starting a second copy.

The local API checks the `Host` header and an allow-list of local `Origin`
values, so other websites cannot drive your downloads or shut the app down.

## Project scripts

| File | Purpose |
| --- | --- |
| `Torlink.vbs` | Silent Windows entry point; runs setup on first launch |
| `Setup Torlink.bat` | Visible Windows setup and shortcut creation |
| `Start Torlink.bat` | Windows launcher with a visible console log |
| `Stop Torlink.bat` | Stops the server, engine, and leftover processes |
| `scripts/setup-windows.ps1` | Portable Node download, `npm install`, build, shortcuts |
| `scripts/launch-windows.ps1` | Health check, background launch, browser open |
| `scripts/stop-windows.ps1` | Graceful shutdown plus process-tree cleanup |
| `launch.sh` / `launch.command` | Headless / visible macOS launchers |
| `make-app.sh` | Rebuilds `Torlink.app` for macOS |

<!-- Made by Ulug'bek -->
