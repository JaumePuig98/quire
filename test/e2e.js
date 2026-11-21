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
