# Quire

A distraction-free writing app for Windows, built for long work like books.
The line you are writing stays in one place, low and centered on the screen, like paper
feeding through a typewriter. Everything else stays out of the way.

## Run it

```
npm install
npm start
```

Needs [Node.js](https://nodejs.org) 20 or newer.

## Build the Windows installer

Locally: `npm run dist` (creates an installer and a portable `.exe` in `dist/`).

On GitHub: push this folder to a repo, then tag a version:

```
git tag v0.1.0
git push origin v0.1.0
```

The workflow in `.github/workflows/build-windows.yml` builds the installer and attaches it to a GitHub
release. You can also run it by hand from the repo's **Actions** tab.

## Writing

| Action | Shortcut |
|---|---|
| Bold / italic / underline | Ctrl+B / Ctrl+I / Ctrl+U |
| Heading 1 / heading 2 / normal text | Ctrl+1 / Ctrl+2 / Ctrl+0 |
| Quote | Ctrl+Shift+Q |
| Add or edit a note on selected text | Ctrl+Alt+M |
| Reading mode (read-only, notes in the margin) | Ctrl+R |
| Chapters panel | Ctrl+Shift+O |
| Next / previous chapter | Ctrl+PageDown / Ctrl+PageUp |
| New / open / save | Ctrl+N / Ctrl+O / Ctrl+S |
| Save a new version (`title_v2.draft`, no questions asked) | Ctrl+Shift+S |
| Save as (pick a name) | Ctrl+Alt+S |
| Export | Ctrl+E |
| Settings | Ctrl+, |
| Full screen | F11 |

Move the mouse to show the menu bar. It hides again while you type. The formatting bar at the bottom is always visible.

Settings: light/dark/automatic theme, serif or sans font, text size, column width, the height of the writing line,
typewriter scrolling, fading of earlier text, the soft light, typewriter sounds, and an optional daily word goal (off by default).

## File names and versions

- **Export** (Word, PDF, Markdown, text) suggests your main title as the file name; you can edit it in the dialog.
- **.draft files** are named from the title: `my-great-novel_v1.draft`. Ctrl+S saves in place. The **Version** button (Ctrl+Shift+S) writes the next file, `_v2`, `_v3`, ... next to it without asking, and you keep writing in the new one. Older versions stay untouched.
- Set the title in the Chapters panel (the Title field).

## Settings worth knowing

- **Keep the caret centered**: the line you are writing slides sideways so the caret stays in the middle; the paragraphs above do not move. On by default.
- **Accent color**: six soft colors (Amber, Rose, Sage, Ocean, Plum, Slate).
- In a narrow window the shortcut hints in the bottom bar are hidden to save space.

## Files

* Working files are **`.draft`** files: plain, readable JSON with one paragraph per line, so Git shows clean diffs.
  They hold the text, formatting, chapters and notes. Every file starts with `"format": "draft"` and a version number so that
  newer versions of the app can always open older files.
* While you write, the app saves automatically: to your file once it has a name, otherwise to a recovery copy that is restored
  the next time you start the app. About every ten minutes it also keeps a snapshot (last 30) under **History**.
* **Open** also reads `.md` and `.txt` files (imported as a new, unsaved document).
* **Export** to Word (`.docx`), PDF, Markdown or plain text. Notes can be included: they become real comments in Word and
  numbered notes or footnotes elsewhere.
* PDF and Word are A4 with 2.5 cm margins. Chapters start on a new page, headings stay with the paragraph that follows,
  paragraphs avoid single stranded lines, quotes are not split, and the PDF has page numbers.

## Renaming

The product name and the file extension are separate things on purpose.

* Name shown to the user: `productName` in `package.json` (twice), `<title>` in `renderer/index.html`,
  `title` in `main.js` and the window title in `renderer/app.js`.
* Keep `appId` (`app.writingapp.editor`) unchanged so the installer keeps treating new versions as an update.
  Electron stores settings in a folder named after `productName` (`%APPDATA%\Quire`); if you rename the app later,
  add `app.setName('Quire')` at the top of `main.js` to keep using that folder.
* The icon is `build/icon.svg` (source), `build/icon.ico` (installer and taskbar) and `renderer/icon.png` (window).
* The GitHub repository can be renamed at any time; GitHub redirects the old address.

## Project layout

```
main.js            window, files, autosave, history, export dialogs
preload.js         the safe bridge between the window and main.js
exporters.js       Word and PDF export
shared/doc.js      the .draft format, Markdown and plain-text conversion
renderer/          the writing interface (index.html, style.css, app.js, fonts/)
test/run.js        automated tests:  npm test
test/pdf-test.js   PDF check:  npx electron test/pdf-test.js
```

Fonts (bundled, so everything looks the same on every PC): Source Serif 4 and Inter, both SIL Open Font License.
