// Export: Word (.docx) and the HTML used to print PDFs. Markdown/plain text live in shared/doc.js.
const path = require('path');
const { pathToFileURL } = require('url');
const D = require('./shared/doc.js');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  CommentRangeStart, CommentRangeEnd, CommentReference,
} = require('docx');

const A4 = { width: 11906, height: 16838 };
const MARGIN = 1418; // 2.5 cm

const FONTS = {
  serif: { word: 'Times New Roman', css: "'Source Serif 4', 'Times New Roman', serif" },
  sans: { word: 'Arial', css: "'Inter', Arial, sans-serif" },
};

/* ---------------------------- Word ---------------------------- */
async function toDocx(doc, opts) {
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

  const children = [];
  doc.chapters.forEach((c, ci) => {
    if (plan.chapterHeadings) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: ci > 0,
        children: [new TextRun(c.title.trim() || 'Untitled chapter')],
      }));
    }
    for (const b of c.blocks) {
      if (!D.blockText(b).trim()) continue;
      const lvl = D.blockLevel(b, plan.shift);
      if (lvl) children.push(new Paragraph({ heading: heading(lvl), children: runsFor(b) }));
      else if (b.t === 'quote') children.push(new Paragraph({ style: 'Quote', alignment: D.isCite(b) ? AlignmentType.RIGHT : AlignmentType.LEFT, children: runsFor(b) }));
      else children.push(new Paragraph({ alignment: opts.justify === false ? undefined : AlignmentType.JUSTIFIED, children: runsFor(b) }));
    }
  });
  if (!children.length) children.push(new Paragraph({ children: [] }));

  const hd = (id, name, size, before, after) => ({
    id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { font, size, bold: true, color: '000000' },
    paragraph: { spacing: { before, after }, keepNext: true, keepLines: true },
  });

  const document = new Document({
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
    sections: [{
      properties: { page: { size: A4, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      children,
    }],
  });
  return Packer.toBuffer(document);
}

/* ------------------------------ PDF ------------------------------ */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toHtml(doc, opts) {
  opts = opts || {};
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
  doc.chapters.forEach((c, ci) => {
    body += '<section class="chapter' + (ci > 0 ? ' newpage' : '') + '">';
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
  if (notes.length) {
    body += '<section class="chapter newpage notes"><h2>Notes</h2><ol>' +
      notes.map((n) => '<li>' + esc(n.text) + '</li>').join('') + '</ol></section>';
  }

  const face = (family, file, weight, style) =>
    fontsDir ? "@font-face{font-family:'" + family + "';font-weight:" + weight + ';font-style:' + style +
      ';src:url("' + pathToFileURL(path.join(fontsDir, file)).href + '") format("woff2");}\n' : '';
  const fontCss =
    face('Source Serif 4', 'source-serif-4-latin-400-normal.woff2', 400, 'normal') +
    face('Source Serif 4', 'source-serif-4-latin-400-italic.woff2', 400, 'italic') +
    face('Source Serif 4', 'source-serif-4-latin-700-normal.woff2', 700, 'normal') +
    face('Source Serif 4', 'source-serif-4-latin-700-italic.woff2', 700, 'italic') +
    face('Source Serif 4', 'source-serif-4-latin-ext-400-normal.woff2', 400, 'normal') +
    face('Inter', 'inter-latin-400-normal.woff2', 400, 'normal') +
    face('Inter', 'inter-latin-400-italic.woff2', 400, 'italic') +
    face('Inter', 'inter-latin-700-normal.woff2', 700, 'normal') +
    face('Inter', 'inter-latin-700-italic.woff2', 700, 'italic');

  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(doc.title || 'Document') + '</title><style>\n' + fontCss +
    '@page{size:A4;margin:25mm}\n' +
    'html{font-family:' + f.css + ';font-size:11.5pt;line-height:1.55;color:#111}\n' +
    'body{margin:0;orphans:3;widows:3;hyphens:manual}\n' +
    'p{margin:0 0 .75em;orphans:3;widows:3' + (opts.justify === false ? '' : ';text-align:justify') + '}\n' +
    'h1,h2,h3{font-weight:700;line-height:1.25;break-after:avoid;break-inside:avoid;page-break-after:avoid}\n' +
    'h1{font-size:21pt;margin:0 0 .9em}\n' +
    'h2{font-size:15pt;margin:1.5em 0 .5em}\n' +
    'h3{font-size:12.5pt;margin:1.3em 0 .4em}\n' +
    'h1+*,h2+*,h3+*{break-before:avoid}\n' +
    'blockquote{margin:0 0 .2em 38%;padding:0;font-size:.92em;font-style:italic;break-inside:avoid;page-break-inside:avoid}\n' +
    'blockquote.cite{font-style:normal;text-align:right}\n' +
    ':not(blockquote)+blockquote,blockquote+:not(blockquote){margin-top:1em}\n' +
    '.newpage{break-before:page;page-break-before:always}\n' +
    '.nref{font-size:.7em;line-height:0;color:#555}\n' +
    '.notes ol{padding-left:1.4em}.notes li{margin:0 0 .5em;break-inside:avoid}\n' +
    '</style></head><body>' + body + '</body></html>';
}

/* Renders the document to an A4 PDF using a hidden window (needs Electron). */
async function renderPdf(doc, opts, fontsDir) {
  const { BrowserWindow } = require('electron');
  const fs = require('fs');
  const os = require('os');
  const html = toHtml(doc, Object.assign({}, opts, { fontsDir }));
  const tmp = path.join(os.tmpdir(), 'writing-app-print-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html);
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await pw.loadFile(tmp);
    await pw.webContents.executeJavaScript('document.fonts.ready.then(function(){return true})');
    return await pw.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: false,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;font-family:Arial,sans-serif;color:#666"><span class="pageNumber"></span></div>',
    });
  } finally {
    pw.destroy();
    fs.unlink(tmp, () => {});
  }
}

module.exports = { toDocx, toHtml, renderPdf, FONTS };
