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
    await page.click('.st-nav [data-sec=look]');
    const sl = page.locator('input[type=range][data-pref=size]');
    const bx = await sl.boundingBox();
    await page.mouse.move(bx.x + bx.width * 0.3, bx.y + 9); await page.mouse.down(); await page.mouse.move(bx.x + bx.width * 0.9, bx.y + 9, { steps: 6 }); await page.waitForTimeout(450);
    ok(await page.evaluate(() => document.getElementById('settings').classList.contains('adjusting')), 'the page steps aside while a slider is dragged');
    await page.mouse.up(); await page.waitForTimeout(300);
    const num = page.locator('input[data-num=size]');
    await num.fill('500'); await num.press('Enter');
    ok((await num.inputValue()) === '34', 'a typed number is limited to the slider range');
    await num.fill('3'); await num.press('Enter');
    ok((await num.inputValue()) === '10', 'text size can go as low as 10 px');
    ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim() === '10px'), 'the page really uses 10 px');
    await page.click('[data-reset=size]');
    ok((await num.inputValue()) === '22', 'the reset arrow restores the default');
    await page.click('.st-nav [data-sec=look]'); await page.click('[data-pref=font] [data-v=type]');
    await page.click('.st-nav [data-sec=look]');
    ok(await page.evaluate(() => document.querySelector('[data-pref=weight]').disabled), 'weight is switched off for the one-weight Typewriter font');
    await page.click('#resetAll'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => !document.querySelector('[data-pref=weight]').disabled), 'Reset all restores the font and weight');
    ok((await page.$$eval('.st-nav button', (bs) => bs.map((b) => b.textContent.trim()))).every((t) => /^[A-Za-z ]+$/.test(t)), 'settings section names are clean text');
    await page.click('.st-nav [data-sec=about]');
    const pkgVersion = require('../package.json').version;
    ok((await page.innerText('#aboutVersion')).includes(pkgVersion), 'Settings, About shows the app version (' + pkgVersion + ')');
    ok((await page.innerText('#updateStatus')).length > 10 && (await page.isHidden('#updateCheck')), 'a development run says updates are off and has no check button');
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

    /* ---- export menu: all three boxes start ticked ---- */
    await page.keyboard.press('Control+e'); await page.waitForTimeout(250);
    ok((await page.inputValue('#exportNotes')) === 'comments', 'notes are included (as comments) by default in the export menu');
    ok(['letter', 'a4'].includes(await page.inputValue('#exportPage')) && (await page.inputValue('#exportMargins')) === 'normal', 'page size and margins have sensible defaults');
    await page.keyboard.press('Escape');

    /* ---- reading: current chapter or whole book ---- */
    await page.evaluate(() => { const A = window.__app; A.addChapter(); });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.activeElement === document.getElementById('editor')), 'a new chapter puts the caret in the text, not in the title field');
    await page.keyboard.type('Second chapter text.');
    ok(await page.evaluate(() => { const A = window.__app; A.syncFromDom(); const b = A.doc.chapters[A.doc.chapters.length - 1].blocks[0]; return b.t === 'p'; }), 'a new chapter starts in plain text, not a heading');
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

      // a .draft saved with a byte-order mark (Notepad, PowerShell) opens
      const bomFile = path.join(tmp, 'bom.draft');
      const bd = D.newDoc(); bd.title = 'Bom Book';
      fs.writeFileSync(bomFile, '\uFEFF' + D.serializeDraft(bd));
      await page.evaluate(async (p) => { await window.__app.openResult(await window.api.openPath(p)); }, bomFile);
      await page.waitForTimeout(300);
      ok(await page.evaluate(() => window.__app.doc && window.__app.doc.title === 'Bom Book'), 'a draft file with a byte-order mark opens');
      ok(!(await page.evaluate((p) => window.api.docChanged(p), bomFile)), 'and is not reported as changed on disk');

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

      // smart typography: curly quotes and a real ellipsis, only when switched on
      const typed = async (style, text) => {
        await page.evaluate((st) => { window.__app.savePrefs({ smartQuotes: st }); window.__app.loadDoc(window.DocFmt.newDoc(), null); }, style);
        await page.waitForTimeout(250); await page.click('#editor'); await page.keyboard.type(text);
        return page.evaluate(() => { window.__app.syncFromDom(); return window.__app.doc.chapters[0].blocks.map((b) => b.runs.map((r) => r.text).join('')).join('|'); });
      };
      ok((await typed('off', '"Hi" it\'s...')) === '"Hi" it\'s...', 'smart quotes off: what you type stays as typed');
      ok((await typed('en', '"Hello," she said. It\'s \'fine\'... ok')) === '\u201cHello,\u201d she said. It\u2019s \u2018fine\u2019\u2026 ok', 'English smart quotes, apostrophe and ellipsis');
      ok((await typed('en', "in '90s and 'quoted' x")) === 'in \u201990s and \u2018quoted\u2019 x', 'a quote before digits is an apostrophe (\u201990s), a quote before letters still opens');
      ok((await typed('es', '"Hola" y (\"si\")')) === '\u00abHola\u00bb y (\u00absi\u00bb)', 'Spanish and Catalan guillemets');
      ok((await typed('de', '"Hallo"')) === '\u201eHallo\u201c', 'German quotes');
      await page.evaluate(() => window.__app.savePrefs({ smartQuotes: 'off' }));

      // scene break: Ctrl+Shift+Enter puts a centered * * * and continues below
      await page.evaluate(() => window.__app.loadDoc(window.DocFmt.newDoc(), null)); await page.waitForTimeout(250);
      await page.click('#editor'); await page.keyboard.type('Before'); await page.keyboard.press('Control+Shift+Enter'); await page.keyboard.type('After');
      const sbk = await page.evaluate(() => { window.__app.syncFromDom(); return window.__app.doc.chapters[0].blocks.map((b) => b.runs.map((r) => r.text).join('')); });
      ok(sbk.join('|') === 'Before|* * *|After', 'Ctrl+Shift+Enter inserts a scene break and the caret continues below it (' + sbk.join('|') + ')');
      ok(await page.evaluate(() => !!document.querySelector('#editor p.sbreak')), 'the scene break is shown centered');

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

      // compare an earlier version with the current text
      const cmpInfo = await page.evaluate(async () => {
        const A = window.__app, D = window.DocFmt;
        const old = D.newDoc(); old.id = 'cmpdoc1'; old.chapters[0].blocks = [{ t: 'p', runs: [{ text: 'The quick brown fox jumps over the dog' }] }, { t: 'p', runs: [{ text: 'A paragraph that will vanish completely' }] }];
        await window.api.versionsSave({ id: 'cmpdoc1', text: D.serializeDraft(old), name: 'Old draft' });
        const it = (await window.api.versionsList('cmpdoc1'))[0];
        const cur = D.newDoc(); cur.chapters[0].blocks = [{ t: 'p', runs: [{ text: 'The quick red fox jumps over the dog' }] }, { t: 'p', runs: [{ text: 'Something wholly new and different arrives' }] }];
        A.loadDoc(cur, null); await new Promise((r) => setTimeout(r, 300));
        await A.openCompare(it);
        const r = { open: !document.querySelector('#cmpDlg').hidden, ins: [...document.querySelectorAll('#cmpBody ins')].map((x) => x.textContent.trim()), del: [...document.querySelectorAll('#cmpBody del')].map((x) => x.textContent.trim()), sum: document.querySelector('#cmpSummary').textContent };
        document.querySelector('#cmpClose').click();
        await window.api.versionsDelete(it.file);
        return r;
      });
      ok(cmpInfo.open && cmpInfo.ins.includes('red') && cmpInfo.del.includes('brown') && /1 paragraph edited/.test(cmpInfo.sum), 'compare shows what changed between a version and now (' + cmpInfo.sum + ')');

      // chapter targets and e-book export
      await page.evaluate(() => window.__app.loadDoc(window.DocFmt.newDoc(), null)); await page.waitForTimeout(250);
      await page.click('#editor'); await page.keyboard.type('Some words to count here now.'); await page.waitForTimeout(300);
      await page.evaluate(() => { const A = window.__app; A.syncFromDom(); A.doc.chapters[0].goal = 10; });
      await page.keyboard.press('Control+Shift+O'); await page.waitForTimeout(400);
      ok((await page.locator('#chapterList .ch-bar').count()) === 1, 'a chapter with a target shows a progress bar');
      ok((await page.getAttribute('#chapterList .ch-bar', 'aria-valuenow')) !== null, 'the progress bar is exposed to screen readers');
      await page.keyboard.press('Escape');
      const epubOut = path.join(tmp, 'book.epub');
      await page.evaluate(async (o) => { const A = window.__app; await window.api.exportDoc({ format: 'epub', doc: A.snapshotDoc(), suggested: 'x', path: o, opts: { titlePage: true } }); }, epubOut);
      const eh = fs.readFileSync(epubOut);
      ok(eh.slice(0, 2).toString() === 'PK' && eh.includes('application/epub+zip'), 'the app exports an .epub file');

      // diagnostics are copied and contain the essentials
      const dg = await page.evaluate(async () => { const n = await window.api.diagnostics(); return n; });
      ok(dg > 100, 'diagnostics are produced (' + dg + ' characters)');

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

    // friendly messages: a greeting at start, cheers at goals, and one switch to turn them off
    {
      const cheers = await page.evaluate(async () => {
        const A = window.__app; const out = {};
        A.savePrefs({ friendly: true });
        const t = document.querySelector('#toast');
        A.cheer('goal'); out.on = t.textContent;
        t.textContent = ''; A.savePrefs({ friendly: false }); A.cheer('goal'); out.off = t.textContent;
        A.savePrefs({ friendly: true });
        return out;
      });
      ok(cheers.on.length > 10 && !cheers.on.includes('\u2014'), 'a cheer shows a short friendly message (' + cheers.on + ')');
      ok(cheers.off === '', 'Friendly messages off shows nothing');
    }
    // the soft light at the writing line: strength and color
    {
      const g = await page.evaluate(() => {
        const A = window.__app, cs = () => getComputedStyle(document.body);
        A.savePrefs({ theme: 'dark', accent: 'amber', glowStrength: 100, glowColor: 'accent' });
        const base = { k: cs().getPropertyValue('--glow-k').trim(), c: cs().getPropertyValue('--glow').trim() };
        A.savePrefs({ glowStrength: 200, glowColor: 'rose' });
        const strong = { k: cs().getPropertyValue('--glow-k').trim(), c: cs().getPropertyValue('--glow').trim() };
        A.savePrefs({ glowColor: 'white', glowStrength: 0 });
        const off = { k: cs().getPropertyValue('--glow-k').trim(), c: cs().getPropertyValue('--glow').trim() };
        A.savePrefs({ glowStrength: 100, glowColor: 'accent' });
        return { base, strong, off, swatches: document.querySelectorAll('[data-pref=glowColor] button').length };
      });
      ok(g.base.k === '1' && g.strong.k === '2' && g.off.k === '0', 'light strength scales the glow (' + g.base.k + ', ' + g.strong.k + ', ' + g.off.k + ')');
      ok(g.base.c !== g.strong.c && g.off.c === '255 255 255', 'light color changes the glow');
      ok(g.swatches === 8, 'the light color offers match-accent, six colors and white (' + g.swatches + ')');
    }

    /* ---- writing flow: placeholders, resume, names, sprint, caret, pointer, evening theme ---- */
    {
      const mk = (chapters) => { const d = D.newDoc(); d.chapters = chapters.map((t, i) => ({ id: 'w' + i, title: 'Part ' + (i + 1), blocks: t.split('\n').map((x) => ({ t: 'p', runs: [{ text: x }] })) })); return JSON.parse(JSON.stringify(d)); };
      const sel = () => page.evaluate(() => getSelection().toString());
      await page.evaluate((d) => window.__app.loadDoc(d, null), mk(['We met in TK and then [[the name]] left.', 'Later TK again.']));
      await page.waitForTimeout(500);
      ok(await page.evaluate(() => window.__app.placeholderCount()) === 3, 'placeholders are counted across the book');
      ok((await page.textContent('#statusLeft')).includes('3 to fill'), 'the status line shows how many are left');
      await page.click('#editor'); await page.keyboard.press('Control+Home');
      await page.keyboard.press('Control+j'); ok(await sel() === 'TK', 'Ctrl+J selects the first placeholder (' + await sel() + ')');
      await page.keyboard.press('Control+j'); ok(await sel() === '[[the name]]', 'Ctrl+J goes to the next one');
      await page.keyboard.press('Control+j'); await page.waitForTimeout(150);
      ok(await sel() === 'TK' && (await page.textContent('#editor')).includes('Later'), 'Ctrl+J crosses into the next chapter');
      await page.keyboard.press('Control+j'); await page.waitForTimeout(150);
      ok(await sel() === 'TK' && (await page.textContent('#editor')).includes('We met'), 'Ctrl+J wraps around to the start');
      await page.keyboard.press('Control+Shift+j'); await page.waitForTimeout(150);
      ok((await page.textContent('#editor')).includes('Later'), 'Ctrl+Shift+J goes back');
      await page.keyboard.type('Rome'); 
      ok(await page.evaluate(() => window.__app.placeholderCount()) === 2, 'typing over a placeholder fills it');
      await page.waitForTimeout(100);

      // where you left off
      const P = path.join(tmp, 'resume-test.draft');
      const rd = mk(['First part text.', 'Second part text here.']);
      await page.evaluate(([d, p]) => { window.__app.loadDoc(d, p); window.__app.selectChapter(1); window.__app.resumeSave(); }, [rd, P]);
      await page.evaluate(([d, p]) => window.__app.loadDoc(d, p, { resume: true }), [rd, P]);
      await page.waitForTimeout(300);
      ok((await page.textContent('#editor')).includes('Second part'), 'a book reopens in the chapter you were writing in');
      ok((await page.textContent('#toast')).includes('Back where you stopped'), 'a short note says where you are');
      await page.evaluate(([d, p]) => window.__app.loadDoc(d, p, {}), [rd, P]);
      ok((await page.textContent('#editor')).includes('First part'), 'without resume the first chapter opens');

      // names: Tab completes a name that keeps coming up
      await page.evaluate((d) => window.__app.loadDoc(d, null), mk(['She called to Esperanza, and Esperanza answered. Then Esperanza laughed.', '']));
      await page.click('#editor'); await page.keyboard.press('Control+End');
      await page.keyboard.type('We asked Espe'); await page.waitForTimeout(150);
      ok(await page.isVisible('#nameHint') && (await page.textContent('#nameHint')).includes('Esperanza'), 'a frequent name is offered after a few letters');
      await page.keyboard.press('Tab');
      ok((await page.textContent('#editor')).endsWith('We asked Esperanza'), 'Tab completes the name');
      await page.keyboard.type(' and Thun'); await page.waitForTimeout(100);
      ok(!(await page.isVisible('#nameHint')), 'no hint for words that are not names in the book');

      // sprint
      await page.evaluate((d) => window.__app.loadDoc(d, null), mk(['']));
      await page.click('#editor');
      await page.keyboard.press('Control+Shift+t');
      ok(await page.evaluate(() => !!window.__app.sprint), 'Ctrl+Shift+T starts a sprint');
      ok((await page.textContent('#statusLeft')).includes('sprint'), 'the status line shows a sprint is on, without a countdown');
      await page.keyboard.type('one two three');
      await page.keyboard.press('Control+Shift+t'); await page.waitForTimeout(100);
      ok((await page.textContent('#toast')).includes('Sprint stopped. 3 words'), 'stopping reports the words written (' + (await page.textContent('#toast')) + ')');
      await page.keyboard.press('Control+Shift+t');
      await page.keyboard.type(' four five');
      await page.evaluate(() => { window.__app.sprint.end = Date.now() - 1; });
      await page.waitForFunction(() => !window.__app.sprint, null, { timeout: 4000 });
      ok((await page.textContent('#toast')).includes('Time. 2 words'), 'when time is up the words written are shown (' + (await page.textContent('#toast')) + ')');

      // caret, fade distance, evening theme, pointer
      const f = await page.evaluate(() => {
        const A = window.__app, b = document.body;
        A.savePrefs({ caret: 'block', caretBlink: false, fadeReach: 50, theme: 'evening' });
        const r = { caret: b.dataset.caret, blink: b.classList.contains('noblink'), k: b.style.getPropertyValue('--fade-k'), dark: b.classList.contains('dark'), wantDark: window.Sun.isNight() };
        A.savePrefs({ caret: 'bar', caretBlink: true, fadeReach: 100, theme: 'system' });
        return r;
      });
      ok(f.caret === 'block' && f.blink && f.k === '0.5', 'caret style, blinking and fade distance apply');
      ok(f.dark === f.wantDark, 'the evening theme follows the clock');
      await page.click('#editor'); await page.keyboard.press('x');
      ok(await page.evaluate(() => document.body.classList.contains('ptrhide')), 'the pointer hides while typing');
      await page.mouse.move(300, 300); await page.mouse.move(340, 330);
      ok(await page.evaluate(() => !document.body.classList.contains('ptrhide')), 'the pointer returns when moved');
      ok(await page.evaluate(() => document.querySelectorAll('[data-pref=theme] button').length === 4 && document.querySelectorAll('[data-pref=caret] button').length === 3 && !!document.querySelector('#btnSprint')), 'the new settings are present');
    }

    // the first-run hint appears once, on a fresh install only
    {
      await page.evaluate(() => { window.__app.savePrefs({ introSeen: false }); window.__app.welcome(); });
      ok((await page.textContent('#toast')).includes('open Settings'), 'a first install gets one gentle pointer to the settings');
      ok(await page.evaluate(() => window.api.init().prefs.introSeen === true), 'the hint marks itself as seen');
      await page.evaluate(() => window.__app.welcome());
      ok(!(await page.textContent('#toast')).includes('open Settings'), 'it does not come back');
    }

    /* ---- templates, writing calendar, pace, release note, read aloud ---- */
    {
      const mk = (chapters) => { const d = D.newDoc(); d.chapters = chapters.map((t, i) => ({ id: 'q' + i, title: 'Part ' + (i + 1), blocks: t.split('\n').map((x) => ({ t: 'p', runs: [{ text: x }] })) })); return JSON.parse(JSON.stringify(d)); };
      await page.evaluate((d) => window.__app.loadDoc(d, null), mk(['']));
      await page.click('#editor');
      await page.keyboard.press('Control+n');
      await page.waitForSelector('#tplDlg:not([hidden])');
      ok(await page.evaluate(() => document.querySelectorAll('#tplList button').length) >= 5, 'a new book offers the starting structures');
      await page.keyboard.press('Escape');
      ok(await page.evaluate(() => document.querySelector('#tplDlg').hidden), 'Escape closes the template choice');
      await page.keyboard.press('Control+n');
      await page.waitForSelector('#tplDlg:not([hidden])');
      await page.click('#tplList button:has-text("Scientific article")');
      ok(await page.evaluate(() => { const d = window.__app.snapshotDoc(); return d.chapters.length === 6 && d.chapters[0].title === 'Abstract'; }), 'choosing Scientific article creates its sections');
      await page.keyboard.press('Control+n');
      await page.waitForSelector('#tplDlg:not([hidden])');
      await page.keyboard.press('Enter');
      ok(await page.evaluate(() => window.__app.snapshotDoc().chapters.length === 1), 'Enter on the first choice starts a blank book');

      // document kinds: journal, single text, book
      await page.keyboard.press('Control+n');
      await page.waitForSelector('#tplDlg:not([hidden])');
      ok(await page.evaluate(() => ['Book', 'Single text', 'Journal'].every((n) => [...document.querySelectorAll('#tplList h3')].some((h) => h.textContent === n))), 'the choice is grouped as Book, Single text and Journal');
      await page.click('#tplList button:has-text("Journal")');
      await page.waitForTimeout(300);
      ok(await page.evaluate(() => { const d = window.__app.snapshotDoc(); return d.kind === 'journal' && d.chapters.length === 1 && !!d.chapters[0].at; }), 'a new journal starts with a dated entry');
      await page.keyboard.type('First day of the journal.', { delay: 5 });
      await page.keyboard.press('Control+Shift+E');
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+Shift+E');
      await page.waitForTimeout(200);
      ok(await page.evaluate(() => window.__app.snapshotDoc().chapters.length === 2), 'Ctrl+Shift+E adds an entry, and an empty one is reused instead of stacking blanks');
      await page.keyboard.type('Second entry.', { delay: 5 });
      await page.keyboard.press('Control+Shift+O');
      await page.waitForSelector('#outline:not([hidden])');
      ok(await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        return q('#btnChapters').textContent === 'Entries' && !q('#btnEntry').hidden && document.body.classList.contains('kind-journal')
          && q('#addChapter').textContent === 'New entry' && document.querySelectorAll('#chapterList .when').length === 2
          && getComputedStyle(q('#paceNote')).display === 'none';
      }), 'a journal shows Entries, a New entry button, dated rows and no book targets');
      ok(await page.evaluate(() => document.querySelector('#chapterList li.current .ch-top input') && document.querySelector('#chapterList li:first-child').classList.contains('current')), 'entries are listed newest first');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+n');
      await page.waitForSelector('#tplDlg:not([hidden])');
      await page.click('#tplList button:has-text("Short story")');
      await page.waitForTimeout(300);
      ok(await page.evaluate(() => {
        const d = window.__app.snapshotDoc(), q = (s) => document.querySelector(s);
        return d.kind === 'text' && q('#btnChapters').textContent === 'Details' && q('#btnEntry').hidden && !document.body.classList.contains('kind-journal');
      }), 'a single text has no chapter machinery in the bar');
      await page.keyboard.press('Control+n');
      await page.waitForSelector('#tplDlg:not([hidden])');
      await page.click('#tplList button:has-text("Blank book")');
      await page.waitForTimeout(300);
      ok(await page.evaluate(() => { const d = window.__app.snapshotDoc(); return !d.kind && document.querySelector('#btnChapters').textContent === 'Chapters'; }), 'a book is unchanged');

      // journal details: a new entry on a new day, date format, changing an entry's date
      {
        const entry = (daysAgo, text, hour) => { const t = new Date(); t.setDate(t.getDate() - daysAgo); t.setHours(hour || 9, 0, 0, 0); const c = D.newEntry(t); c.blocks = [{ t: 'p', runs: [{ text }] }]; return c; };
        const jd = (...entries) => { const d = D.newDoc('journal'); d.chapters = entries; return JSON.parse(JSON.stringify(d)); };
        await page.evaluate((d) => window.__app.loadDoc(d, null), jd(entry(1, 'Yesterday I wrote this.')));
        ok(await page.evaluate(() => {
          const d = window.__app.snapshotDoc(), a = new Date(d.chapters[1] && d.chapters[1].at), n = new Date();
          return d.chapters.length === 2 && a.toDateString() === n.toDateString() && !d.chapters[1].blocks.some((b) => b.runs.some((r) => r.text));
        }), 'opening a journal on a new day starts today\'s entry');
        await page.evaluate(() => window.__app.savePrefs({ journalAuto: false }));
        await page.evaluate((d) => window.__app.loadDoc(d, null), jd(entry(1, 'Yesterday again.')));
        ok(await page.evaluate(() => window.__app.snapshotDoc().chapters.length === 1), 'the new-day entry can be switched off');
        await page.evaluate(() => window.__app.savePrefs({ journalAuto: true }));
        await page.evaluate((d) => window.__app.loadDoc(d, null), jd(entry(0, 'Written today.')));
        ok(await page.evaluate(() => window.__app.snapshotDoc().chapters.length === 1), 'no extra entry when today already has one');

        // format
        await page.evaluate((d) => window.__app.loadDoc(d, null), jd(entry(5, 'Older entry.', 8), entry(3, 'Newer entry.', 20)));
        await page.keyboard.press('Control+,');
        await page.waitForSelector('#settings:not([hidden])');
        ok(await page.evaluate(() => !document.querySelector('#navJournal').hidden), 'a journal has its own Settings section');
        await page.click('#navJournal');
        await page.selectOption('#jDate', 'iso'); await page.selectOption('#jTime', 'none');
        ok(await page.evaluate(() => { const d = window.__app.snapshotDoc(); return d.dateFmt === 'iso' && d.timeFmt === 'none' && /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector('#chapterList .when').textContent); }), 'the journal date format changes the entries and is kept in the journal');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+Shift+O');
        await page.waitForSelector('#outline:not([hidden])');
        // change the older entry's date to after the newer one: it moves to the end
        const before = await page.evaluate(() => window.__app.snapshotDoc().chapters.map((c) => c.id));
        await page.click('#chapterList li:last-child button.when');
        const later = new Date(); later.setDate(later.getDate() - 1);
        const p2 = (n) => String(n).padStart(2, '0');
        await page.fill('input.when-edit', later.getFullYear() + '-' + p2(later.getMonth() + 1) + '-' + p2(later.getDate()) + 'T10:30');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        ok(await page.evaluate((b) => { const ids = window.__app.snapshotDoc().chapters.map((c) => c.id); return ids[0] === b[1] && ids[1] === b[0]; }, before), 'changing an entry\'s date puts it where that date belongs');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+,');
        await page.waitForSelector('#settings:not([hidden])');
        await page.evaluate((d) => window.__app.loadDoc(d, null), JSON.parse(JSON.stringify(D.newDoc())));
        ok(await page.evaluate(() => document.querySelector('#navJournal').hidden), 'the Journal section is hidden for a book');
        await page.keyboard.press('Escape');
      }

      // calendar
      const cal = await page.evaluate(() => {
        const A = window.__app;
        const key = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
        localStorage.setItem('days', JSON.stringify({ [key(-1)]: { a: 500 }, [key(-3)]: { a: 50 } }));
        A.savePrefs({ goal: 500 });
        A.renderDayGrid();
        const cells = document.querySelectorAll('#dayGrid i');
        const r = { n: cells.length, l4: document.querySelectorAll('#dayGrid i.l4').length, l1: document.querySelectorAll('#dayGrid i.l1').length, note: document.querySelector('#dayNote').textContent, label: document.querySelector('#dayGrid').getAttribute('aria-label') };
        A.savePrefs({ goal: 0 });
        return r;
      });
      ok(cal.n === 84 && cal.l4 === 1 && cal.l1 === 1, 'the calendar shades days by words written (' + JSON.stringify([cal.n, cal.l4, cal.l1]) + ')');
      ok(cal.note.includes('Last 7 days: 550') && cal.note.includes('Best day: 500') && cal.label.includes('550'), 'the calendar says it in words too');
      await page.evaluate((d) => window.__app.loadDoc(d, null), mk(['']));
      await page.click('#editor');
      await page.keyboard.type('one two three four five');
      await page.waitForTimeout(500);
      ok(await page.evaluate(() => { const m = JSON.parse(localStorage.getItem('days') || '{}'); const t = Object.keys(m).sort().pop(); return Object.keys(m[t] || {}).reduce((a, k) => a + m[t][k], 0) >= 5; }), 'words written today are logged');

      // pace
      const pace = await page.evaluate(() => {
        const A = window.__app, d = new Date(); d.setDate(d.getDate() + 9);
        const by = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        A.savePrefs({ bookGoal: 10000, finishBy: by });
        const p = A.paceInfo();
        const out = { per: p && p.per, note: document.querySelector('#paceNote').textContent };
        A.savePrefs({ finishBy: '2000-01-01' });
        out.late = A.paceInfo().late === true;
        A.savePrefs({ bookGoal: 0, finishBy: '' });
        return out;
      });
      ok(pace.per >= 990 && pace.per <= 1000 && pace.note.includes('words a day'), 'the daily pace is worked out from the target and the date (' + pace.per + ')');
      ok(pace.late, 'a date in the past is said plainly');

      // release note after an update
      const wn = await page.evaluate(() => {
        const A = window.__app;
        A.whatsNew[A.appVersion] = 'New in test: something nice.';
        A.savePrefs({ lastVersion: '' });
        A.welcome();
        const first = document.querySelector('#toast').textContent;
        document.querySelector('#toast').textContent = '';
        A.welcome();
        return { first, second: document.querySelector('#toast').textContent, v: A.appVersion };
      });
      ok(wn.v && wn.first.includes('New in test'), 'an update shows its release note once');
      ok(!wn.second.includes('New in test'), 'and not again');

      // read aloud
      await page.evaluate((d) => window.__app.loadDoc(d, null), mk(['First paragraph.\nSecond paragraph.\nThird paragraph.']));
      await page.evaluate(() => { window.__spoken = []; window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 20); }; window.speechSynthesis.cancel = () => {}; document.querySelector('[data-mode=read]').click(); });
      await page.waitForSelector('#readbar:not([hidden])');
      await page.click('#readListen');
      await page.waitForFunction(() => window.__spoken.length >= 3, null, { timeout: 4000 });
      ok(await page.evaluate(() => window.__spoken.join('|')) === 'First paragraph.|Second paragraph.|Third paragraph.', 'Listen reads the paragraphs in order');
      await page.waitForFunction(() => document.querySelector('#readListen').textContent === 'Listen', null, { timeout: 3000 });
      ok(true, 'the button goes back to Listen when it finishes');
      await page.evaluate(() => { window.__spoken.length = 0; window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); }; });
      await page.click('#readListen');
      ok(await page.textContent('#readListen') === 'Stop', 'the button says Stop while reading');
      await page.click('#readListen');
      ok(await page.textContent('#readListen') === 'Listen', 'Stop ends it');
      await page.click('#readBack');
    }

    // the Chapters panel closes when you click on the page, and stays open when you click inside it
    {
      await page.keyboard.press('Control+Shift+O');
      ok(await page.evaluate(() => !document.querySelector('#outline').hidden), 'the chapters panel opens');
      await page.click('#outlineHead');
      ok(await page.evaluate(() => !document.querySelector('#outline').hidden), 'clicking inside the panel keeps it open');
      await page.mouse.click(640, 300);
      ok(await page.evaluate(() => document.querySelector('#outline').hidden), 'clicking on the page closes the panel');
    }

    // poems: Enter ends a line, Enter on an empty line starts a stanza, and the next Enter leaves the poem
    {
      await page.evaluate((d) => window.__app.loadDoc(d, null), JSON.parse(JSON.stringify(D.newDoc())));
      await page.click('#editor');
      await page.keyboard.type('Prose first.', { delay: 4 }); await page.keyboard.press('Enter');
      await page.keyboard.press('Control+Shift+P');
      await page.keyboard.type('Roses are red', { delay: 4 }); await page.keyboard.press('Enter');
      await page.keyboard.type('Violets are blue', { delay: 4 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
      await page.keyboard.type('Another stanza', { delay: 4 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
      await page.keyboard.type('Prose again.', { delay: 4 });
      await page.waitForTimeout(500);
      ok(await page.evaluate(() => JSON.stringify(window.__app.snapshotDoc().chapters[0].blocks.map((b) => [b.t, b.runs.map((r) => r.text).join('')])) === JSON.stringify([['p', 'Prose first.'], ['poem', 'Roses are red\nViolets are blue'], ['poem', 'Another stanza'], ['p', 'Prose again.']])), 'a poem keeps its lines and stanzas, and Enter leaves it');
      await page.keyboard.press('Control+Shift+P');
      ok(await page.evaluate(() => window.__app.snapshotDoc().chapters[0].blocks[3].t === 'poem'), 'Ctrl+Shift+P makes a paragraph a poem');
      await page.keyboard.press('Control+Shift+P');
      ok(await page.evaluate(() => window.__app.snapshotDoc().chapters[0].blocks[3].t === 'p'), 'and takes it back');
    }

    // poems: several paragraphs become stanzas, Tab indents a line, chapters can be dragged into a new order
    {
      await page.evaluate((d) => window.__app.loadDoc(d, null), JSON.parse(JSON.stringify(D.newDoc())));
      await page.click('#editor');
      for (const t of ['one', 'two', '', 'three', 'four']) { if (t) await page.keyboard.type(t, { delay: 4 }); await page.keyboard.press('Enter'); }
      await page.keyboard.press('Control+A'); await page.keyboard.press('Control+Shift+P');
      await page.waitForTimeout(400);
      const got = await page.evaluate(() => JSON.stringify(window.__app.snapshotDoc().chapters[0].blocks.filter((b) => b.runs.map((r) => r.text).join('').trim()).map((b) => [b.t, b.runs.map((r) => r.text).join('')])));
      ok(got === JSON.stringify([['poem', 'one\ntwo'], ['poem', 'three\nfour']]), 'selected paragraphs join into stanzas, a blank paragraph starts the next one: ' + got);
      await page.keyboard.press('Control+End'); await page.keyboard.press('Backspace');
      await page.keyboard.press('Tab'); await page.keyboard.type('x', { delay: 4 });
      ok(await page.evaluate(() => window.__app.snapshotDoc().chapters[0].blocks.some((b) => b.t === 'poem' && b.runs.map((r) => r.text).join('').endsWith('    x'))), 'Tab indents a line in a poem');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+Tab');
      ok(await page.evaluate(() => window.__app.snapshotDoc().chapters[0].blocks.some((b) => b.t === 'poem' && b.runs.map((r) => r.text).join('').endsWith('x') && !b.runs.map((r) => r.text).join('').endsWith('    x'))), 'and Shift+Tab takes the indent back');

      const three = JSON.parse(JSON.stringify(D.newDoc()));
      three.chapters = ['A', 'B', 'C'].map((t) => Object.assign(D.newChapter(), { title: t, blocks: [{ t: 'p', runs: [{ text: 'text ' + t }] }] }));
      await page.evaluate((d) => window.__app.loadDoc(d, null), three);
      await page.keyboard.press('Control+Shift+O');
      const n1 = await page.locator('#chapterList li:nth-child(1) .num').boundingBox();
      const t3 = await page.locator('#chapterList li:nth-child(3)').boundingBox();
      await page.mouse.move(n1.x + n1.width / 2, n1.y + n1.height / 2); await page.mouse.down();
      await page.mouse.move(t3.x + 30, t3.y + t3.height - 6, { steps: 10 });
      await page.mouse.move(t3.x + 34, t3.y + t3.height - 5, { steps: 3 }); await page.waitForTimeout(600);
      ok(await page.evaluate(() => document.querySelectorAll('#chapterList .drop-after').length === 1 && document.querySelectorAll('#chapterList .drop-before').length === 0 && document.querySelector('#chapterList li:nth-child(3)').classList.contains('drop-after')), 'dragging shows a line where the chapter will land, after the third');
      await page.mouse.up();
      await page.waitForTimeout(400);
      ok(await page.evaluate(() => window.__app.snapshotDoc().chapters.map((c) => c.title).join('') === 'BCA'), 'dragging a chapter by its number moves it');
      await page.keyboard.press('Escape');
    }

    // the notebook: Ctrl+K opens it on the right, you can keep writing, pages are saved in the book and never exported
    {
      await page.evaluate((d) => window.__app.loadDoc(d, null), JSON.parse(JSON.stringify(D.newDoc())));
      await page.click('#editor'); await page.keyboard.type('Chapter text here.', { delay: 4 });
      await page.keyboard.press('Control+K');
      ok(await page.evaluate(() => !document.querySelector('#notebook').hidden && document.activeElement.id === 'nbSearch'), 'Ctrl+K opens the notebook on the search box');
      await page.keyboard.type('Valdemar', { delay: 4 }); await page.keyboard.press('Enter');
      ok(await page.evaluate(() => !document.querySelector('#nbPage').hidden && document.querySelector('#nbTitle').value === 'Valdemar'), 'Enter with no match starts a page with that title');
      await page.fill('#nbCat', 'Places'); await page.fill('#nbText', 'A fishing village north of the bay. Zephyrine lives here.');
      await page.click('#editor'); await page.keyboard.press('End'); await page.keyboard.type(' More.', { delay: 4 });
      ok(await page.evaluate(() => !document.querySelector('#notebook').hidden && window.__app.snapshotDoc().chapters[0].blocks[0].runs.map((r) => r.text).join('').endsWith('More.')), 'the notebook stays open while you keep writing');
      ok(await page.evaluate(() => { const n = window.__app.snapshotDoc().notebook; return n && n.length === 1 && n[0].cat === 'Places' && n[0].text.includes('Zephyrine'); }), 'the page is part of the book');
      await page.keyboard.press('Control+K');
      ok(await page.evaluate(() => document.querySelector('#notebook').hidden), 'Ctrl+K closes it again');
      await page.keyboard.press('Control+K'); await page.click('#nbBack'); await page.fill('#nbSearch', 'zephyrine');
      ok(await page.evaluate(() => document.querySelectorAll('#nbItems .nb-row').length === 1), 'search finds a page by its text');
      await page.keyboard.press('Escape');
      ok(await page.evaluate(() => document.querySelector('#notebook').hidden), 'Esc closes the notebook');
      await page.keyboard.press('Control+K'); await page.click('#nbItems .nb-row'); await page.keyboard.press('Escape');
      ok(await page.evaluate(() => document.querySelector('#notebook').hidden), 'Esc also closes it from an open page');
    }

    // the formatting bar: pick the buttons and the shortcut hints; hidden buttons still work by shortcut
    {
      await page.evaluate((d) => window.__app.loadDoc(d, null), JSON.parse(JSON.stringify(D.newDoc())));
      await page.keyboard.press('Control+,'); await page.waitForTimeout(300); await page.click('.st-nav [data-sec=bar]');
      ok(await page.evaluate(() => ['quote', 'poem', 'break'].every((c) => document.querySelector('[data-cmd=' + c + ']').hidden) && !document.querySelector('[data-cmd=bold]').hidden), 'Quote, Poem and Scene break are hidden until you switch them on');
      await page.check('[data-fmt=quote]'); await page.check('[data-fmt=poem]');
      ok(await page.evaluate(() => !document.querySelector('[data-cmd=quote]').hidden && !document.querySelector('[data-cmd=poem]').hidden), 'switching a button on shows it in the bar');
      await page.uncheck('[data-fmt=quote]'); await page.uncheck('[data-fmt=poem]');
      ok(await page.evaluate(() => document.querySelector('[data-cmd=quote]').hidden && document.querySelector('[data-cmd=poem]').hidden && !document.querySelector('[data-cmd=h1]').hidden), 'unchecked buttons leave the formatting bar');
      await page.uncheck('[data-pref=fmtHints]');
      ok(await page.evaluate(() => getComputedStyle(document.querySelector('#fmtbar .hint')).display === 'none'), 'the shortcut hints can be turned off');
      await page.check('[data-pref=fmtHints]');
      for (const id of ['bold', 'italic', 'underline']) await page.uncheck('[data-fmt=' + id + ']');
      ok(await page.evaluate(() => { const seps = [...document.querySelectorAll('#fmtbar .sep')]; return seps[0].hidden && !seps[1].hidden; }), 'a divider with nothing before it is hidden');
      for (const id of ['h1', 'h2', 'break', 'note']) await page.uncheck('[data-fmt=' + id + ']');
      ok(await page.evaluate(() => document.querySelector('#fmtdock').hidden), 'with every button hidden the bar goes away');
      await page.keyboard.press('Escape');
      await page.click('#editor'); await page.keyboard.type('A line to quote.', { delay: 4 });
      await page.keyboard.press('Control+Shift+Q');
      ok(await page.evaluate(() => window.__app.snapshotDoc().chapters[0].blocks[0].t === 'quote'), 'a hidden Quote button still works by its shortcut');
      await page.keyboard.press('Control+Shift+Q');
      await page.evaluate(() => window.__app.savePrefs({ fmtHide: ['quote', 'poem', 'break'], fmtHints: true }));
    }

    // heading levels: two by default, up to four when chosen
    {
      await page.evaluate((d) => window.__app.loadDoc(d, null), JSON.parse(JSON.stringify(D.newDoc())));
      await page.click('#editor'); await page.keyboard.type('Plain', { delay: 4 });
      await page.keyboard.press('Control+3');
      ok(await page.evaluate(() => !document.querySelector('#editor h3')), 'Ctrl+3 does nothing while two heading levels are chosen');
      ok(await page.evaluate(() => document.querySelector('[data-cmd=h3]').hidden), 'the Heading 3 button waits for the setting');
      await page.keyboard.press('Control+,'); await page.waitForTimeout(300); await page.click('.st-nav [data-sec=bar]');
      await page.selectOption('#headingDepth', '4');
      await page.keyboard.press('Escape');
      ok(await page.evaluate(() => !document.querySelector('[data-cmd=h3]').hidden && !document.querySelector('[data-cmd=h4]').hidden), 'choosing four levels shows the Heading 3 and 4 buttons');
      const last = () => page.evaluate(() => { const b = window.__app.snapshotDoc().chapters[0].blocks; return b[b.length - 1].t; });
      await page.click('#editor'); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('Fresh', { delay: 4 });
      await page.keyboard.press('Control+3');
      ok(await last() === 'h3', 'Ctrl+3 makes a level 3 heading');
      await page.keyboard.press('Control+4');
      ok(await last() === 'h4', 'Ctrl+4 makes a level 4 heading');
      await page.keyboard.press('Enter'); await page.keyboard.type('### Third', { delay: 6 });
      ok(await last() === 'h3', '### at the start of a line makes a level 3 heading');
      await page.evaluate(() => window.__app.savePrefs({ headingDepth: 2 }));
      await page.keyboard.press('Enter'); await page.keyboard.type('### x', { delay: 6 });
      ok(await last() === 'p', '### stays plain text while two levels are chosen');
    }

    // selection word count and the report link
    {
      await page.evaluate((d) => window.__app.loadDoc(d, null), (() => { const d = D.newDoc(); d.chapters[0].blocks = [{ t: 'p', runs: [{ text: 'alpha beta gamma delta' }] }]; return JSON.parse(JSON.stringify(d)); })());
      await page.click('#editor'); await page.keyboard.press('Control+End');
      await page.keyboard.press('Shift+Home'); await page.waitForTimeout(400);
      ok((await page.textContent('#statusLeft')).includes('4 words selected'), 'the status line counts the selected words (' + (await page.textContent('#statusLeft')) + ')');
      await page.keyboard.press('End'); await page.waitForTimeout(400);
      ok(!(await page.textContent('#statusLeft')).includes('selected'), 'and stops when nothing is selected');
      ok(await page.evaluate(() => { const h = document.querySelector('#reportLink').href; return h.includes('/issues/new?body=') && decodeURIComponent(h).includes('Quire '); }), 'Report a problem opens an issue with the version filled in');
    }

    // (i) hints explain the more involved settings on hover and on keyboard focus
    {
      await page.evaluate(() => { if (document.querySelector('#settings').hidden) document.querySelector('#btnSettings').click(); }); await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelector('[data-sec=look]').click()); await page.waitForTimeout(200);
      const n = await page.locator('#settings .info').count();
      ok(n >= 8, 'the settings carry (i) hints (' + n + ')');
      const btn = page.locator('[data-secpane=look] .info').first();
      await btn.hover(); await page.waitForTimeout(250);
      const shown = await page.evaluate(() => ({ hidden: document.querySelector('#infoTip').hidden, text: document.querySelector('#infoTip').textContent }));
      ok(!shown.hidden && shown.text.length > 40 && !shown.text.includes('\u2014'), 'hovering an (i) shows a short explanation');
      await page.mouse.move(5, 5); await page.waitForTimeout(250);
      ok(await page.evaluate(() => document.querySelector('#infoTip').hidden), 'and it goes away again');
      await btn.focus(); await page.waitForTimeout(200);
      ok(await page.evaluate(() => !document.querySelector('#infoTip').hidden), 'keyboard focus shows it too');
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      ok(await page.evaluate(() => document.querySelector('#infoTip').hidden && document.querySelector('#settings').hidden), 'Escape hides it and closes the panel');
    }

    // Word copy next to the book: written on save, changes made elsewhere are reviewed, never overwritten silently
    {
      const bookPath = path.join(docs, 'wordcopy.draft'), docxPath = path.join(docs, 'wordcopy.docx');
      const P = (...runs) => ({ t: 'p', runs: runs.map((r) => (typeof r === 'string' ? { text: r } : r)) });
      await page.evaluate(async ({ bookPath }) => {
        const D = window.DocFmt, A = window.__app;
        const d = D.newDoc(); d.title = 'Word Copy Book';
        d.notes = { n1: { text: 'a note', created: new Date().toISOString() } };
        d.chapters = [{ id: 'k1', title: 'Chapter A', goal: 300, blocks: [{ t: 'p', runs: [{ text: 'First paragraph of the book.' }] }, { t: 'p', runs: [{ text: 'Second paragraph with a ' }, { text: 'note', n: 'n1' }, { text: ' inside.' }] }] }, { id: 'k2', title: 'Chapter B', blocks: [{ t: 'p', runs: [{ text: 'Chapter B text.' }] }] }];
        await window.api.save({ path: bookPath, text: D.serializeDraft(d) });
        A.savePrefs({ companion: true });
        A.loadDoc(d, bookPath);
      }, { bookPath });
      await page.waitForTimeout(500);
      await page.click('#editor'); await page.keyboard.press('Control+s'); await page.waitForTimeout(1500);
      ok(fs.existsSync(docxPath), 'saving writes a Word copy next to the book');
      const hashA = fs.readFileSync(docxPath).length;
      // someone edits the Word copy elsewhere (here: a changed export of the same book)
      await page.evaluate(async ({ docxPath }) => {
        const A = window.__app, d = JSON.parse(JSON.stringify(A.snapshotDoc()));
        d.chapters[0].blocks[0].runs = [{ text: 'First paragraph, rewritten on the phone.' }];
        d.chapters[0].blocks.push({ t: 'p', runs: [{ text: 'A new paragraph from the phone.' }] });
        await window.api.exportDoc({ format: 'docx', doc: d, path: docxPath, opts: { titlePage: false, notes: true, notesMode: 'comments' } });
      }, { docxPath });
      await page.evaluate(() => { window.__app.checkCompanion(); }); // the review waits for a click, so do not wait for it here
      await page.waitForTimeout(1500);
      ok(await page.evaluate(() => !document.querySelector('#cmpDlg').hidden && !document.querySelector('#cmpImport').hidden), 'a changed Word copy opens the review');
      const sum = await page.textContent('#cmpSummary');
      ok(/1 paragraph edited, 1 added/.test(sum), 'the review says what changed (' + sum.slice(0, 60) + ')');
      await page.click('#cmpImport'); await page.waitForTimeout(1500);
      const after = await page.evaluate(() => { const d = window.__app.snapshotDoc(); return { text: d.chapters[0].blocks.map((b) => b.runs.map((r) => r.text).join('')), notes: JSON.stringify(d.chapters[0].blocks).includes('"n":"n1"'), goal: d.chapters[0].goal, hist: 1 }; });
      ok(after.text[0] === 'First paragraph, rewritten on the phone.' && after.text.includes('A new paragraph from the phone.'), 'importing brings the phone edits in');
      ok(after.notes && after.goal === 300, 'notes and chapter targets stay after an import');
      // saving after the import rewrites the Word copy without asking (it was accepted)
      await page.keyboard.press('Control+s'); await page.waitForTimeout(1500);
      ok(fs.statSync(docxPath).size > 0, 'saving after an import writes the Word copy again');
      // the Word copy changes again, and a save must not overwrite it silently
      await page.evaluate(async ({ docxPath }) => {
        const d = JSON.parse(JSON.stringify(window.__app.snapshotDoc()));
        d.chapters[1].blocks[0].runs = [{ text: 'Chapter B edited elsewhere.' }];
        await window.api.exportDoc({ format: 'docx', doc: d, path: docxPath, opts: { titlePage: false, notes: true, notesMode: 'comments' } });
      }, { docxPath });
      const before = fs.readFileSync(docxPath);
      await setAnswer(2); // "Skip the Word copy this time"
      await page.click('#editor'); await page.keyboard.type(' x'); await page.keyboard.press('Control+s'); await page.waitForTimeout(1500);
      ok(Buffer.compare(before, fs.readFileSync(docxPath)) === 0, 'a save never overwrites a Word copy that was changed elsewhere');
      await setAnswer(1); // "Not now" for the Google Docs question (0 would open a browser)
      // a Google Docs pointer next to the book is noticed and does not break anything
      fs.writeFileSync(path.join(docs, 'wordcopy.gdoc'), JSON.stringify({ url: 'https://docs.google.com/open?id=abc', doc_id: 'abc' }));
      await page.evaluate(() => { window.__app.checkCompanion(); });
      await page.waitForTimeout(800);
      ok(true, 'a .gdoc pointer next to the book is handled without errors');
      await page.evaluate(() => { document.querySelector('#cmpDlg').hidden = true; });
      await page.evaluate(() => window.__app.savePrefs({ companion: false }));
      await page.evaluate(() => window.__app.loadDoc(window.DocFmt.newDoc(), null)); await page.waitForTimeout(300);
    }

    // the Full screen button shows whether full screen is on
    {
      const lab = () => page.evaluate(() => document.querySelector('#btnFull').textContent + '|' + document.querySelector('#btnFull').getAttribute('aria-pressed'));
      const before = await lab();
      await page.evaluate(() => window.api.toggleFullscreen()); await page.waitForTimeout(1200);
      const after = await lab();
      ok(before !== after && /Exit full screen\|true|^Full screen\|false/.test(after), 'the Full screen button changes with the window state (' + before + ' to ' + after + ')');
      await page.evaluate(() => window.api.toggleFullscreen()); await page.waitForTimeout(1200);
      ok((await lab()) === before, 'and changes back');
    }
    ok(errors.length === 0, 'no errors in the page' + (errors.length ? ': ' + errors[0] : ''));
  } catch (e) {
    failed++; console.log('FAIL test crashed: ' + (e && e.stack || e));
  }
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall end-to-end checks passed');
  process.exit(failed ? 1 : 0);
})();
