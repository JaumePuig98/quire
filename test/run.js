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
    assert.ok(back.chapters[1].blocks.some((b) => b.t === 'h3'), 'a sub-heading keeps its depth (the Word copy puts it one level down under the chapter headings)');
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
    // headings go down to level 4
    {
      const H = (t, x) => ({ t, runs: [{ text: x }] });
      const hd = { id: 'h1', title: 'T', subtitle: '', author: '', extra: '', created: sd.created, modified: sd.modified, notes: {}, chapters: [
        { id: 'a', title: 'One', blocks: [H('h1', 'A'), H('h2', 'B'), H('h3', 'C'), H('h4', 'D'), P('x')] }, { id: 'b', title: 'Two', blocks: [P('y')] }] };
      const hmd = D.toMarkdown(hd, {});
      assert(hmd.includes('## A') && hmd.includes('### B') && hmd.includes('#### C') && hmd.includes('##### D'), 'deep headings keep their depth in Markdown');
      const back = D.parseDraft(D.serializeDraft(hd));
      assert(back.chapters[0].blocks.map((b) => b.t).join() === 'h1,h2,h3,h4,p', 'headings 3 and 4 survive saving and opening');
      const imp = D.parseDraft ? D.fromMarkdown ? D.fromMarkdown('#### Deep\n\ntext') : null : null;
      if (imp) assert(imp.chapters[0].blocks[0].t === 'h4', 'a #### line in a Markdown file is heading 4');
      const html = await new Promise((res) => res(X.toHtml ? X.toHtml(hd, {}) : ''));
      if (html) assert(/<h4>C<\/h4>/.test(html) && /<h5>D<\/h5>/.test(html), 'deep headings export as HTML headings');
    }
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


  // ---- Word copy: export, edit "on the phone", import and merge back without losing notes, targets or page-number settings ----
  {
    const E = require('../exporters.js'), M = require('../shared/merge.js'), DD = require('../shared/diff.js');
    const { importRaw } = require('../docx-import.js');
    const os = require('os');
    const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), 'quire-merge-'));
    const P = (...runs) => ({ t: 'p', runs: runs.map((r) => (typeof r === 'string' ? { text: r } : r)) });
    const now = '2026-01-01T00:00:00.000Z';
    const mk = () => ({ id: 'abc123', title: 'Book', subtitle: 'sub', author: 'A', extra: '', created: now, modified: now,
      notes: { n1: { text: 'First note', created: now }, n2: { text: 'Second note', created: now } },
      chapters: [
        { id: 'c1', title: 'Prologue', nonum: true, blocks: [P('Plain & simple ', { text: 'bold', b: true }, { text: ' ital', i: true }, { text: ' noted', n: 'n1' })] },
        { id: 'c2', title: 'Chapter two', goal: 500, blocks: [{ t: 'h1', runs: [{ text: 'Big heading' }] }, P('Before the break'), P('* * *'), P('After the break', { text: ' second note', n: 'n2' }), { t: 'quote', runs: [{ text: 'A quote' }] }, { t: 'quote', runs: [{ text: '\u2014 Someone' }] }, { t: 'h2', runs: [{ text: 'Small' }] }, P('Tail\nwith break')] },
        { id: 'c3', title: '', blocks: [P('')] },
        { id: 'c4', title: 'Last', blocks: [P('The end of the story, it was long.'), P('')] },
      ] });
    const through = async (edited, base) => { // Word copy of `edited`, imported and merged into `base`
      const f = path.join(tmpd, 'c' + Math.random().toString(36).slice(2) + '.docx');
      fs.writeFileSync(f, await E.toDocx(edited, { titlePage: false, notes: true, notesMode: 'comments', pageNumbers: true }));
      const ex = D.forExport(base, {});
      const imp = M.chaptersFromRaw(await importRaw(f), D.headingPlan(ex).chapterHeadings);
      return M.merge(base, imp, new Set(ex.chapters.map((c) => c.id)));
    };
    const noteIds = (d) => d.chapters.flatMap((c) => c.blocks.flatMap((b) => b.runs.filter((r) => r.n).map((r) => r.n)));
    // 1. nothing edited: nothing to import, nothing lost
    let base = mk();
    let r = await through(mk(), base);
    assert.strictEqual(DD.compare(base, r.doc).rows.filter((x) => x.kind !== 'same').length, 0, 'an untouched Word copy shows no differences');
    assert.deepStrictEqual(noteIds(r.doc), ['n1', 'n2'], 'notes stay');
    assert(r.doc.chapters[1].goal === 500 && r.doc.chapters[0].nonum === true && r.doc.chapters.length === 4, 'targets, page-number settings and the empty chapter stay');
    // 1b. headings down to level 4 come back from the Word copy as they were
    {
      const hb = mk();
      hb.chapters[1].blocks = [{ t: 'h1', runs: [{ text: 'Part' }] }, { t: 'h2', runs: [{ text: 'Section' }] }, { t: 'h3', runs: [{ text: 'Sub' }] }, { t: 'h4', runs: [{ text: 'Deep' }] }, P('Body text here')];
      const rh = await through(hb, hb);
      assert.strictEqual(rh.doc.chapters[1].blocks.map((b) => b.t).join(), 'h1,h2,h3,h4,p', 'headings 3 and 4 survive the Word copy');
    }
    // 2. edits on the phone: reword one paragraph with a note, delete one, add one, add a chapter, rename a chapter
    const ed = mk();
    ed.chapters[1].blocks[3] = P('After the break', { text: ' second note changed a lot', n: 'n2' }); // note anchor text changed
    ed.chapters[1].blocks.splice(1, 1); // "Before the break" deleted
    ed.chapters[1].blocks.push(P('A brand new paragraph typed on the phone.'));
    ed.chapters[3].title = 'The Last Chapter'; // renamed
    ed.chapters.push({ id: 'zz', title: 'Epilogue', blocks: [P('Afterwards.')] });
    r = await through(ed, mk());
    const txt = (d) => d.chapters.map((c) => c.title + ':' + c.blocks.map((b) => D.blockText(b)).join('|')).join('\n');
    assert(txt(r.doc).includes('second note changed a lot'), 'the edited paragraph is imported');
    assert(!txt(r.doc).includes('Before the break'), 'the deleted paragraph is gone');
    assert(txt(r.doc).includes('A brand new paragraph typed on the phone.'), 'the new paragraph is in');
    assert(r.doc.chapters.some((c) => c.title === 'The Last Chapter' && c.id === 'c4'), 'a renamed chapter keeps its identity');
    assert(r.doc.chapters[r.doc.chapters.length - 1].title === 'Epilogue', 'a new chapter is added at the end');
    assert(noteIds(r.doc).includes('n1') && noteIds(r.doc).includes('n2'), 'notes survive an edited paragraph');
    assert(r.doc.chapters.find((c) => c.id === 'c2').goal === 500, 'a chapter target survives edits');
    assert(r.doc.chapters.find((c) => c.id === 'c3'), 'the empty chapter that was not in the Word copy stays');
    assert(D.serializeDraft(Object.assign({ }, r.doc)).includes('"n"'), 'the merged book still saves with its notes');
    // 3. formatting only changes are text changes too
    const fm = mk(); fm.chapters[0].blocks[0] = P('Plain & simple ', { text: 'BOLD NOW', b: true });
    r = await through(fm, mk());
    assert(DD.compare(mk(), r.doc).changed >= 1, 'an edited paragraph shows as changed');
    // 4. a book with one untitled chapter: headings are not chapters
    const one = { id: 'o1', title: '', subtitle: '', author: '', extra: '', created: now, modified: now, notes: {}, chapters: [{ id: 'k', title: '', blocks: [{ t: 'h1', runs: [{ text: 'Heading' }] }, P('Body text here.'), { t: 'h2', runs: [{ text: 'Sub' }] }, P('More body.')] }] };
    r = await through(one, JSON.parse(JSON.stringify(one)));
    assert.strictEqual(r.doc.chapters.length, 1, 'a single untitled chapter stays one chapter');
    assert(r.doc.chapters[0].blocks.map((b) => b.t).join(',') === 'h1,p,h2,p', 'heading levels survive in a single chapter book (' + r.doc.chapters[0].blocks.map((b) => b.t).join(',') + ')');
    // 5. a poem in the Word copy: untouched it comes back as it was, and an edited line does not break the stanzas
    const pm = mk(); pm.chapters[0].blocks.push({ t: 'poem', runs: [{ text: 'Roses are red\nViolets are blue' }] }, { t: 'poem', runs: [{ text: 'Second stanza\n  indented line' }] }, P('After the poem.'));
    base = JSON.parse(JSON.stringify(pm));
    r = await through(JSON.parse(JSON.stringify(pm)), base);
    assert.strictEqual(DD.compare(base, r.doc).rows.filter((x) => x.kind !== 'same').length, 0, 'an untouched Word copy with a poem shows no differences');
    assert(r.doc.chapters[0].blocks.filter((b) => b.t === 'poem').length === 2 && r.doc.chapters[0].blocks.find((b) => b.t === 'poem').runs[0].text === 'Roses are red\nViolets are blue', 'poems keep their stanzas and lines after a round trip');
    const pe = JSON.parse(JSON.stringify(pm)); pe.chapters[0].blocks[1].runs[0].text = 'Roses are red\nViolets are violet';
    r = await through(pe, JSON.parse(JSON.stringify(pm)));
    assert(D.blockText(r.doc.chapters[0].blocks.find((b) => b.t === 'poem')) === 'Roses are red\nViolets are violet' && r.doc.chapters[0].blocks.filter((b) => b.t === 'poem').length === 2, 'an edited poem line comes back as one stanza, not as loose paragraphs');
    console.log('ok word copy merge');
  }

  // every setting the app saves must really be in DEFAULT_PREFS (a stray // once swallowed five of them)
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const block = mainSrc.slice(mainSrc.indexOf('const DEFAULT_PREFS = {'), mainSrc.indexOf('\n};', mainSrc.indexOf('const DEFAULT_PREFS = {')));
  for (const key of ['size', 'lineHeight', 'titlePage', 'showSession', 'richPaste', 'pageNumbers', 'focus', 'streak', 'autoUpdate', 'bookGoal', 'pageSize', 'margins', 'notesMode', 'smartQuotes', 'friendly', 'companion', 'glowStrength', 'glowColor', 'introSeen', 'finishBy', 'lastVersion', 'caret', 'caretBlink', 'fadeReach', 'names', 'sprintMin', 'startWith', 'journalAuto', 'journalDayStart', 'journalDate', 'journalTime']) {
    const line = block.split('\n').find((l) => new RegExp('(^|[ ,{])' + key + ':').test(l));
    assert(line, 'DEFAULT_PREFS has ' + key);
    assert(!/\/\/.*\b/.test(line.slice(0, line.search(new RegExp('(^|[ ,{])' + key + ':')) + 1)), key + ' is not inside a comment');
  }
  console.log('ok default settings');
  {
    // starting structures and release notes
    const TP = require('../shared/templates.js'), WN = require('../shared/whatsnew.js');
    assert(TP.list.length >= 5 && TP.list[0].id === 'blank', 'templates start with a blank book');
    const ids = new Set();
    for (const tpl of TP.list) {
      assert(!ids.has(tpl.id), 'template ids are unique'); ids.add(tpl.id);
      const doc = TP.build(D, tpl.id);
      assert(D.validate(doc), tpl.id + ' builds a valid document');
      assert(doc.chapters.length >= 1 && new Set(doc.chapters.map((c) => c.id)).size === doc.chapters.length, tpl.id + ' has chapters with unique ids');
      const back = D.parseDraft(D.serializeDraft(doc));
      assert(back.chapters.length === doc.chapters.length, tpl.id + ' survives a save and reopen');
    }
    assert(TP.build(D, 'novel').chapters.length === 3 && TP.build(D, 'blank').chapters.length === 1, 'novel has three chapters, blank has one');
    const art = TP.build(D, 'article');
    assert(art.chapters[0].title === 'Abstract' && art.chapters.every((c) => c.nonum), 'a scientific article has named, unnumbered sections');
    for (const v of Object.keys(WN)) {
      assert(/^\d+\.\d+\.\d+$/.test(v), 'release note keys are versions (' + v + ')');
      assert(WN[v].length <= 220 && !/\u2014/.test(WN[v]), 'release note for ' + v + ' is short and has no em dash');
    }
    // document kinds: book (default), single text and journal
    {
      const P = (s) => ({ t: 'p', runs: [{ text: s }] });
      const bk = TP.build(D, 'blank');
      assert(!('kind' in bk) && D.serializeDraft(bk).indexOf('"kind"') < 0, 'a book keeps the old file format (no kind field)');
      assert(D.validate({ format: D.FORMAT, version: 1, chapters: [] }).kind === undefined, 'a file without a kind is a book');
      assert(TP.build(D, 'story').kind === 'text' && TP.build(D, 'journal').kind === 'journal', 'templates set the kind');
      assert(TP.groups.map((g) => g.kind).join() === 'book,text,journal' && TP.list.every((x) => TP.groups.some((g) => g.kind === x.kind)), 'every template belongs to a group');
      const j = D.newDoc('journal');
      assert(j.kind === 'journal' && j.chapters.length === 1 && !isNaN(Date.parse(j.chapters[0].at)), 'a new journal starts with a stamped entry');
      const when = new Date(2026, 10, 25, 9, 5); // local time, so the test does not depend on the time zone
      assert(D.stamp(when.toISOString()) === 'Wed 25 Nov 2026, 09:05', 'entry stamp format (' + D.stamp(when.toISOString()) + ')');
      j.chapters[0] = D.newEntry(when); j.chapters[0].blocks = [P('Slept badly. Wrote a lot.')];
      const e2 = D.newEntry(new Date(2026, 10, 26, 22, 40)); e2.title = 'Late'; e2.blocks = [P('Quiet evening.')]; j.chapters.push(e2);
      const empty = D.newEntry(new Date(2026, 10, 27, 8, 0)); j.chapters.push(empty);
      assert(D.chapterLabel(j, j.chapters[0]) === 'Wed 25 Nov 2026, 09:05' && D.chapterLabel(j, e2) === 'Thu 26 Nov 2026, 22:40 \u00b7 Late', 'entry label is the stamp, then the title');
      const back = D.parseDraft(D.serializeDraft(j));
      assert(back.kind === 'journal' && back.chapters[1].at === e2.at && back.chapters[1].title === 'Late', 'a journal survives a save and reopen');
      const ex = D.forExport(j, {});
      assert(ex.chapters.length === 2 && ex.kind === 'journal', 'an empty entry is left out of exports');
      const md = D.toMarkdown(ex, {}), tx = D.toPlainText(ex, {});
      assert(md.includes('# Wed 25 Nov 2026, 09:05') && md.includes('# Thu 26 Nov 2026, 22:40 \u00b7 Late'), 'markdown has dated entry headings');
      assert(tx.includes('WED 25 NOV 2026, 09:05'), 'plain text has dated entry headings');
      const f = new Date(2026, 10, 25, 21, 5).toISOString();
      assert(D.stamp(f, { date: 'iso', time: '24' }) === '2026-11-25 21:05' && D.stamp(f, { date: 'dmy', time: '12' }) === '25/11/2026 9:05 PM', 'iso and dmy dates, 24 and 12 hour time');
      assert(D.stamp(f, { date: 'full', time: 'none' }) === 'Wednesday 25 November 2026' && D.stamp(f, { date: 'us', time: '12' }) === 'Wed, Nov 25, 2026, 9:05 PM', 'full and US dates, no time');
      assert(D.stamp(new Date(2026, 10, 25, 0, 7).toISOString(), { time: '12' }) === 'Wed 25 Nov 2026, 12:07 AM', 'midnight is 12 AM');
      const jf = D.newDoc('journal'); jf.dateFmt = 'iso'; jf.timeFmt = 'none'; jf.chapters[0] = D.newEntry(new Date(2026, 10, 25, 9, 5)); jf.chapters[0].blocks = [P('x')];
      const jb = D.parseDraft(D.serializeDraft(jf));
      assert(jb.dateFmt === 'iso' && jb.timeFmt === 'none' && D.chapterLabel(jb, jb.chapters[0]) === '2026-11-25', 'a journal keeps its date format in its file');
      assert(D.serializeDraft(D.newDoc('journal')).indexOf('dateFmt') < 0, 'the default format is not written');
      assert(D.validate(Object.assign({}, jb, { dateFmt: 'bogus', timeFmt: '99' })).dateFmt === undefined, 'unknown formats are dropped');
      const late = new Date(2026, 10, 26, 1, 30).toISOString(), eve = new Date(2026, 10, 25, 22, 0).toISOString();
      assert(D.dayKey(late, 0) !== D.dayKey(eve, 0) && D.dayKey(late, 4) === D.dayKey(eve, 4), 'with a 4 AM day start, 1:30 AM belongs to the evening before');
      const one = D.newDoc('journal'); one.chapters[0].blocks = [P('Just one.')];
      assert(D.headingPlan(one).chapterHeadings, 'a journal with one entry still shows its date');
      const html = require('../exporters.js').toHtml(ex, {});
      assert(html.includes('Wed 25 Nov 2026, 09:05'), 'html export has the entry date');
      assert(!/class="chapter newpage/.test(html) && /class="chapter entry/.test(html), 'journal entries flow without a page break each');
      const bookHtml = require('../exporters.js').toHtml(Object.assign({}, ex, { kind: undefined }), {});
      assert(/class="chapter newpage/.test(bookHtml), 'book chapters still start on a new page');
      const old = D.validate({ format: D.FORMAT, version: 1, kind: 'novel', chapters: [{ id: 'a', title: 'x', at: 'nonsense', blocks: [] }] });
      assert(old.kind === undefined && old.chapters[0].at === undefined, 'unknown kinds and bad dates are dropped');
    }
    // a chapter title that is also the first Heading 1 of its text is printed once
    {
      const dd = D.newDoc(); dd.chapters = [D.newChapter(), D.newChapter()];
      dd.chapters[0].title = 'Prologue'; dd.chapters[0].blocks = [{ t: 'h1', runs: [{ text: ' prologue ' }] }, { t: 'p', runs: [{ text: 'Text.' }] }];
      dd.chapters[1].title = 'One'; dd.chapters[1].blocks = [{ t: 'h1', runs: [{ text: 'The arrival' }] }, { t: 'p', runs: [{ text: 'More.' }] }];
      const ex = D.forExport(dd, {});
      assert(ex.chapters[0].blocks.length === 1 && ex.chapters[0].blocks[0].t === 'p', 'a repeated chapter title is dropped from the text');
      assert(ex.chapters[1].blocks.length === 2 && ex.chapters[1].blocks[0].t === 'h1', 'a different heading is kept');
    }
    // the notebook: kept in the file, never exported or counted
    {
      const nd = D.newDoc(); nd.title = 'World'; nd.chapters[0].blocks = [{ t: 'p', runs: [{ text: 'Chapter text.' }] }];
      const pg = D.newPage(); pg.title = 'Valdemar'; pg.cat = 'Places'; pg.text = 'A fishing village. The secretword lives here.';
      nd.notebook = [pg, { id: 'bad id', title: 5, cat: null, text: 'x' }];
      const back = D.parseDraft(D.serializeDraft(nd));
      assert(back.notebook.length === 2 && back.notebook[0].title === 'Valdemar' && back.notebook[0].cat === 'Places' && back.notebook[1].title === '', 'notebook pages survive a save and reopen, bad fields are cleaned');
      assert(D.parseDraft(D.serializeDraft(D.newDoc())).notebook === undefined, 'a book without pages has no notebook in its file');
      const ex = require('../exporters.js');
      const out = [ex.toHtml(D.forExport(nd, {}), {}), D.toMarkdown(nd, {}), D.toPlainText(nd, {})].join('\n');
      assert(!out.includes('secretword') && !out.includes('Valdemar'), 'the notebook is not in any export');
      assert(D.countDoc(nd) === 2, 'the notebook is not in the word count');
    }
    // poems: one block per stanza, lines separated by \n
    {
      const pd = D.newDoc(); pd.title = 'Poems';
      pd.chapters[0].blocks = [{ t: 'p', runs: [{ text: 'Before.' }] }, { t: 'poem', runs: [{ text: 'Roses are red\nViolets are blue' }] }, { t: 'poem', runs: [{ text: 'Second stanza' }] }];
      const back = D.parseDraft(D.serializeDraft(pd));
      assert(back.chapters[0].blocks[1].t === 'poem' && back.chapters[0].blocks[1].runs[0].text === 'Roses are red\nViolets are blue', 'a poem survives a save and reopen');
      assert(D.toPlainText(pd, {}).includes('    Roses are red\n    Violets are blue'), 'plain text sets a poem in from the margin');
      const html = require('../exporters.js').toHtml(pd, {});
      assert(html.includes('<p class="poem pf"><span class="ln">Roses are red</span><span class="ln">Violets are blue</span></p>') && html.includes('<p class="poem pl"><span class="ln">Second stanza</span></p>') && html.includes('p.poem .ln{') && html.includes('p.poem.pf{'), 'html and PDF keep the lines and the stanza');
      const old2 = D.validate({ format: D.FORMAT, version: 1, chapters: [{ id: 'a', title: '', blocks: [{ t: 'poem', runs: [{ text: 'x' }] }, { t: 'sonnet', runs: [{ text: 'y' }] }] }] });
      assert(old2.chapters[0].blocks[0].t === 'poem' && old2.chapters[0].blocks[1].t === 'p', 'unknown block types still become paragraphs');
    }
    console.log('ok templates and release notes');
  }

  {
    // the Evening theme follows the sun: sunrise and sunset by season and time zone
    const Sun = require('../shared/sun.js');
    const at = (iso, tz) => Sun.isNight(new Date(iso), tz);
    assert(!at('2026-06-21T20:00:00-04:00', 'America/Toronto') && at('2026-06-21T22:30:00-04:00', 'America/Toronto'), 'Toronto: still light at 8 pm in June, dark by 10:30 pm');
    assert(at('2026-12-21T17:15:00-05:00', 'America/Toronto') && !at('2026-12-21T15:30:00-05:00', 'America/Toronto'), 'Toronto: dark by 5:15 pm in December, light at 3:30 pm');
    assert(at('2026-12-21T07:00:00-05:00', 'America/Toronto') && !at('2026-12-21T08:45:00-05:00', 'America/Toronto'), 'Toronto: sunrise falls between 7 and 8:45 am in December');
    assert(!at('2026-06-21T20:00:00+02:00', 'Europe/Madrid') && at('2026-06-21T23:00:00+02:00', 'Europe/Madrid'), 'Madrid in June');
    assert(!at('2026-01-15T12:00:00+13:00', 'Pacific/Auckland') && at('2026-01-15T23:30:00+13:00', 'Pacific/Auckland') && !at('2026-01-15T20:00:00+13:00', 'Pacific/Auckland'), 'Auckland: southern summer evenings stay light');
    assert(at('2026-03-10T03:00:00-04:00', 'America/Toronto') && !at('2026-03-10T13:00:00-04:00', 'America/Toronto'), 'night and day around the clock change');
    assert(typeof Sun.isNight(new Date('2026-04-01T12:00:00Z'), 'Nowhere/Unknown') === 'boolean' && typeof Sun.isNight() === 'boolean', 'an unknown time zone still gives an answer');
    assert(Sun.isNight(new Date('2026-12-21T12:00:00Z'), 'Europe/Helsinki') !== undefined, 'high latitudes do not break');
    // every zone in the table is a real zone, and its coordinates sit near where its clock says (catches typos)
    const stdHours = (z) => {
      const off = (d) => { const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName').value); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] + (m[3] ? +m[3] / 60 : 0)) : 0; };
      return Math.min(off(new Date(Date.UTC(2026, 0, 1))), off(new Date(Date.UTC(2026, 6, 1))));
    };
    let n = 0;
    for (const z of Object.keys(Sun.ZONES)) {
      let h;
      try { h = stdHours(z); } catch (e) { assert(false, z + ' is a valid time zone'); }
      const [lat, lon] = Sun.ZONES[z];
      let diff = Math.abs(((lon - h * 15) % 360 + 540) % 360 - 180);
      assert(lat >= -90 && lat <= 90 && diff <= 35, z + ' coordinates match its clock (' + lat + ', ' + lon + ', UTC' + h + ')');
      n++;
    }
    assert(n >= 150, 'the table covers at least 150 zones (' + n + ')');
    console.log('ok sunrise and sunset');
  }

})().catch((e) => { console.error('FAIL', e); process.exit(1); });
