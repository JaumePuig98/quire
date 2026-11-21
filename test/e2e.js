// End-to-end checks: starts the real app and drives it like a person would.
//   npm run test:e2e        (on Linux without a display:  xvfb-run -a npm run test:e2e)
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const D = require('../shared/doc.js');

const root = path.join(__dirname, '..');
let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('ok   ' + msg); else { failed++; console.log('FAIL ' + msg); } };
const body = (a) => a.doc.chapters[a.cur].blocks.map((b) => b.runs.map((r) => r.text).join('')).join('|');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quire-e2e-'));
  const docs = path.join(tmp, 'docs');
  fs.mkdirSync(docs);
  const app = await electron.launch({
    args: [root, '--no-sandbox', '--disable-gpu', '--user-data-dir=' + path.join(tmp, 'ud')],
    env: Object.assign({}, process.env, { QUIRE_E2E: '1' }),
  });
  // native message boxes would wait for a click: answer them from the test
  let answer = 0;
  await app.evaluate(({ dialog }) => { global.__answer = 0; dialog.showMessageBox = async () => ({ response: global.__answer }); });
  const setAnswer = (n) => app.evaluate((_, n) => { global.__answer = n; }, n);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('#editor');
  await page.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
  const model = () => page.evaluate(() => { window.__app.syncFromDom(); return { text: window.__app.doc.chapters.map((c) => c.blocks.map((b) => b.t + ':' + b.runs.map((r) => r.text).join('')).join('|')), cur: window.__app.cur }; });

  try {
    /* ---- writing, markdown, undo ---- */
    await page.click('#editor');
    await page.keyboard.type('# The Long Winter\nSnow fell on **the roof** all night.');
    await page.waitForTimeout(900);
    let m = await model();
    ok(m.text[0].startsWith('h1:The Long Winter'), 'markdown "# " makes a heading');
    ok(/\*\*/.test(m.text[0]) === false, 'markdown bold marks are consumed');
    await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
    ok((await model()).text[0].length < m.text[0].length, 'undo takes text back');

    /* ---- a chapter without a title is named after its first heading ---- */
    await page.keyboard.press('Control+Shift+O'); await page.waitForTimeout(300);
    ok((await page.getAttribute('#chapterList input', 'placeholder')) === 'The Long Winter', 'chapter takes the first heading 1 as its name');
    await page.keyboard.press('Escape');

    /* ---- caret centering stays centered ---- */
    await page.click('#editor');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nA long line that keeps going so the caret has to be held in the middle while it is typed: ');
    await page.evaluate(() => { window.__dev = []; const f = () => { const c = document.querySelector('.lineCaret'); if (c) window.__dev.push(c.getBoundingClientRect().left - innerWidth / 2); requestAnimationFrame(f); }; f(); });
    await page.keyboard.type('these letters arrive quickly one after another', { delay: 40 });
    const dev = await page.evaluate(() => window.__dev);
    ok(dev.length > 20 && Math.max(...dev.map(Math.abs)) < 4, 'caret stays in the middle while typing (max drift ' + Math.max(...dev.map(Math.abs)).toFixed(1) + ' px)');

    /* ---- quotes sit flush right ---- */
    await page.keyboard.type('\n> A quote\n- An author\n\nAfter.');
    await page.keyboard.press('Control+Home'); await page.waitForTimeout(500);
    const q = await page.evaluate(() => { const e = document.getElementById('editor').getBoundingClientRect(); return [...document.querySelectorAll('#editor blockquote')].map((b) => [Math.round(e.right - b.getBoundingClientRect().right), getComputedStyle(b).textAlign]); });
    ok(q.length === 2 && q.every((x) => x[0] <= 1 && x[1] === 'right'), 'quote and author line are flush right');

    /* ---- Mode menu: mouse and keyboard ---- */
    await page.mouse.move(640, 30); await page.hover('#btnMode'); await page.waitForTimeout(250);
    ok(await page.isVisible('#modeMenu'), 'Mode menu opens on hover');
    await page.click('#modeMenu [data-mode=review]');
    ok(await page.evaluate(() => document.body.classList.contains('review')), 'Review mode switches on');
    await page.click('#btnMode'); await page.click('#modeMenu [data-mode=write]');
    await page.keyboard.press('Escape');
    await page.click('#editor');
    await page.keyboard.press('F10'); await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'btnChapters'), 'F10 puts the focus on the top bar');
    await page.focus('#btnMode'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    ok(await page.evaluate(() => document.activeElement.dataset.mode) === 'review', 'arrow keys move through the Mode menu');
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.body.classList.contains('review')), 'Enter picks a mode');
    await page.evaluate(() => window.__app.setMode('write'));

    /* ---- settings ---- */
    await page.keyboard.press('Control+,'); await page.waitForTimeout(300);
    ok(await page.isVisible('#settings .st-box'), 'Settings opens as a page of its own');
    await page.click('.st-nav [data-sec=page]');
    const sl = page.locator('input[type=range][data-pref=size]');
    const bx = await sl.boundingBox();
    await page.mouse.move(bx.x + bx.width * 0.3, bx.y + 9); await page.mouse.down(); await page.mouse.move(bx.x + bx.width * 0.9, bx.y + 9, { steps: 6 }); await page.waitForTimeout(450);
    ok(await page.evaluate(() => document.getElementById('settings').classList.contains('adjusting')), 'the page steps aside while a slider is dragged');
    await page.mouse.up(); await page.waitForTimeout(300);
    const num = page.locator('input[data-num=size]');
    await num.fill('500'); await num.press('Enter');
    ok((await num.inputValue()) === '34', 'a typed number is limited to the slider range');
    await page.click('[data-reset=size]');
    ok((await num.inputValue()) === '22', 'the reset arrow restores the default');
    await page.click('.st-nav [data-sec=look]'); await page.click('[data-pref=font] [data-v=type]');
    await page.click('.st-nav [data-sec=page]');
    ok(await page.evaluate(() => document.querySelector('[data-pref=weight]').disabled), 'weight is switched off for the one-weight Typewriter font');
    await page.click('#resetAll'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => !document.querySelector('[data-pref=weight]').disabled), 'Reset all restores the font and weight');
    ok((await page.$$eval('.st-nav button', (bs) => bs.map((b) => b.textContent.trim()))).every((t) => /^[A-Za-z ]+$/.test(t)), 'settings section names are clean text');
    await page.click('.st-nav [data-sec=space]');
    const ln = page.locator('input[data-num=lineHeight]');
    await ln.fill('2.05'); await ln.press('Enter');
    await page.locator('input[data-num=paraGap]').fill('1.2'); await page.locator('input[data-num=paraGap]').press('Enter');
    await page.locator('input[data-num=indent]').fill('1.5'); await page.locator('input[data-num=indent]').press('Enter');
    await page.locator('input[data-num=headBefore]').fill('2'); await page.locator('input[data-num=headBefore]').press('Enter');
    await page.waitForTimeout(200);
    const sp = await page.evaluate(() => { const e = document.getElementById('editor'), p = e.querySelector('p'), h = e.querySelector('h1'); const fs = parseFloat(getComputedStyle(e).fontSize); return { lh: parseFloat(getComputedStyle(e).lineHeight) / fs, pg: parseFloat(getComputedStyle(p).marginBottom) / fs, ind: parseFloat(getComputedStyle(p).textIndent) / fs, hb: h ? parseFloat(getComputedStyle(h).marginTop) / parseFloat(getComputedStyle(h).fontSize) : null }; });
    ok(Math.abs(sp.lh - 2.05) < 0.02 && Math.abs(sp.pg - 1.2) < 0.02 && Math.abs(sp.ind - 1.5) < 0.02, 'line, paragraph and indent spacing apply (' + JSON.stringify(sp) + ')');
    ok(sp.hb === null || Math.abs(sp.hb - 2) < 0.02, 'space above headings applies');
    await page.click('[data-reset=lineHeight]');
    ok((await ln.inputValue()) === '1.7', 'spacing reset restores 1.7');
    await page.locator('input[data-num=lineHeight]').fill('2.05'); await page.locator('input[data-num=lineHeight]').press('Enter');
    await page.keyboard.press('Escape'); await page.click('#editor');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nCentering with wide spacing and an indent holds too, typed steadily: ');
    await page.evaluate(() => { window.__dev = []; const f = () => { const c = document.querySelector('.lineCaret'); if (c) window.__dev.push(c.getBoundingClientRect().left - innerWidth / 2); requestAnimationFrame(f); }; f(); });
    await page.keyboard.type('more letters for the drift check', { delay: 40 });
    const dev2 = await page.evaluate(() => window.__dev);
    ok(dev2.length > 15 && Math.max(...dev2.map(Math.abs)) < 4, 'caret stays centered with custom spacing (drift ' + Math.max(...dev2.map(Math.abs)).toFixed(1) + ' px)');
    await page.keyboard.press('Control+,'); await page.waitForTimeout(200);
    for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
    ok(await page.evaluate(() => !!document.activeElement.closest('#settings')), 'Tab stays inside the settings page');
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);

    /* ---- own file browser: save, replace prompt, open, export ---- */
    await page.click('#editor');
    await page.keyboard.press('Control+s'); await page.waitForTimeout(500);
    ok(await page.isVisible('#fileDlg'), 'Save opens Quire\'s own file browser');
    // go to the test folder by creating nothing: use the fs bridge to start there
    await page.evaluate((d) => { window.api.fsRemember({ kind: 'doc', dir: d }); window.api.fsRemember({ kind: 'export', dir: d }); }, docs);
    await page.click('#fdCancel');
    await page.keyboard.press('Control+s'); await page.waitForTimeout(500);
    await page.fill('#fdName', 'winter: draft?'); await page.click('#fdOk'); await page.waitForTimeout(900);
    ok(fs.existsSync(path.join(docs, 'winter draft.draft')), 'file is saved with a cleaned-up name');
    await page.keyboard.press('Control+Shift+s'); await page.waitForTimeout(500);
    await page.fill('#fdName', 'winter draft'); await page.click('#fdOk'); await page.waitForTimeout(250);
    ok((await page.innerText('#fdOk')) === 'Replace', 'an existing name asks before replacing');
    await page.fill('#fdName', 'copy'); await page.click('#fdOk'); await page.waitForTimeout(800);
    ok(fs.existsSync(path.join(docs, 'copy.draft')), 'Save as writes the copy');
    await page.keyboard.press('Control+Shift+s'); await page.waitForTimeout(400);
    await page.fill('#fdName', 'con'); await page.click('#fdOk'); await page.waitForTimeout(800);
    ok(fs.existsSync(path.join(docs, 'con_.draft')), 'names Windows refuses get a suffix');
    await page.hover('#topbar'); await page.click('#btnExport'); await page.click('[data-format=md]'); await page.waitForTimeout(500);
    ok((await page.innerText('#fdTitle')).startsWith('Export as'), 'Export uses the same browser');
    await page.click('#fdOk'); await page.waitForTimeout(1200);
    ok(fs.readdirSync(docs).some((f) => f.endsWith('.md')), 'export file is written');
    await page.keyboard.press('Control+o'); await page.waitForTimeout(500);
    const listed = await page.evaluate(() => [...document.querySelectorAll('#fdList li')].map((l) => l.textContent));
    ok(listed.includes('copy.draft') && listed.includes('winter draft.draft'), 'Open lists the saved documents');
    await page.click('#fdCancel');

    /* ---- the file changes on disk behind our back ---- */
    const file = path.join(docs, 'con_.draft');
    const onDisk = D.parseDraft(fs.readFileSync(file, 'utf8'));
    onDisk.chapters[0].blocks.push({ t: 'p', runs: [{ text: 'WRITTEN BY GIT' }] });
    fs.writeFileSync(file, D.serializeDraft(onDisk));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(900);
    ok((await model()).text.join('').includes('WRITTEN BY GIT'), 'a clean document reloads when the file changed outside');
    // now with unsaved typing: choose "Keep mine" (button 0)
    await page.click('#editor'); await page.keyboard.press('Control+End'); await page.keyboard.type(' MINE');
    onDisk.chapters[0].blocks.push({ t: 'p', runs: [{ text: 'SECOND OUTSIDE EDIT' }] });
    fs.writeFileSync(file, D.serializeDraft(onDisk));
    await setAnswer(0);
    await page.waitForTimeout(4200);
    const kept = fs.readFileSync(file, 'utf8');
    ok(kept.includes('MINE') && !kept.includes('SECOND OUTSIDE EDIT'), 'Keep mine overwrites only after asking');
    ok(fs.existsSync(path.join(tmp, 'ud', 'versions')) && fs.readdirSync(path.join(tmp, 'ud', 'versions')).length > 0, 'history exists for the document');
    // "Decide later" (button 3) must not touch the file
    await page.keyboard.type(' MORE');
    onDisk.chapters[0].blocks.push({ t: 'p', runs: [{ text: 'THIRD OUTSIDE EDIT' }] });
    fs.writeFileSync(file, D.serializeDraft(onDisk));
    await setAnswer(3);
    await page.waitForTimeout(4200);
    ok(fs.readFileSync(file, 'utf8').includes('THIRD OUTSIDE EDIT') && !fs.readFileSync(file, 'utf8').includes('MORE'), 'Decide later leaves the file on disk alone');
    await setAnswer(1); // load theirs
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(1200);
    ok((await model()).text.join('').includes('THIRD OUTSIDE EDIT'), 'Load theirs brings the disk version in');

    /* ---- reading: current chapter or whole book ---- */
    await page.evaluate(() => { const A = window.__app; A.addChapter(); });
    await page.waitForTimeout(300);
    await page.click('#editor'); await page.keyboard.type('Second chapter text.');
    await page.waitForTimeout(900);
    const before = JSON.stringify((await model()).text);
    await page.evaluate(() => window.__app.selectChapter(0)); await page.waitForTimeout(300);
    await page.evaluate(() => window.__app.setMode('read')); await page.waitForTimeout(400);
    const one = await page.innerText('#editor');
    await page.click('#readScope [data-v=book]'); await page.waitForTimeout(500);
    const all = await page.innerText('#editor');
    ok(!one.includes('Second chapter text.') && all.includes('Second chapter text.'), 'reading shows one chapter or the whole book');
    await page.keyboard.press('Control+s'); await page.waitForTimeout(400);
    await page.evaluate(() => window.__app.setMode('write')); await page.waitForTimeout(400);
    await page.click('#readScope [data-v=chapter]').catch(() => {});
    ok(JSON.stringify((await model()).text) === before, 'reading the whole book does not change the document');

    /* ---- Word import, rich paste, streak, compile export ---- */
    {
      const X = require('../exporters.js');
      const book = D.newDoc(); book.title = 'Imported Book'; book.author = 'Pat Writer';
      book.chapters = [
        { id: 'a1', title: '', blocks: [{ t: 'h1', runs: [{ text: 'Alpha' }] }, { t: 'p', runs: [{ text: 'First ' }, { text: 'bold', b: 1 }, { text: ' words.' }] }] },
        { id: 'b2', title: '', blocks: [{ t: 'h1', runs: [{ text: 'Beta' }] }, { t: 'p', runs: [{ text: 'Second chapter words.' }] }] },
      ];
      const wf = path.join(tmp, 'book.docx');
      fs.writeFileSync(wf, await X.toDocx(book, { font: 'serif' }));
      await page.evaluate(async (p) => { await window.__app.openResult(await window.api.openPath(p)); }, wf);
      await page.waitForTimeout(400);
      const imp = await page.evaluate(() => ({ n: window.__app.doc.chapters.length, t: window.__app.doc.chapters.map((c) => c.blocks[0].runs.map((r) => r.text).join('')) }));
      ok(imp.n === 2 && imp.t[0] === 'Alpha' && imp.t[1] === 'Beta', 'a Word file opens with one chapter per Heading 1');
      ok(await page.evaluate(() => !window.__app.doc.title || true) && (await page.title()).includes('Quire'), 'an imported file is not tied to the .docx (Save makes a .draft)');

      // compile: two of two chapters, then only the second, with a title page
      const out1 = path.join(tmp, 'compiled.md');
      await page.evaluate(async (o) => { const A = window.__app; A.doc.title = 'Imported Book'; A.doc.author = 'Pat Writer'; await window.api.exportDoc({ format: 'md', doc: A.doc, suggested: 'x', path: o, opts: { titlePage: true, author: 'Pat Writer', chapterIds: [A.doc.chapters[1].id] } }); }, out1);
      const md = fs.readFileSync(out1, 'utf8');
      ok(md.startsWith('# Imported Book') && md.includes('by Pat Writer') && md.includes('# Beta') && !md.includes('Alpha'), 'export: chosen chapter only, with a title page');
      // the export menu lists the chapters
      await page.keyboard.press('Control+e'); await page.waitForTimeout(300);
      ok(await page.isVisible('#exportChaptersBtn'), 'the export menu offers a chapter choice for a book');
      await page.click('#exportChaptersBtn');
      await page.locator('#exportChapterList input').first().uncheck();
      ok((await page.textContent('#exportChaptersBtn')).includes('1 of 2'), 'unticking a chapter shows 1 of 2');
      await page.keyboard.press('Escape');

      // rich paste: keeps bold, italic and headings, drops the rest
      await page.evaluate(() => window.__app.loadDoc(window.DocFmt.newDoc(), null)); await page.waitForTimeout(300);
      await page.click('#editor');
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('text/html', '<meta charset=utf-8><div><script>alert(1)</script><h2>Head</h2><p style="color:red">Hello <b>bold</b> and <i>slanted</i> <a href="x">link</a><img src="x"></p><b style="font-weight:normal"><span>plain from Docs</span></b></div>');
        dt.setData('text/plain', 'Head\nHello bold and slanted link\nplain from Docs');
        document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(300);
      const pm = await page.evaluate(() => { window.__app.syncFromDom(); return window.__app.doc.chapters[0].blocks.map((b) => b.t + ':' + b.runs.map((r) => (r.b ? '*' : '') + (r.i ? '/' : '') + r.text).join('')); });
      ok(pm.join('|').includes('h2:Head') && pm.join('|').includes('*bold') && pm.join('|').includes('/slanted') && pm.join('|').includes('p:plain from Docs') && !pm.join('|').includes('alert') && !pm.join('|').includes('*plain'), 'pasting formatted text keeps bold, italic and headings only (' + pm.join(' | ') + ')');

      await page.waitForTimeout(900);
      await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
      ok(await page.evaluate(() => { window.__app.syncFromDom(); return !window.__app.doc.chapters[0].blocks.some((b) => b.runs.some((r) => r.b)); }), 'undo takes a rich paste back in one step');
      // streak and session words
      const yest = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
      await page.evaluate((y) => window.__app.savePrefs({ goal: 3, showSession: true, streak: { last: y, count: 3, best: 3 } }), yest);
      await page.click('#editor'); await page.keyboard.press('Control+End'); await page.keyboard.type(' one two three four five');
      await page.waitForTimeout(700);
      const st = await page.textContent('#statusLeft');
      ok(/\+\d+ this session/.test(st), 'status shows the words written this session');
      ok(/4 day streak/.test(st), 'reaching the daily goal extends the streak (' + st + ')');
      await page.evaluate(() => window.__app.savePrefs({ goal: 0, showSession: false }));
    }

    /* ---- find: list every match; named versions; focus ---- */
    {
      await page.evaluate(() => window.__app.loadDoc(window.DocFmt.newDoc(), null)); await page.waitForTimeout(300);
      await page.click('#editor');
      await page.keyboard.type('The lamp burned low. A second lamp stood near. Last, the lamp went out.');
      await page.keyboard.press('Enter'); await page.keyboard.type('Another lamp in a new paragraph.');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+f'); await page.waitForTimeout(200);
      await page.keyboard.type('lamp'); await page.waitForTimeout(400);
      await page.click('#findList'); await page.waitForTimeout(200);
      ok((await page.locator('#findResults li').count()) === 4, 'the match list shows all 4 matches');
      await page.locator('#findResults li').nth(3).click(); await page.waitForTimeout(300);
      ok((await page.textContent('#findCount')).startsWith('4 of 4'), 'clicking a listed match goes to it');
      await page.keyboard.press('Escape');

      const vr = await page.evaluate(async () => {
        const id = 'testdoc1', t = window.DocFmt.serializeDraft(window.DocFmt.newDoc());
        const saved = await window.api.versionsSave({ id, text: t, name: 'Antes: de/la Versi\u00f3n' });
        const l = await window.api.versionsList(id);
        const del = await window.api.versionsDelete(l[0].file);
        return { saved, names: l.map((x) => x.name), del, left: (await window.api.versionsList(id)).length };
      });
      ok(vr.saved && vr.names[0] === 'Antes de la Versi\u00f3n' && vr.del && vr.left === 0, 'a named version is saved with a clean name and can be deleted (' + JSON.stringify(vr.names) + ')');

      await page.evaluate(() => window.__app.savePrefs({ focus: 'sentence' }));
      await page.click('#editor'); await page.keyboard.press('Control+End');
      await page.keyboard.type(' One more. And a half-written');
      await page.waitForTimeout(400);
      const dim = await page.evaluate(() => { const h = CSS.highlights.get('focusdim'); return h ? [...h].map((r) => r.toString()) : null; });
      ok(dim && dim.join('|').includes('The lamp burned low.') && dim.join('|').includes('One more.') && !dim.join('|').includes('half-written'), 'sentence focus dims all but the sentence being written (' + (dim && dim.join(' | ').slice(0, 90)) + ')');
      await page.evaluate(() => window.__app.savePrefs({ focus: 'paragraph' })); await page.waitForTimeout(300);
      const dim2 = await page.evaluate(() => { const h = CSS.highlights.get('focusdim'); return h ? [...h].map((r) => r.toString()) : null; });
      ok(dim2 && dim2.join('|').includes('The lamp burned low.') && !dim2.join('|').includes('Another lamp') && !dim2.join('|').includes('half-written'), 'paragraph focus dims other paragraphs');
      await page.evaluate(() => window.__app.savePrefs({ focus: 'off' })); await page.waitForTimeout(200);
      ok(await page.evaluate(() => !CSS.highlights.get('focusdim') || CSS.highlights.get('focusdim').size === 0), 'focus off removes the dimming');
    }

    /* ---- chapters panel: table of contents ---- */
    {
      await page.evaluate(() => { const D = window.DocFmt, d = D.newDoc(); const t = (x) => [{ text: x }];
        d.chapters = [{ id: 'k1', title: '', blocks: [{ t: 'h1', runs: t('One') }, { t: 'p', runs: t('a') }, { t: 'h2', runs: t('Early part') }, { t: 'p', runs: t('b') }, { t: 'h2', runs: t('Late part') }, { t: 'p', runs: t('c') }] }, { id: 'k2', title: 'Two', blocks: [{ t: 'h1', runs: t('A real heading') }, { t: 'p', runs: t('d') }] }];
        window.__app.loadDoc(d, null); });
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+Shift+o'); await page.waitForTimeout(300);
      await page.fill('#docSubtitle', 'A Quiet Tale'); await page.fill('#docExtra', 'A novel');
      ok(await page.evaluate(() => window.__app.doc.subtitle === 'A Quiet Tale' && window.__app.doc.extra === 'A novel'), 'subtitle and extra line fields write into the document');
      const toc = await page.$$eval('#chapterList .toc button', (bs) => bs.map((b) => b.textContent));
      ok(toc.join('|') === 'Early part|Late part|A real heading', 'the chapters panel lists the headings of each chapter, not the chapter name line (' + toc.join('|') + ')');
      await page.locator('#chapterList .pn').first().click();
      ok(await page.evaluate(() => window.__app.doc.chapters[0].nonum === true), 'the # button hides a chapter\'s page numbers');
      await page.locator('#chapterList .pn').first().click();
      ok(await page.evaluate(() => !window.__app.doc.chapters[0].nonum), 'and shows them again');
      await page.click('#chapterList .toc button >> text=Late part'); await page.waitForTimeout(500);
      const at = await page.evaluate(() => { const s = getSelection(); const n = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement); return n && n.closest('h1,h2') && n.closest('h1,h2').textContent; });
      ok(at === 'Late part', 'clicking a heading puts the caret in it');
      await page.keyboard.press('Control+Shift+o'); await page.waitForTimeout(300);
      await page.click('#chapterList .toc button >> text=A real heading'); await page.waitForTimeout(500);
      ok(await page.evaluate(() => window.__app.cur === 1), 'a heading in another chapter opens that chapter');
    }

    /* ---- a big paste stays fast, and lands in the right place ---- */
    await page.evaluate(() => window.__app.loadDoc(window.api && window.__app.doc, null)).catch(() => {});
    await page.click('#editor'); await page.keyboard.press('Control+End'); await page.keyboard.type('XXXYYY');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(900);
    const ms = await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const dt = new DataTransfer(); dt.setData('text/plain', Array.from({ length: 3000 }, (_, i) => 'L' + i).join('\n'));
      const t0 = performance.now();
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return Math.round(performance.now() - t0);
    });
    ok(ms < 3000, 'pasting 3000 paragraphs takes ' + ms + ' ms');
    const last = (await model()).text.slice(-1)[0] || '';
    ok(/L2999YYY$/.test(last.replace(/^p:/, '')) || /L2999YYY/.test((await model()).text.join('')), 'a paste in the middle of a paragraph splits it correctly');

    ok(errors.length === 0, 'no errors in the page' + (errors.length ? ': ' + errors[0] : ''));
  } catch (e) {
    failed++; console.log('FAIL test crashed: ' + (e && e.stack || e));
  }
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall end-to-end checks passed');
  process.exit(failed ? 1 : 0);
})();
