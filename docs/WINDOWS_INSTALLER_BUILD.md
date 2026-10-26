# Windows Installer — Build, Install, Update

How the Bloom Cafe POS installer is built, what it does on the café laptop, and how it is verified.
Everything here matches `package.json` → `"build"` (electron-builder 24.13.3, NSIS 3.0.4.1).

---

## At a glance

| | |
|---|---|
| File | `dist/Bloom-Cafe-POS-Setup-<version>.exe` (about 74 MB) |
| Type | NSIS assisted installer (wizard), Windows 10/11 **x64** |
| Installs to | `%LOCALAPPDATA%\Programs\Bloom Cafe POS\` (per user, **no administrator needed**) |
| App data | `%APPDATA%\bloom-cafe-pos\` — never touched by install, update or uninstall |
| Shortcuts | Desktop + Start menu, both named **Bloom Cafe POS** |
| Add/Remove Programs | "Bloom Cafe POS 1.3.0", publisher Ayush Kaushik, Bloom Cafe logo |
| Code signing | None — SmartScreen may say "Windows protected your PC" → **More info → Run anyway** |
| Registry id | `3186cf90-cde4-54e2-a777-cb2654a587ae` (UUIDv5 of appId `com.bloomcafe.pos`; never change the appId or upgrades stop finding the old install) |

---

## Building

### On GitHub (normal way)

`.github/workflows/build-windows.yml`, on every push to `main`, every pull request and manual runs:

| Job | Runner | What it does |
|---|---|---|
| `build-windows` | windows-latest | `npm ci` → `electron-rebuild` → `npm test` → `npm run test:e2e` → `npm run dist:win` → SHA-256 → uploads artifact **Bloom-Cafe-POS-Windows-Setup** (installer + `SHA256SUMS.txt`, kept 30 days) |
| `client-install` | windows-latest | Recreates the café laptop: a git folder (with a space in its path) that still has the **v1.2.x `UPDATE.bat`**, one commit behind. Runs that `UPDATE.bat`, which hands over to the new `UPDATE.bat` → `INSTALL.bat` (npm ci, build, backup, silent install). Then `build/ci/check-install.ps1` checks the install location, the registry values `INSTALL.bat` reads, the shortcuts, that the installed app creates its database in `%APPDATA%\bloom-cafe-pos`, `BACKUP-DATA.bat /auto`, a silent re-install while the app is open, and a silent uninstall that keeps the data. Logs are uploaded as **client-install-logs**. |
| `release` | ubuntu-latest | Only for tags `v*`, after both jobs pass: creates the GitHub Release with the installer + `SHA256SUMS.txt`, notes taken from the matching `CHANGELOG.md` section. |

To release: bump `"version"` in `package.json`, add `## [x.y.z] — <date>` to `CHANGELOG.md`, merge, then
`git tag v1.3.0 && git push origin v1.3.0`. The build stops if the tag and `package.json` disagree.
A tag with a `-` (e.g. `v1.4.0-beta.1`) is published as a pre-release.

electron-builder never publishes by itself: `"publish": null` in the config and `--publish=never` in the
scripts (otherwise it auto-uploads on CI tag builds).

### On a Windows PC

```bat
npm ci
npm run dist:win     :: -> dist\Bloom-Cafe-POS-Setup-<version>.exe (+ dist\win-unpacked\)
npm run pack         :: unpacked app only, for a quick look
```

`npm ci` runs `electron-builder install-app-deps` (postinstall) so `better-sqlite3` is built for Electron 28,
and `dist:win` rebuilds it again for the target. `INSTALL.bat` does exactly this for the client.

### On macOS / Linux (inspection only — never ship this)

The native `better_sqlite3.node` in `node_modules` is for the build machine, so a Windows build made here
would not run. It is still useful to check the configuration and the package layout:

```bash
npx electron-builder --win --dir -c.npmRebuild=false -c.win.signAndEditExecutable=false \
  -c.directories.output=/tmp/pos-pack
npx asar list /tmp/pos-pack/win-unpacked/resources/app.asar
```

(`--dir` needs no wine. A full NSIS build on Linux also needs wine to extract the uninstaller.)

---

## What ends up in the installed app

Verified by packaging this config (`resources\` of the installed folder):

| Where | Contents |
|---|---|
| `app.asar` (≈1.4 MB) | `src/**`, `config/**`, `assets/**`, `package.json`, production `node_modules` only (`better-sqlite3`, `bindings`, `electron-is-dev` and their dependencies) |
| `app.asar.unpacked` (≈2 MB) | `node_modules/better-sqlite3/` with `build/Release/better_sqlite3.node` — native modules cannot load from inside an asar |
| `data\` | `menu.json`, `inventory.json` seed files (`extraResources`), copied to `%APPDATA%\bloom-cafe-pos` on first start only |
| not included | `tests/`, `docs/`, `.github/`, `build/`, `Release_Package/`, `*.bat`, devDependencies (Electron, jest, playwright, electron-builder), better-sqlite3 C/C++ sources (`deps/`, `src/`, ~9.8 MB) and build intermediates |

Size, same machine, before → after the 1.3.0 config: installer 79.5 MB → 77.6 MB, `app.asar.unpacked`
11.7 MB → 2.0 MB. (Most of the size is Electron itself, ~250 MB unpacked.)

The packaged `package.json` has no `productName`, so Electron's `userData` stays
`%APPDATA%\bloom-cafe-pos` (from `"name"`). **Do not add a top-level `productName`** — the app would start
looking for its data in `%APPDATA%\Bloom Cafe POS` and appear empty. For the same reason
`electronLanguages` is not used: removing Chromium locales changes the app locale and with it date formats.

---

## What the installer does

**Wizard (double-click):** license (MIT, `build/license.txt`) → "Only for me" (default, no admin) or
"Anyone who uses this computer" (asks for admin) → install folder (can be changed) → install →
finish page with "Run Bloom Cafe POS" ticked.

**Upgrade / reinstall:** if Bloom Cafe POS is running it is closed first (a polite close, then a forced one
after a few seconds; in silent mode without asking). The previous version is uninstalled with
`--updated`, which never deletes app data, then the new files are copied in. The Desktop shortcut is
recreated every time (`createDesktopShortcut: "always"`), even if someone deleted it. An existing
"all users" install is upgraded in place (Windows asks for admin).

**Uninstall** (Settings → Apps, or `Uninstall Bloom Cafe POS.exe`): removes the program and shortcuts and
**keeps `%APPDATA%\bloom-cafe-pos`** (`deleteAppDataOnUninstall: false`).

### Command line

| Command | Effect |
|---|---|
| `Bloom-Cafe-POS-Setup-1.3.0.exe /S` | silent install / upgrade (what `INSTALL.bat` uses) |
| `... /S /D=C:\POS\Bloom Cafe POS` | silent install to a folder (`/D=` must be last, no quotes) |
| `... /currentuser` or `/allusers` | force per-user / all-users mode |
| `... /S --force-run` | silent install, then start the app |
| `"%LOCALAPPDATA%\Programs\Bloom Cafe POS\Uninstall Bloom Cafe POS.exe" /S` | silent uninstall, data kept |
| uninstaller with `--delete-app-data` | **also deletes all sales data** — never use on the café laptop |

Exit code 0 = success. A silent upgrade of an all-users install re-launches itself elevated, and the
first process's exit code does not reliably reflect the elevated part (declining the Windows prompt also
exits 0) — which is why `INSTALL.bat` checks the installed version itself (below).

### Registry (written by the installer, read by `INSTALL.bat`)

| Key (HKCU for per-user, HKLM for all users) | Value |
|---|---|
| `Software\3186cf90-cde4-54e2-a777-cb2654a587ae` | `InstallLocation` |
| `Software\Microsoft\Windows\CurrentVersion\Uninstall\3186cf90-cde4-54e2-a777-cb2654a587ae` | `DisplayVersion`, `DisplayName`, `Publisher`, `UninstallString`, `QuietUninstallString` |

---

## The helper scripts (repo root, CRLF, plain ASCII)

**`INSTALL.bat`** — 1) Node.js ≥ 20 or installs Node.js 22 with winget (falls back to the LTS package),
2) `npm ci` (one automatic retry), 3) `npm run dist:win` (one retry), 4) closes a running
`Bloom Cafe POS.exe` politely then forcibly, runs `BACKUP-DATA.bat /auto`, runs the installer with `/S`
and checks its exit code, 5) finds the installed exe (registry `InstallLocation` HKCU → HKLM, then
`%LOCALAPPDATA%\Programs\Bloom Cafe POS`, `%ProgramFiles%\Bloom Cafe POS`, and the old
`%LOCALAPPDATA%\Programs\bloom-cafe-pos`), checks that `DisplayVersion` equals `package.json`'s version,
and opens the app. Every step goes to `install.log` (previous run: `install.previous.log`); failures are
explained in plain words (no internet, a locked file / antivirus, disk full, out-of-sync project).
`INSTALL.bat /nopause` skips the final key press.

**`UPDATE.bat`** — copies itself to `%TEMP%` and runs from there (the update may replace `UPDATE.bat`
itself), `git fetch`, keeps hand-edited files aside with `git stash push --include-untracked`,
`git merge --ff-only @{u}` (stops without changing anything if the folder has its own commits), then
calls `INSTALL.bat`. Git output goes to `update.log`. Line 2 is a long line of `:` on purpose: the v1.2.x
`UPDATE.bat` keeps reading the *new* file at byte 119 after its `git pull`; landing anywhere in that line is
a harmless label, so old installs update themselves correctly. Do not remove or shorten it.

**`BACKUP-DATA.bat`** — copies `%APPDATA%\bloom-cafe-pos` (minus browser caches and locked Chromium
files) to `Desktop\Bloom Cafe POS Backups\<yyyy-MM-dd_HH-mm-ss>\` with a `HOW-TO-RESTORE.txt`.
The live database is only copied while the app is closed: `/auto` closes it, a double-click asks. If the
user keeps it open, the live `bloom-cafe.db*` files are skipped and the backup relies on the app's own
verified snapshots in `backups\` (the note in `HOW-TO-RESTORE.txt` says which file to restore).
Desktop backups are never deleted automatically.

---

## Files

| File | Purpose |
|---|---|
| `build/icon.ico` | App, installer, uninstaller and shortcut icon: 16/24/32/48/64/128 px BMP + 256 px PNG, made from `assets/icons/favicon.ico` (16/32/48) and `assets/icons/favicon-256.ico`. (`assets/icons/icon-256.ico`, used before 1.3.0, is a plain orange square.) |
| `build/license.txt` | License page text (copy of `LICENSE`, CRLF — NSIS needs DOS line endings; enforced in `.gitattributes`) |
| `build/ci/prepare-legacy-client.ps1` | CI: builds the "café laptop with v1.2.x UPDATE.bat" folder |
| `build/ci/check-install.ps1` | CI: post-install / upgrade / uninstall checks |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Windows protected your PC" | Not signed. **More info → Run anyway**. |
| "Bloom Cafe POS cannot be closed" during setup | Close it from the taskbar (or Task Manager) and click Retry. |
| `INSTALL.bat` failed | Read the message in the window; details in `install.log` next to it. Send that file to support. |
| App shows an empty menu / no sales after an update | Check `%APPDATA%\bloom-cafe-pos\bloom-cafe.db` exists. Restore from `Desktop\Bloom Cafe POS Backups\…` (see `HOW-TO-RESTORE.txt`) or from `%APPDATA%\bloom-cafe-pos\backups\`. |
| `NODE_MODULE_VERSION` error when running from source | `npm run rebuild` (rebuilds better-sqlite3 for Electron). |
| `EPERM` / `EBUSY` during `npm ci` or the build | Antivirus or another window holds a file. Restart the laptop and run `INSTALL.bat` again. |
