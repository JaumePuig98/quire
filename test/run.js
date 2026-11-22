const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../shared/doc.js');
const X = require('../exporters.js');

(async () => {
  // Damaged files must never crash the loader: they are repaired or reduced to what is readable.
  const damaged = [
    { chapters: [{ id: 'a', title: 'x', blocks: [{ t: 'p', runs: [{ text: 42 }] }] }] },
    { chapters: [{ id: 'a', blocks: [{ t: 'script', runs: [{ text: 'hi', n: 'a"]x' }] }] }] },
    { chapters: [{ id: 'a', blocks: [{ t: 'p', runs: [null] }] }] },
    { chapters: [null, 5, 'x'] },
    { chapters: [{ blocks: [null, 3] }] },
    { chapters: 'nope', notes: 7 },
    { chapters: [{ id: 'a', blocks: [] }, { id: 'a', blocks: [] }], notes: { bad: null, 'x y': { text: 't' }, ok: { text: 'fine' } } },
  ];
  for (const d of damaged) {
    const v = D.validate(Object.assign({ format: 'draft', version: 1 }, d));
    assert.ok(v.id && v.chapters.length >= 1 && v.chapters.every((c) => c.blocks.length >= 1));
    assert.strictEqual(new Set(v.chapters.map((c) => c.id)).size, v.chapters.length);
    D.toMarkdown(v, {}); D.toPlainText(v, {}); D.toMarkdown(D.parseDraft(D.serializeDraft(v)), {});
  }
  assert.deepStrictEqual(Object.keys(D.validate({ format: 'draft', version: 1, chapters: [], notes: { ok: { text: 'a' }, bad: 1, 'x y': { text: 'b' } } }).notes), ['ok']);
  assert.throws(() => D.parseDraft('{"format":"other"}'));
  assert.throws(() => D.parseDraft('not json'));
  const idDoc = D.newDoc();
  assert.strictEqual(D.parseDraft(D.serializeDraft(idDoc)).id, idDoc.id);
  assert.strictEqual(D.slugify('My Great Novel: Part 1'), 'my-great-novel-part-1');
  assert.strictEqual(D.slugify('  Él cuervo & la luna!  '), 'el-cuervo-la-luna');
  assert.strictEqual(D.slugify('???'), 'untitled');
  assert.ok(D.isCite({ t: 'quote', runs: [{ text: ' \u2014 Author' }] }));
  assert.ok(!D.isCite({ t: 'p', runs: [{ text: '- not a quote' }] }));
  const doc = D.newDoc();
  doc.title = 'Test book';
  doc.chapters[0].title = 'The Lamp';
  doc.chapters[0].blocks = [
    { t: 'h1', runs: [{ text: 'A heading' }] },
    { t: 'p', runs: [{ text: 'Plain ' }, { text: 'bold', b: 1 }, { text: ' and ' }, { text: 'italic*star', i: 1 }, { text: ' and ' }, { text: 'note me', u: 1, n: 'n1' }, { text: ' end.' }] },
    { t: 'quote', runs: [{ text: 'A quoted line.' }] },
    { t: 'p', runs: [] },
  ];
  doc.chapters.push({ id: 'c2', title: 'Second', blocks: [{ t: 'p', runs: [{ text: 'Chapter two text. ' }, { text: 'across', n: 'n1' }] }] });
  doc.notes.n1 = { text: 'Check this passage', created: D.now() };

  // .draft round trip
  const s = D.serializeDraft(doc);
  const back = D.parseDraft(s);
  assert.strictEqual(back.chapters.length, 2);
  assert.strictEqual(back.chapters[0].blocks[1].runs[3].text, 'italic*star');
  assert.strictEqual(back.notes.n1.text, 'Check this passage');
  assert.throws(() => D.parseDraft('{"format":"other"}'));
  assert.throws(() => D.parseDraft('not json'));
  assert.throws(() => D.parseDraft('{"format":"draft","version":99,"chapters":[]}'));
  console.log('ok draft round-trip,', D.countDoc(doc), 'words');

  // markdown
  const md = D.toMarkdown(doc, { notes: true });
  assert(md.includes('# The Lamp'));
  assert(md.includes('## A heading'));
  assert(md.includes('**bold**'));
  assert(md.includes('*italic\\*star*'));
  assert(md.includes('<u>note me</u>[^1]'));
  assert(md.includes('[^1]: Check this passage'));
  assert(md.includes('> A quoted line.'));
  const imp = D.fromMarkdown(D.toMarkdown(doc, { notes: false }));
  const para = imp.chapters[0].blocks.find((b) => b.runs.some((r) => r.b));
  assert(para.runs.some((r) => r.b && r.text === 'bold'));
  assert(para.runs.some((r) => r.i && r.text === 'italic*star'));
  assert(para.runs.some((r) => r.u && r.text === 'note me'));
  assert(D.toPlainText(doc, { notes: true }).includes('[1] Check this passage'));
  console.log('ok markdown');

  // docx
  const buf = await X.toDocx(doc, { font: 'serif', notes: true, author: 'Tester' });
  const out = path.join(os.tmpdir(), 'wa-test.docx');
  fs.writeFileSync(out, buf);
  const buf2 = await X.toDocx(doc, { font: 'sans', notes: false });
  fs.writeFileSync(path.join(os.tmpdir(), 'wa-test-nonotes.docx'), buf2);
  console.log('ok docx written', buf.length);

  // docx import: export a book, read it back
  {
    const { importDocx } = require('../docx-import.js');
    const book = D.newDoc(); book.title = 'Round Trip';
    book.chapters = [
      { id: 'c1', title: '', blocks: [{ t: 'h1', runs: [{ text: 'One' }] }, { t: 'p', runs: [{ text: 'Plain ' }, { text: 'bold', b: 1 }, { text: ' and ' }, { text: 'italic', i: 1 }, { text: ' text.' }] }, { t: 'quote', runs: [{ text: 'A quote' }] }] },
      { id: 'c2', title: '', blocks: [{ t: 'h1', runs: [{ text: 'Two' }] }, { t: 'h2', runs: [{ text: 'Part' }] }, { t: 'p', runs: [{ text: 'More words here, caf\u00e9 & <tags>.' }] }] },
    ];
    const f = path.join(os.tmpdir(), 'wa-roundtrip.docx');
    fs.writeFileSync(f, await X.toDocx(book, { font: 'serif' }));
    const back = await importDocx(f, 'wa-roundtrip');
    assert.strictEqual(back.chapters.length, 2, 'one chapter per Heading 1');
    assert.ok(!JSON.stringify(back).includes('Untitled chapter'), 'chapters take their Heading 1 as name, never Untitled chapter');
    assert.strictEqual(back.chapters[0].blocks[0].t, 'h1');
    const t0 = back.chapters[0].blocks[1].runs;
    assert.ok(t0.some((r) => r.b && r.text === 'bold') && t0.some((r) => r.i && r.text === 'italic'), 'bold and italic survive');
    assert.ok(D.blockText(back.chapters[1].blocks[2]).includes('caf\u00e9 & <tags>.'), 'special characters survive');
    assert.ok(back.chapters[1].blocks.some((b) => b.t === 'h2'), 'Heading 2 survives');
    assert.ok(back.chapters[0].blocks.some((b) => b.t === 'quote'), 'quote style survives');
    assert.doesNotThrow(() => D.parseDraft(D.serializeDraft(back)));
    // compile: chosen chapters only, title page
    book.author = 'A. Writer';
    const md = D.toMarkdown(book, { chapterIds: ['c2'], titlePage: true, author: book.author });
    assert.ok(md.startsWith('# Round Trip\n\nby A. Writer\n\n---') && md.includes('# Two') && !md.includes('One'), 'compile: title page and chosen chapters');
    const txt = D.toPlainText(book, { chapterIds: ['c1'] });
    assert.ok(txt.includes('ONE') && !txt.includes('Two'), 'compile: plain text keeps chosen chapters');
    const f2 = path.join(os.tmpdir(), 'wa-title.docx');
    fs.writeFileSync(f2, await X.toDocx(book, { titlePage: true, author: book.author, chapterIds: ['c1', 'c2'] }));
    const back2 = await importDocx(f2, 'x');
    const full = D.parseDraft(D.serializeDraft(Object.assign(D.newDoc(), { author: 'Me', subtitle: 'Sub', extra: 'A novel' })));
    assert.ok(full.author === 'Me' && full.subtitle === 'Sub' && full.extra === 'A novel', 'author, subtitle and extra line are kept in the file');
    book.subtitle = 'A Quiet Tale'; book.extra = 'A novel';
    const md2 = D.toMarkdown(book, { titlePage: true, author: 'A. Writer' });
    assert.ok(md2.startsWith('# Round Trip\n\n*A Quiet Tale*\n\nby A. Writer\n\nA novel\n\n---'), 'title page: subtitle, author, extra line in order');
    assert.ok(!D.toMarkdown(book, { titlePage: true }).includes('by '), 'empty author is left out');
    const h2 = X.toHtml(book, { titlePage: true, author: 'A. Writer' });
    assert.ok(h2.includes('class="subtitle">A Quiet Tale') && h2.includes('class="extra">A novel'), 'html title page has subtitle and extra line');
    const nb = D.parseDraft(D.serializeDraft(Object.assign({}, book, { chapters: [Object.assign({}, book.chapters[0], { nonum: true }), book.chapters[1]] })));
    assert.ok(nb.chapters[0].nonum === true && !nb.chapters[1].nonum, 'a chapter keeps its hidden-number flag in the file');
    const hh = X.toHtml(nb, { pageNumbers: true });
    assert.ok(/class="chapter nonum"/.test(hh) && hh.includes('counter(page)'), 'html: hidden chapter gets the nonum page, others are numbered');
    console.log('ok docx import');
  }

  // html
  const html = X.toHtml(doc, { font: 'serif', notes: true, fontsDir: path.join(__dirname, '..', 'renderer', 'fonts') });
  assert(html.includes('<h1>The Lamp</h1>') && html.includes('<h2>A heading</h2>') && html.includes('class="nref"'));
  fs.writeFileSync(path.join(os.tmpdir(), 'wa-test.html'), html);
  console.log('ok html');

  // every setting the app saves must really be in DEFAULT_PREFS (a stray // once swallowed five of them)
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const block = mainSrc.slice(mainSrc.indexOf('const DEFAULT_PREFS = {'), mainSrc.indexOf('\n};', mainSrc.indexOf('const DEFAULT_PREFS = {')));
  for (const key of ['size', 'lineHeight', 'titlePage', 'showSession', 'richPaste', 'pageNumbers', 'focus', 'streak', 'autoUpdate', 'bookGoal']) {
    const line = block.split('\n').find((l) => new RegExp('(^|[ ,{])' + key + ':').test(l));
    assert(line, 'DEFAULT_PREFS has ' + key);
    assert(!/\/\/.*\b/.test(line.slice(0, line.search(new RegExp('(^|[ ,{])' + key + ':')) + 1)), key + ' is not inside a comment');
  }
  console.log('ok default settings');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
