// Export: Word (.docx) and the HTML used to print PDFs. Markdown/plain text live in shared/doc.js.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const D = require('./shared/doc.js');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Footer, PageNumber, CommentRangeStart, CommentRangeEnd, CommentReference,
} = require('docx');

const A4 = { width: 11906, height: 16838 };
const MARGIN = 1418; // 2.5 cm

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
  const commentId = {};
  notes.forEach((n, k) => (commentId[n.id] = k));
  const started = new Set();
  const ended = new Set();

  const comments = {
    children: notes.map((n, k) => ({
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
      const id = r.n && commentId[r.n] !== undefined ? commentId[r.n] : null;
      if (id !== null && !started.has(r.n)) { started.add(r.n); out.push(new CommentRangeStart(id)); }
      const lines = r.text.split('\n');
      lines.forEach((line, li) => {
        out.push(new TextRun({
          text: line, bold: !!r.b, italics: !!r.i || (block.t === 'quote' && !D.isCite(block)), underline: r.u ? {} : undefined,
          break: li > 0 ? 1 : undefined,
        }));
      });
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
    titleKids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 4200, after: 360 }, children: [new TextRun({ text: doc.title.trim(), bold: true, size: 60 })] }));
    if (doc.subtitle) titleKids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: doc.subtitle.trim(), italics: true, size: 34 })] }));
    if (opts.author) titleKids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600 }, children: [new TextRun({ text: opts.author, size: 28 })] }));
    if (doc.extra) titleKids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240 }, children: [new TextRun({ text: doc.extra.trim(), size: 22, color: '555555' })] }));
  }
  const bodySections = [];
  doc.chapters.forEach((c) => {
    const kids = [];
    if (plan.chapterHeadings) kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(c.title.trim() || 'Untitled chapter')] }));
    for (const b of c.blocks) {
      if (!D.blockText(b).trim()) continue;
      const lvl = D.blockLevel(b, plan.shift);
      if (lvl) kids.push(new Paragraph({ heading: heading(lvl), children: runsFor(b) }));
      else if (b.t === 'quote') kids.push(new Paragraph({ style: 'Quote', alignment: AlignmentType.RIGHT, children: runsFor(b) }));
      else kids.push(new Paragraph({ alignment: opts.justify === false ? undefined : AlignmentType.JUSTIFIED, children: runsFor(b) }));
    }
    bodySections.push({ show: opts.pageNumbers !== false && !c.nonum, kids: kids.length ? kids : [new Paragraph({ children: [] })] });
  });
  const footerFor = (show) => new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: show ? [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '666666' })] : [] })] });
  const pageProps = (extra) => ({ page: Object.assign({ size: A4, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } }, extra || {}) });
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
    comments: notes.length ? comments : undefined,
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
  const num = {};
  notes.forEach((n) => (num[n.id] = n.num));
  const emitted = new Set();

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
      if (r.n && num[r.n] && !emitted.has(r.n) && (!nx || nx.n !== r.n)) { emitted.add(r.n); h += '<sup class="nref">' + num[r.n] + '</sup>'; }
    });
    return h;
  }

  let body = '';
  const titlePage = !!(opts.titlePage && (doc.title || '').trim());
  const part = opts.part; // 'title' or 'body': the title page is printed on its own so the numbering does not count it
  if (titlePage && part !== 'body') body += '<section class="titlepage"><h1 class="booktitle">' + esc(doc.title.trim()) + '</h1>' + (doc.subtitle ? '<p class="subtitle">' + esc(doc.subtitle.trim()) + '</p>' : '') + (opts.author ? '<p class="byline">' + esc(opts.author) + '</p>' : '') + (doc.extra ? '<p class="extra">' + esc(doc.extra.trim()) + '</p>' : '') + '</section>';
  doc.chapters.forEach((c, ci) => {
    if (part === 'title') return;
    body += '<section class="chapter' + (ci > 0 ? ' newpage' : '') + (opts.pageNumbers === false || c.nonum ? ' nonum' : '') + '">';
    if (plan.chapterHeadings) body += '<h1>' + esc(c.title.trim() || 'Untitled chapter') + '</h1>';
    for (const b of c.blocks) {
      if (!D.blockText(b).trim()) continue;
      const lvl = D.blockLevel(b, plan.shift);
      if (lvl) body += '<h' + Math.min(lvl, 3) + '>' + inline(b) + '</h' + Math.min(lvl, 3) + '>';
      else if (b.t === 'quote') body += '<blockquote' + (D.isCite(b) ? ' class="cite"' : '') + '>' + inline(b) + '</blockquote>';
      else body += '<p>' + inline(b) + '</p>';
    }
    body += '</section>';
  });
  if (notes.length && part !== 'title') {
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
    (opts.pageNumbers === false || part === 'title' ? '@page{size:A4;margin:25mm}\n' : '@page{size:A4;margin:25mm;@bottom-center{content:counter(page);font:9pt Arial,sans-serif;color:#666}}\n') +
    '@page nonum{@bottom-center{content:none}}\n.nonum{page:nonum}\n' +
    'html{font-family:' + f.css + ';font-size:11.5pt;line-height:1.55;color:#111}\n' +
    'body{margin:0;orphans:3;widows:3;hyphens:manual}\n' +
    'p{margin:0 0 .75em;orphans:3;widows:3' + (opts.justify === false ? '' : ';text-align:justify') + '}\n' +
    'h1,h2,h3{font-weight:700;line-height:1.25;break-after:avoid;break-inside:avoid;page-break-after:avoid}\n' +
    'h1{font-size:21pt;margin:0 0 .9em}\n' +
    'h2{font-size:15pt;margin:1.5em 0 .5em}\n' +
    'h3{font-size:12.5pt;margin:1.3em 0 .4em}\n' +
    'h1+*,h2+*,h3+*{break-before:avoid}\n' +
    'blockquote{margin:0 0 .2em 38%;padding:0;font-size:.92em;font-style:italic;text-align:right;break-inside:avoid;page-break-inside:avoid}\n' +
    'blockquote.cite{font-style:normal;text-align:right}\n' +
    ':not(blockquote)+blockquote,blockquote+:not(blockquote){margin-top:1em}\n' +
    '.titlepage{display:flex;flex-direction:column;justify-content:center;height:240mm;text-align:center}\n' +
    '  .booktitle{font-size:32pt;margin:0 0 .4em}.subtitle{font-size:17pt;font-style:italic;text-align:center;margin:0 0 2.2em}.byline{font-size:14pt;text-align:center;margin:0 0 .8em}.extra{font-size:11pt;color:#555;text-align:center}\n' +
    '.newpage{break-before:page;page-break-before:always}\n' +
    '.nref{font-size:.7em;line-height:0;color:#555}\n' +
    '.notes ol{padding-left:1.4em}.notes li{margin:0 0 .5em;break-inside:avoid}\n' +
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

module.exports = { toDocx, toHtml, renderPdf, FONTS };
