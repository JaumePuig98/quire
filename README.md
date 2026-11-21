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

Needs [Node.js](https://nodejs.org) 20 or newer. `npm test` runs the automated tests.

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
| Reading mode (read-only, notes in the margin) | Ctrl+R |
| Review mode (typos and notes, nothing slides) | Ctrl+Shift+R |
| Writing, review or reading mode from the menu | hover **Mode** in the top bar |
| Chapters panel | Ctrl+Shift+O |
| Next / previous chapter | Ctrl+PageDown / Ctrl+PageUp |
| New / open / save / save as | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Export | Ctrl+E |
| Show or hide the formatting bar | Ctrl+/ |
| Settings | Ctrl+, |
| Full screen | F11 |

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
**Settings, Caret centering**: *Off*; *Soft* (default: the caret may wander a little, then the line glides back to the middle);
*Strict* (the caret never leaves the middle).

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
* **Open** also reads `.md` and `.txt` files (imported as a new, unsaved document).
* **Export** to Word (`.docx`), PDF, Markdown or plain text. Notes can be included: they become real comments in Word and
  numbered notes elsewhere. Text is justified (setting) except quotes.
* PDF and Word are A4 with 2.5 cm margins. Chapters start on a new page, headings stay with the paragraph that follows,
  paragraphs avoid single stranded lines, quotes are not split, and the PDF has page numbers.

## Settings

Short menu: theme (auto, light, dark), accent color (six soft colors), font (serif or sans), justify text.
Sliders step aside while you drag them: the menu fades out and the page shows the change live.
**More settings** adds text weight (light to medium), text size, column width, height of the writing line, typewriter scrolling, caret centering, formatting bar,
fading of earlier text, the soft light, typewriter sounds, an optional daily word goal and an optional book target
(both off by default), automatic updates and the spellcheck language.

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
renderer/          the writing interface (index.html, style.css, app.js, fonts/)
test/run.js        automated tests:  npm test
test/pdf-test.js   PDF check:  npx electron test/pdf-test.js
to_delete/         (ignored by git) things waiting to be deleted by hand
scratch/           (ignored by git) local scratch files
```

Fonts (bundled variable fonts, so everything looks the same on every PC and the weight can be set smoothly): Source Serif 4 and Inter, both SIL Open Font License.
