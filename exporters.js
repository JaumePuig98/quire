// Export: Word (.docx) and the HTML used to print PDFs. Markdown/plain text live in shared/doc.js.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const D = require('./shared/doc.js');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Footer, PageNumber, CommentRangeStart, CommentRangeEnd, CommentReference, FootnoteReferenceRun,
} = require('docx');

// Page sizes in millimetres, and the margin choices. Letter is the usual size in Canada and the US, A4 elsewhere.
const PAGES = {
  letter: { name: 'US Letter', w: 215.9, h: 279.4 },
  a4: { name: 'A4', w: 210, h: 297 },
  a5: { name: 'A5', w: 148, h: 210 },
  trade: { name: 'Trade paperback 6 x 9 in', w: 152.4, h: 228.6 },
  digest: { name: 'Digest 5.5 x 8.5 in', w: 139.7, h: 215.9 },
};
const MARGINS = { narrow: { name: 'Narrow', mm: 15 }, normal: { name: 'Normal', mm: 25 }, wide: { name: 'Wide', mm: 32 } };
const twips = (mm) => Math.round((mm / 25.4) * 1440);
function pageGeometry(opts) {
  const pg = PAGES[opts && opts.pageSize] || PAGES.a4;
  const mg = MARGINS[opts && opts.margins] || MARGINS.normal;
  return { pg, mm: mg.mm, size: { width: twips(pg.w), height: twips(pg.h) }, margin: twips(mg.mm) };
}

const FONTS = {
  serif: { word: 'Literata', embed: 'literata', css: "'Literata', Georgia, serif" },
  sans: { word: 'Nunito', embed: 'nunito', css: "'Nunito', Calibri, sans-serif" },
  type: { word: 'Courier Prime', embed: 'courier-prime', css: "'Courier Prime', 'Courier New', monospace" },
};

/* ---------------------------- Word ---------------------------- */
async function toDocx(doc, opts) {
  doc = D.forExport(doc, opts || {});
  opts = opts || {};
  const font = (FONTS[opts.font] || FONTS.serif).word;
  const plan = D.headingPlan(doc);
  const notes = opts.notes ? D.orderedNotes(doc) : [];
  const asFoot = !!(opts.notes && opts.notesMode === 'footnotes'); // real Word footnotes instead of comments
  const geo = pageGeometry(opts);
  const commentId = {};
  const footNum = {};
  notes.forEach((n, k) => { commentId[n.id] = k; footNum[n.id] = n.num; });
  const started = new Set();
  const ended = new Set();
  const footDone = new Set();

  const comments = {
    children: (asFoot ? [] : notes).map((n, k) => ({
      id: k,
      author: opts.author || 'Author',
      date: new Date(),
      children: n.text.split(/\n+/).map((line) => new Paragraph({ children: [new TextRun(line)] })),
    })),
  };

  const heading = (lvl) => [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][Math.min(lvl, 3)];

  function runsFor(block) {
    const runs = D.normalizeRuns(block.runs);
    const out = [];
    runs.forEach((r, k) => {
      const nx = runs[k + 1];
      const id = !asFoot && r.n && commentId[r.n] !== undefined ? commentId[r.n] : null;
      if (id !== null && !started.has(r.n)) { started.add(r.n); out.push(new CommentRangeStart(id)); }
      const lines = r.text.split('\n');
      lines.forEach((line, li) => {
        out.push(new TextRun({
          text: line, bold: !!r.b, italics: !!r.i || (block.t === 'quote' && !D.isCite(block)), underline: r.u ? {} : undefined,
          break: li > 0 ? 1 : undefined,
        }));
      });
      if (asFoot && r.n && footNum[r.n] && !footDone.has(r.n) && (!nx || nx.n !== r.n)) { footDone.add(r.n); out.push(new FootnoteReferenceRun(footNum[r.n])); }
      if (id !== null && started.has(r.n) && !ended.has(r.n) && (!nx || nx.n !== r.n)) {
        ended.add(r.n);
        out.push(new CommentRangeEnd(id));
        out.push(new TextRun({ children: [new CommentReference(id)] }));
      }
    });
    return out;
  }

  // The title page has no number and is not counted; every chapter is a section of its own, and a chapter can hide its number
  // (its pages are still counted).
  const titleKids = [];
  const titlePage = !!(opts.titlePage && (doc.title || '').trim());
  if (titlePage) {
    titleKids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: Math.round(geo.size.height * 0.25), after: 360 }, children: [new TextRun({ text: doc.title.trim(), bold: true, size: 60 })] }));
    if (doc.subtitle) titleKids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: doc.subtitle.trim(), italics: true, size: 34 })] }));
    if (opts.author) titleKids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600 }, children: [new TextRun({ text: opts.author, size: 28 })] }));
    if (doc.extra) titleKids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240 }, children: [new TextRun({ text: doc.extra.trim(), size: 22, color: '555555' })] }));
  }
  const bodySections = [];
  doc.chapters.forEach((c) => {
    const kids = [];
    if (plan.chapterHeadings) kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: doc.kind === 'journal' ? { before: 480 } : undefined, children: [new TextRun(D.chapterLabel(doc, c))] }));
    for (const b of c.blocks) {
      if (!D.blockText(b).trim()) continue;
      const lvl = D.blockLevel(b, plan.shift);
      if (D.isBreak(b)) kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 }, keepNext: true, children: [new TextRun({ text: '*   *   *' })] }));
      else if (lvl) kids.push(new Paragraph({ heading: heading(lvl), children: runsFor(b) }));
      else if (b.t === 'quote') kids.push(new Paragraph({ style: 'Quote', alignment: AlignmentType.RIGHT, children: runsFor(b) }));
      else if (b.t === 'poem') kids.push(new Paragraph({ alignment: AlignmentType.LEFT, indent: { left: 720, firstLine: 0 }, keepLines: true, spacing: { after: 240 }, children: runsFor(b) }));
      else kids.push(new Paragraph({ alignment: opts.justify === false ? undefined : AlignmentType.JUSTIFIED, children: runsFor(b) }));
    }
    bodySections.push({ show: opts.pageNumbers !== false && !c.nonum, kids: kids.length ? kids : [new Paragraph({ children: [] })] });
  });
  // a journal flows: entries follow each other on the page instead of each starting a new one
  if (doc.kind === 'journal' && bodySections.length > 1) {
    const all = [];
    bodySections.forEach((s) => all.push(...s.kids));
    bodySections.length = 0;
    bodySections.push({ show: opts.pageNumbers !== false, kids: all });
  }
  const footerFor = (show) => new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: show ? [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '666666' })] : [] })] });
  const pageProps = (extra) => ({ page: Object.assign({ size: geo.size, margin: { top: geo.margin, bottom: geo.margin, left: geo.margin, right: geo.margin } }, extra || {}) });
  const sections = [];
  if (titlePage) sections.push({ properties: pageProps(), footers: { default: footerFor(false) }, children: titleKids });
  bodySections.forEach((sec, i) => sections.push({
    properties: pageProps(i === 0 && titlePage ? { pageNumbers: { start: 1 } } : null),
    footers: { default: footerFor(sec.show) },
    children: sec.kids,
  }));

  const hd = (id, name, size, before, after) => ({
    id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { font, size, bold: true, color: '000000' },
    paragraph: { spacing: { before, after }, keepNext: true, keepLines: true },
  });

  // Word files carry their own copy of the font, so they look the same on a PC that does not have it.
  let embedded;
  const fdef = FONTS[opts.font] || FONTS.serif;
  if (opts.embedDir && fdef.embed) {
    try {
      const rd = (t) => fs.readFileSync(path.join(opts.embedDir, fdef.embed + '-' + t + '.ttf'));
      embedded = [{ name: fdef.word, data: rd('r'), bold: rd('b'), italic: rd('i'), boldItalic: rd('bi') }];
    } catch (err) { embedded = undefined; } // missing files: the font name alone still works where the font is installed
  }

  const document = new Document({
    fonts: embedded,
    creator: opts.author || 'Author',
    title: doc.title || '',
    comments: notes.length && !asFoot ? comments : undefined,
    footnotes: asFoot && notes.length ? Object.fromEntries(notes.map((n) => [n.num, { children: n.text.split(/\n+/).map((line) => new Paragraph({ children: [new TextRun(line)] })) }])) : undefined,
    styles: {
      default: {
        document: { run: { font, size: 24 }, paragraph: { spacing: { line: 336, after: 160 }, widowControl: true } },
      },
      paragraphStyles: [
        hd('Heading1', 'Heading 1', 36, 0, 300),
        hd('Heading2', 'Heading 2', 30, 360, 160),
        hd('Heading3', 'Heading 3', 26, 300, 120),
        {
          id: 'Quote', name: 'Quote', basedOn: 'Normal', quickFormat: true,
          run: { italics: true, size: 22 },
          paragraph: { indent: { left: 3400 }, spacing: { before: 0, after: 40 }, keepLines: true, keepNext: false },
        },
      ],
    },
    sections,
  });
  return Packer.toBuffer(document);
}

/* ------------------------------ PDF ------------------------------ */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toHtml(doc, opts) {
  opts = opts || {};
  doc = D.forExport(doc, opts);
  const fontsDir = opts.fontsDir;
  const f = FONTS[opts.font] || FONTS.serif;
  const plan = D.headingPlan(doc);
  const notes = opts.notes ? D.orderedNotes(doc) : [];
  const perChapter = !!(opts.notes && opts.notesMode === 'footnotes'); // notes at the end of each chapter instead of one list at the end
  const geo = pageGeometry(opts);
  const num = {};
  const noteText = {};
  notes.forEach((n) => { num[n.id] = n.num; noteText[n.id] = n.text; });
  const emitted = new Set();
  let chapNotes = [];

  function inline(block) {
    const runs = D.normalizeRuns(block.runs);
    let h = '';
    runs.forEach((r, k) => {
      let t = esc(r.text).replace(/\n/g, '<br>');
      if (r.u) t = '<u>' + t + '</u>';
      if (r.i) t = '<i>' + t + '</i>';
      if (r.b) t = '<b>' + t + '</b>';
      h += t;
      const nx = runs[k + 1];
      if (r.n && num[r.n] && !emitted.has(r.n) && (!nx || nx.n !== r.n)) { emitted.add(r.n); chapNotes.push(r.n); h += '<sup class="nref">' + num[r.n] + '</sup>'; }
    });
    return h;
  }

  let body = '';
  const titlePage = !!(opts.titlePage && (doc.title || '').trim());
  const part = opts.part; // 'title' or 'body': the title page is printed on its own so the numbering does not count it
  if (titlePage && part !== 'body') body += '<section class="titlepage"><h1 class="booktitle">' + esc(doc.title.trim()) + '</h1>' + (doc.subtitle ? '<p class="subtitle">' + esc(doc.subtitle.trim()) + '</p>' : '') + (opts.author ? '<p class="byline">' + esc(opts.author) + '</p>' : '') + (doc.extra ? '<p class="extra">' + esc(doc.extra.trim()) + '</p>' : '') + '</section>';
  doc.chapters.forEach((c, ci) => {
    if (part === 'title') return;
    chapNotes = [];
    body += '<section class="chapter' + (ci > 0 && doc.kind !== 'journal' ? ' newpage' : '') + (doc.kind === 'journal' ? ' entry' : '') + (opts.pageNumbers === false || c.nonum ? ' nonum' : '') + '">';
    if (plan.chapterHeadings) body += '<h1>' + esc(D.chapterLabel(doc, c)) + '</h1>';
    for (const b of c.blocks) {
      if (!D.blockText(b).trim()) continue;
      const lvl = D.blockLevel(b, plan.shift);
      if (D.isBreak(b)) body += '<p class="sb">*&nbsp;&nbsp;&nbsp;*&nbsp;&nbsp;&nbsp;*</p>';
      else if (lvl) body += '<h' + Math.min(lvl, 3) + '>' + inline(b) + '</h' + Math.min(lvl, 3) + '>';
      else if (b.t === 'quote') body += '<blockquote' + (D.isCite(b) ? ' class="cite"' : '') + '>' + inline(b) + '</blockquote>';
      else if (b.t === 'poem') body += '<p class="poem">' + inline(b) + '</p>';
      else body += '<p>' + inline(b) + '</p>';
    }
    if (perChapter && chapNotes.length) body += '<div class="endnotes"><h2>Notes</h2><ol>' + chapNotes.map((id) => '<li value="' + num[id] + '">' + esc(noteText[id]) + '</li>').join('') + '</ol></div>';
    body += '</section>';
  });
  if (notes.length && part !== 'title' && !perChapter) {
    body += '<section class="chapter newpage notes"><h2>Notes</h2><ol>' +
      notes.map((n) => '<li>' + esc(n.text) + '</li>').join('') + '</ol></section>';
  }

  const face = (family, file, weight, style) =>
    fontsDir ? "@font-face{font-family:'" + family + "';font-weight:" + weight + ';font-style:' + style +
      ';src:url("' + pathToFileURL(path.join(fontsDir, file)).href + '") format("woff2");}\n' : '';
  const face2 = (family, file, wt, style) =>
    fontsDir ? "@font-face{font-family:'" + family + "';font-weight:" + wt + ';font-style:' + style +
      ';src:url("' + pathToFileURL(path.join(fontsDir, file)).href + '") format("woff2");}\n' : '';
  const fontCss =
    face2('Literata', 'literata-latin-wght-normal.woff2', '200 900', 'normal') + face2('Literata', 'literata-latin-wght-italic.woff2', '200 900', 'italic') +
    face2('Literata', 'literata-latin-ext-wght-normal.woff2', '200 900', 'normal') + face2('Literata', 'literata-latin-ext-wght-italic.woff2', '200 900', 'italic') +
    face2('Nunito', 'nunito-latin-wght-normal.woff2', '400 700', 'normal') + face2('Nunito', 'nunito-latin-wght-italic.woff2', '400 700', 'italic') +
    face2('Nunito', 'nunito-latin-ext-wght-normal.woff2', '400 700', 'normal') + face2('Nunito', 'nunito-latin-ext-wght-italic.woff2', '400 700', 'italic') +
    face2('Courier Prime', 'courier-prime-latin-400-normal.woff2', 400, 'normal') + face2('Courier Prime', 'courier-prime-latin-400-italic.woff2', 400, 'italic') +
    face2('Courier Prime', 'courier-prime-latin-700-normal.woff2', 700, 'normal') + face2('Courier Prime', 'courier-prime-latin-700-italic.woff2', 700, 'italic');

  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(doc.title || 'Document') + '</title><style>\n' + fontCss +
    (opts.pageNumbers === false || part === 'title' ? '@page{size:' + geo.pg.w + 'mm ' + geo.pg.h + 'mm;margin:' + geo.mm + 'mm}\n' : '@page{size:' + geo.pg.w + 'mm ' + geo.pg.h + 'mm;margin:' + geo.mm + 'mm;@bottom-center{content:counter(page);font:9pt Arial,sans-serif;color:#666}}\n') +
    '@page nonum{@bottom-center{content:none}}\n.nonum{page:nonum}\n' +
    'html{font-family:' + f.css + ';font-size:11.5pt;line-height:1.55;color:#111}\n' +
    'body{margin:0;orphans:3;widows:3;hyphens:manual}\n' +
    'p{margin:0 0 .75em;orphans:3;widows:3' + (opts.justify === false ? '' : ';text-align:justify') + '}\n' +
    'h1,h2,h3{font-weight:700;line-height:1.25;break-after:avoid;break-inside:avoid;page-break-after:avoid}\n' +
    'h1{font-size:21pt;margin:0 0 .9em}\n' +
    'h2{font-size:15pt;margin:1.5em 0 .5em}\n' +
    'h3{font-size:12.5pt;margin:1.3em 0 .4em}\n' +
    'h1+*,h2+*,h3+*{break-before:avoid}\n' +
    'p.poem{margin:0 0 1em 2.2em;text-align:left;hyphens:none;break-inside:avoid;page-break-inside:avoid}\n' +
    'p.sb{text-align:center;margin:1.1em 0;break-after:avoid;page-break-after:avoid}\n' +
    'blockquote{margin:0 0 .2em 38%;padding:0;font-size:.92em;font-style:italic;text-align:right;break-inside:avoid;page-break-inside:avoid}\n' +
    'blockquote.cite{font-style:normal;text-align:right}\n' +
    ':not(blockquote)+blockquote,blockquote+:not(blockquote){margin-top:1em}\n' +
    '.titlepage{display:flex;flex-direction:column;justify-content:center;height:' + (geo.pg.h - 2 * geo.mm - 4) + 'mm;text-align:center}\n' +
    '  .booktitle{font-size:32pt;margin:0 0 .4em}.subtitle{font-size:17pt;font-style:italic;text-align:center;margin:0 0 2.2em}.byline{font-size:14pt;text-align:center;margin:0 0 .8em}.extra{font-size:11pt;color:#555;text-align:center}\n' +
    '.newpage{break-before:page;page-break-before:always}\n' +
    '.entry h1{font-size:1.25em;margin:1.9em 0 .6em}\n.entry:first-of-type h1{margin-top:0}\n' +
    '.nref{font-size:.7em;line-height:0;color:#555}\n' +
    '.notes ol{padding-left:1.4em}.notes li{margin:0 0 .5em;break-inside:avoid}\n' +
    '.endnotes{margin-top:2.2em;padding-top:.6em;border-top:.5pt solid #999;font-size:.88em;break-inside:avoid}.endnotes h2{font-size:1em;margin:0 0 .4em}.endnotes ol{padding-left:1.4em;margin:0}.endnotes li{margin:0 0 .35em}\n' +
    '</style></head><body>' + body + '</body></html>';
}

/* Renders the document to an A4 PDF using a hidden window (needs Electron). */
async function renderPdf(doc, opts, fontsDir) {
  const { BrowserWindow } = require('electron');
  const os = require('os');
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  // one hidden window prints every part, one after the other
  const printHtml = async (html) => {
    const tmp = path.join(os.tmpdir(), 'writing-app-print-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.html');
    fs.writeFileSync(tmp, html);
    try {
      await pw.loadFile(tmp);
      await pw.webContents.executeJavaScript('document.fonts.ready.then(function(){return true})');
      return await pw.webContents.printToPDF({ preferCSSPageSize: true, printBackground: false }); // page numbers come from the page's own CSS
    } finally { fs.unlink(tmp, () => {}); }
  };
  try {
    const o = Object.assign({}, opts, { fontsDir });
    const withTitle = !!(opts && opts.titlePage && (doc.title || '').trim());
    if (!withTitle) return await printHtml(toHtml(doc, o));
    // title page and body are printed separately and joined, so the first chapter page is page 1
    const { PDFDocument } = require('pdf-lib');
    const a = await printHtml(toHtml(doc, Object.assign({}, o, { part: 'title' })));
    const b = await printHtml(toHtml(doc, Object.assign({}, o, { part: 'body' })));
    const out = await PDFDocument.create();
    for (const buf of [a, b]) {
      const src = await PDFDocument.load(buf);
      (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg));
    }
    return Buffer.from(await out.save());
  } finally { pw.destroy(); }
}

module.exports = { toDocx, toHtml, renderPdf, FONTS, PAGES, MARGINS, pageGeometry };
