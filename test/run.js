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

  // a file saved with a byte-order mark (Notepad, PowerShell) still opens
  assert.doesNotThrow(() => D.parseDraft('\uFEFF' + D.serializeDraft(D.newDoc())), 'a draft with a BOM opens');
  console.log('ok bom');

  // a release tag must match package.json, or the release step cannot find the files (only checked on GitHub, for tags)
  if (process.env.GITHUB_REF_TYPE === 'tag') {
    const v = require('../package.json').version;
    assert.strictEqual(process.env.GITHUB_REF_NAME, 'v' + v, 'the tag ' + process.env.GITHUB_REF_NAME + ' must match package.json version ' + v + ' (use tag v' + v + ', or change the version)');
    console.log('ok tag matches version');
  }


  // ---- 1.2 features: scene break, goals, diff, page size, footnotes, epub, require/files ----
  {
    const E = require('../exporters.js');
    const DD = require('../shared/diff.js');
    const P = (t) => ({ t: 'p', runs: [{ text: t }] });
    assert(D.isBreak(P('* * *')) && D.isBreak(P('***')) && !D.isBreak(P('* * * *')) && !D.isBreak(P('a * * *')), 'isBreak');
    const sd = { id: 'x1', title: 'T', subtitle: '', author: 'A', extra: '', created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', notes: {}, chapters: [{ id: 'c1', title: 'One', goal: 1500, blocks: [P('Up'), P('* * *'), P('Down')] }] };
    const md = D.toMarkdown(sd, {});
    assert(md.includes('\n* * *\n'), 'markdown scene break');
    const back = D.fromMarkdown('Up\n\n---\n\nDown\n');
    assert(back.chapters[0].blocks.map((b) => D.blockText(b)).join('|') === 'Up|* * *|Down', 'a horizontal rule imports as a scene break');
    const rt = D.parseDraft(D.serializeDraft(sd));
    assert.strictEqual(rt.chapters[0].goal, 1500, 'chapter goal survives save and open');
    assert(!('goal' in D.parseDraft(D.serializeDraft(Object.assign({}, sd, { chapters: [Object.assign({}, sd.chapters[0], { goal: 0 })] }))).chapters[0]) || !D.parseDraft(D.serializeDraft(Object.assign({}, sd, { chapters: [Object.assign({}, sd.chapters[0], { goal: 0 })] }))).chapters[0].goal, 'no goal when zero');
    // diff
    const old = { chapters: [{ title: 'One', blocks: [P('The quick brown fox jumps'), P('Gone paragraph here entirely'), P('Same')] }] };
    const cur = { chapters: [{ title: 'One', blocks: [P('The quick red fox jumps'), P('Same'), P('Brand new ending')] }] };
    const r = DD.compare(old, cur);
    assert.strictEqual(r.changed, 1, 'one edited paragraph'); assert.strictEqual(r.removed, 1); assert.strictEqual(r.added, 1);
    const chg = r.rows.find((x) => x.kind === 'chg');
    assert(chg.parts.some((p) => p.op === 'del' && p.text.trim() === 'brown') && chg.parts.some((p) => p.op === 'add' && p.text.trim() === 'red'), 'word level diff');
    assert.strictEqual(DD.compare(cur, cur).rows.every((x) => x.kind === 'same'), true, 'identical texts have no differences');
    // an empty, untitled chapter is not exported as an "Untitled chapter" page
    const ed = { id: 'e1', title: 'T', subtitle: '', author: '', extra: '', created: sd.created, modified: sd.modified, notes: {}, chapters: [
      { id: 'a', title: 'One', blocks: [P('Text')] }, { id: 'b', title: '', blocks: [P('')] }, { id: 'c', title: 'Titled but empty', blocks: [P('')] }, { id: 'd', title: 'Four', blocks: [P('More')] } ] };
    const emd = D.toMarkdown(ed, {});
    assert(!emd.includes('Untitled chapter'), 'markdown skips an untitled empty chapter');
    assert(emd.includes('# Titled but empty'), 'a chapter with a title stays even when empty');
    assert(!D.toPlainText(ed, {}).includes('UNTITLED CHAPTER'), 'plain text skips an untitled empty chapter');
    assert(D.forExport({ chapters: [{ id: 'z', title: '', blocks: [P('')] }] }, {}).chapters.length === 1, 'a book that is all empty still exports one chapter');
    // page size and margins
    const g = E.pageGeometry({ pageSize: 'a5', margins: 'narrow' });
    assert(g && g.size.width < E.pageGeometry({ pageSize: 'a4', margins: 'narrow' }).size.width, 'A5 is narrower than A4');
    const html = E.toHtml(sd, { pageSize: 'a5', margins: 'wide', font: 'serif', notes: false });
    assert(/@page\{size:148mm 210mm/.test(html), 'html @page uses the chosen page size');
    assert(html.includes('class="sb"'), 'scene break in html');
    // footnotes in docx
    const nd = Object.assign({}, sd, { notes: { n1: { text: 'A footnote text', created: '2026-01-01T00:00:00.000Z' } }, chapters: [{ id: 'c1', title: 'One', blocks: [{ t: 'p', runs: [{ text: 'See this', n: 'n1' }, { text: ' and go' }] }] }] });
    const buf = await E.toDocx(nd, { notes: true, notesMode: 'footnotes', pageSize: 'a5' });
    const zip = require('child_process').execFileSync('python3', ['-I', '-c', 'import sys,zipfile,io;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));print("\\n".join(z.namelist()));print(z.read("word/footnotes.xml").decode() if "word/footnotes.xml" in z.namelist() else "");print(z.read("word/document.xml").decode())'], { input: buf, maxBuffer: 1 << 26 }).toString();
    assert(zip.includes('word/footnotes.xml') && zip.includes('A footnote text') && zip.includes('w:footnoteReference'), 'docx has a real footnote');
    assert(/w:pgSz[^>]*w:w="8391"/.test(zip) || /w:pgSz[^>]*w:w="8\d\d\d"/.test(zip), 'docx page width is A5 (' + (zip.match(/<w:pgSz[^>]*>/) || [''])[0] + ')');
    // epub
    const { toEpub } = require('../epub.js');
    const eb = toEpub(sd, { lang: 'en' });
    assert(Buffer.isBuffer(eb) && eb.slice(0, 2).toString() === 'PK', 'epub is a zip');
    assert.strictEqual(eb.slice(30, 38).toString(), 'mimetype', 'mimetype is the first entry');
    assert(eb.slice(38, 38 + 20).toString() === 'application/epub+zip', 'mimetype is stored, not compressed');
    // every local file main.js needs at runtime must ship in the installer
    const pkg = require('../package.json'), files = (pkg.build && pkg.build.files) || [];
    for (const f of ['main.js', 'exporters.js', 'epub.js']) {
      for (const m of fs.readFileSync(path.join(__dirname, '..', f), 'utf8').matchAll(/require\('\.\/([\w.-]+?)(?:\.js)?'\)/g)) {
        assert(files.includes(m[1] + '.js') || files.some((x) => x.endsWith('/**') || x === '**/*'), f + ' requires ./' + m[1] + '.js which must be in build.files');
      }
    }
    console.log('ok 1.2 features');
  }

  // every setting the app saves must really be in DEFAULT_PREFS (a stray // once swallowed five of them)
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const block = mainSrc.slice(mainSrc.indexOf('const DEFAULT_PREFS = {'), mainSrc.indexOf('\n};', mainSrc.indexOf('const DEFAULT_PREFS = {')));
  for (const key of ['size', 'lineHeight', 'titlePage', 'showSession', 'richPaste', 'pageNumbers', 'focus', 'streak', 'autoUpdate', 'bookGoal', 'pageSize', 'margins', 'notesMode', 'smartQuotes', 'friendly']) {
    const line = block.split('\n').find((l) => new RegExp('(^|[ ,{])' + key + ':').test(l));
    assert(line, 'DEFAULT_PREFS has ' + key);
    assert(!/\/\/.*\b/.test(line.slice(0, line.search(new RegExp('(^|[ ,{])' + key + ':')) + 1)), key + ' is not inside a comment');
  }
  console.log('ok default settings');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
