# Quire

A distraction-free writing app for Windows, built for long work like books.
The line you are writing stays in one place, low on the screen, like paper feeding through a typewriter.
Everything else stays out of the way.

## Install (for you and for friends)

Download the installer from the repository's **Releases** page:

* **`Quire-Setup-x.y.z.exe`**: one installer for every Windows PC (Intel/AMD and ARM, such as a Surface Pro X).
* **`Quire-Portable-x.y.z-x64.exe` / `-arm64.exe`**: runs without installing; does not update itself.

**Windows will warn you the first time.** Quire is not code-signed (a signing certificate costs money and is not worth it for a
small project), so Windows SmartScreen shows "Windows protected your PC". Click **More info**, then **Run anyway**.
The warning is about the missing signature, not about anything found in the file.

The installed version checks for a new release when it starts, downloads it quietly, and installs it the next time you close
Quire. You can turn this off in Settings (More settings). The portable version never updates itself.

## Run from source

```
npm install
npm start
```

Needs [Node.js](https://nodejs.org) 20 or newer. `npm test` runs the quick tests; `npm run test:e2e` starts the real app and drives it like a person (on Linux without a screen: `xvfb-run -a npm run test:e2e`). Both run on every push.

## Release a new version

1. Change `version` in `package.json` (for example `0.2.1`), commit and push.
2. Tag and push the tag:

```
git tag v0.2.1
git push origin v0.2.1
```

The workflow in `.github/workflows/build-windows.yml` runs the tests, builds the installers and publishes them as a GitHub
release. Installed copies pick the release up on their own. Every push and pull request also runs the tests
(`.github/workflows/test.yml`).

Auto-update reads the releases of this repository, so the repository has to be **public** for other people's copies to update
(or for them to download anything). If it is private, share the installer file by hand and turn updates off.

## Writing

| Action | Shortcut |
|---|---|
| Bold / italic / underline | Ctrl+B / Ctrl+I / Ctrl+U |
| Heading 1 / heading 2 / normal text | Ctrl+1 / Ctrl+2 / Ctrl+0 (press again to turn off) |
| Quote | Ctrl+Shift+Q (press again to turn off) |
| Add or edit a note on selected text | Ctrl+Alt+M |
| Undo / redo (each chapter keeps its own) | Ctrl+Z / Ctrl+Y |
| Find / find and replace | Ctrl+F / Ctrl+H (F3 = next match) |
| Writing, review or reading mode | hover **Mode** in the top bar |
| Chapters panel | Ctrl+Shift+O |
| Next / previous chapter | Ctrl+PageDown / Ctrl+PageUp |
| New / open / save / save as | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Export | Ctrl+E |
| Show or hide the formatting bar | Ctrl+/ |
| Settings | Ctrl+, |
| Full screen | F11 |
| Open the top bar with the keyboard | F10 (then Tab and Enter; arrow keys in the Mode menu) |

Move the mouse to show the menu bar; it hides again while you type. The formatting bar at the bottom can be hidden with the
small button beside it (or Ctrl+/) once you know the shortcuts.

### Markdown while you type

`# ` at the start of a line makes a heading, `## ` a sub-heading, `> ` a quote. `**bold**`, `*italic*` and `_italic_`
convert when you type the closing mark.

### Quotes

Quotes are set like an epigraph in a book: narrower, a little smaller and to the right. Enter keeps writing in the quote;
Enter on an empty line, or after the author line, leaves it. A quote line that starts with a dash is the **author**: upright,
right-aligned.

### The typewriter line

The line you are writing slides sideways so the caret stays near the middle of the screen, and only while you are **adding
new text** at the end of a paragraph. Moving around or editing in the middle of older text never moves anything.
**Settings, Caret centering**: *Off*; *Centered* (default: the caret never leaves the middle, the text moves under it);
*Soft* (the caret may wander a little, then the line glides back to the middle).

### Review mode

For proof-reading: nothing slides or fades, typos and notes stand out more. Spelling mistakes are underlined quietly while you
write and clearly in review mode. Choose the spellcheck language under Settings, More settings.

### Notes

Select text and press Ctrl+Alt+M. A small note icon appears in the right margin beside the first line of the passage: click it
to open or close the note, or hover the icon or the passage to read it.

## Files

* Working files are **`.draft`** files: plain, readable JSON with one paragraph per line, so Git shows clean diffs.
  They hold the text, formatting, chapters and notes, and an id that ties the file to its history.
  Every file starts with `"format": "draft"` and a version number so newer versions of the app can always open older files.
  Damaged files are repaired as far as possible when opened instead of crashing the app.
* **File names**: a new file is suggested as a simplified form of your title (`my-great-novel.draft`); **Export** suggests the
  title itself. Set the title in the Chapters panel.
* **Saving**: Ctrl+S saves in place (it asks only the first time). While you write the app also saves automatically, to your file
  once it has a name, otherwise to a recovery copy that is restored the next time you start the app.
* **History** keeps snapshots of the document every few minutes (the last 60) and also keeps what was there before any save that
  removes a lot of text. History belongs to the document, so it survives renaming or moving the file. *Save as* gives the copy its
  own history. Open an old snapshot from **History**; it opens as a new document.
* **Save, Open and Export** use Quire's own file browser (places, folders, a new-folder button). A small link in it switches to the standard Windows dialog if you prefer that.
* **Changes from outside**: if another program (git, OneDrive, Dropbox) changes the open file, Quire never overwrites it silently. A document with no unsaved writing reloads by itself; with unsaved writing it asks: keep mine, load theirs, or save mine as a copy. The version you do not keep goes into History first.
* **Open** also reads `.md` and `.txt` files (imported as a new, unsaved document).
* **Export** to Word (`.docx`), PDF, Markdown or plain text. Word files carry their own copy of the font (Literata, Nunito or Courier Prime), so they look the same on any PC. Notes can be included: they become real comments in Word and
  numbered notes elsewhere. Text is justified (setting) except quotes.
* PDF and Word are A4 with 2.5 cm margins. Chapters start on a new page, headings stay with the paragraph that follows,
  paragraphs avoid single stranded lines, quotes are not split, and the PDF has page numbers.

## Settings

**Settings** opens a page of its own with sections on the left: Appearance (theme, accent color, font, justified text, formatting bar), Page (text weight, size, column width), Writing line (typewriter scrolling, line position, caret centering, fading, soft light), Goals (daily word goal and book target, both off by default) and Language (spellcheck languages, automatic updates).

Sliders step aside while you drag them: the page fades out and the text shows the change live. Every slider has a number you can type, and a small arrow to put it back to its default; **Reset all** restores everything. Settings are kept between sessions.

**Reading mode** (Mode menu) can show just the current chapter or the whole book; the choice is in the bar at the bottom. In the whole-book view the chapter changes as you scroll, so Back to writing returns to where you were.

## Renaming

The product name and the file extension are separate things on purpose.

* Name shown to the user: `productName` in `package.json` (twice), `<title>` in `renderer/index.html`,
  `title` in `main.js` and the window title in `renderer/app.js`.
* Keep `appId` (`app.writingapp.editor`) unchanged so the installer keeps treating new versions as an update.
  Electron stores settings in a folder named after `productName` (`%APPDATA%\Quire`); if you rename the app later,
  add `app.setName('Quire')` at the top of `main.js` to keep using that folder.
* The icon is `build/icon.svg` (source), `build/icon.ico` (installer and taskbar) and `renderer/icon.png` (window).
* The GitHub repository can be renamed at any time; GitHub redirects the old address. Update `repository` and the `publish`
  section in `package.json` if you do.

## Project layout

```
main.js            window, files, autosave, history, updates, export dialogs
preload.js         the safe bridge between the window and main.js
exporters.js       Word and PDF export
shared/doc.js      the .draft format, validation, Markdown and plain-text conversion
renderer/          the writing interface (index.html, style.css, app.js, filebrowser.js, fonts/)
test/run.js        quick tests (format, export):  npm test
test/e2e.js        drives the real app:  npm run test:e2e
exporter-fonts/    static copies of the fonts, embedded into Word files
test/pdf-test.js   PDF check:  npx electron test/pdf-test.js
to_delete/         (ignored by git) things waiting to be deleted by hand
scratch/           (ignored by git) local scratch files
```

Fonts (bundled variable fonts, so everything looks the same on every PC and the weight can be set smoothly): Literata, Nunito and Courier Prime for writing, Inter for the menus, all SIL Open Font License.
