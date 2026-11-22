# Developing Quire

Notes for working on the app itself. For using it, see [README.md](README.md).

## Run from source

```
npm install
npm start
```

Needs [Node.js](https://nodejs.org) 20 or newer.

## Tests

* `npm test`: quick tests (format, export).
* `npm run test:e2e`: starts the real app and drives it like a person. On Linux without a screen: `xvfb-run -a npm run test:e2e`.
* `npx electron test/pdf-test.js --no-sandbox`: PDF check.

Both `npm test` and the end-to-end tests run on every push and pull request (`.github/workflows/test.yml`).

## Release a new version

1. Change `version` in `package.json` (for example `1.0.1`), commit and push to `main`.
2. Tag and push the tag:

```
git tag v1.0.1
git push origin v1.0.1
```

The workflow in `.github/workflows/build-windows.yml` runs on any tag starting with `v`. It runs the tests, builds the installers and publishes them as a GitHub release. Installed copies pick the release up on their own.

Things that must be true for this to work:

* The tag was pushed (`git ls-remote --tags origin` lists it).
* The repository is **public**, otherwise nobody else can download or auto-update.
* Settings, Actions, General, Workflow permissions is set to **Read and write permissions**, so the workflow can create the release.
* The run under the **Actions** tab is green. If it is red, open it and read the failing step.

Auto-update reads the releases of this repository.

## Renaming

The product name and the file extension are separate things on purpose.

* Name shown to the user: `productName` in `package.json` (twice), `<title>` in `renderer/index.html`, `title` in `main.js` and the window title in `renderer/app.js`.
* Keep `appId` (`app.writingapp.editor`) unchanged so the installer treats new versions as an update. Electron stores settings in a folder named after `productName` (`%APPDATA%\Quire`); if you rename the app later, add `app.setName('Quire')` at the top of `main.js` to keep using that folder.
* The icon is `build/icon.svg` (source), `build/icon.ico` (installer and taskbar) and `renderer/icon.png` (window).
* The repository can be renamed at any time; GitHub redirects the old address. Update `repository` and the `publish` section in `package.json` if you do.

## Project layout

```
main.js            window, files, autosave, history, updates, export dialogs
preload.js         the safe bridge between the window and main.js
exporters.js       Word and PDF export
docx-import.js     reads Word files into the document model
shared/doc.js      the .draft format, validation, Markdown and plain-text conversion
renderer/          the writing interface (index.html, style.css, app.js, filebrowser.js, fonts/)
test/run.js        quick tests (format, export):  npm test
test/e2e.js        drives the real app:  npm run test:e2e
test/pdf-test.js   PDF check
exporter-fonts/    static copies of the fonts, embedded into Word files
docs/              screenshots used by the README
to_delete/         (ignored by git) things waiting to be deleted by hand
scratch/           (ignored by git) local scratch files
```

## Format notes

* `.draft` is JSON with one paragraph per line, so Git diffs stay clean. Every file starts with `"format": "draft"` and a version number so newer versions can open older files. Damaged files are repaired as far as possible on open.
* History belongs to the document id, not the file path, so it survives renaming or moving the file. Named versions are stored as `<iso>~<name>.draft` and are never pruned.
* Exports use their own standard spacing, independent of the on-screen spacing settings.
* Chromium ignores `counter-reset: page`, so the PDF title page is printed separately and merged with `pdf-lib`.
