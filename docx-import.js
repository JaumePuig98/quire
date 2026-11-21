/* Reads a Word (.docx) file into the app's document model.
 * Word -> HTML with mammoth, then the HTML is cut into blocks and runs. Headings 1 and above split the book into chapters. */
const mammoth = require('mammoth');
const D = require('./shared/doc.js');

const STYLE_MAP = [
  "p[style-name='Title'] => p.doc-title:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "p[style-name='Block Text'] => blockquote:fresh",
  "u => u",
];
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g) => {
  if (g[0] === '#') { const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); return isFinite(n) && n > 0 ? String.fromCodePoint(n) : ''; }
  return ENT[g.toLowerCase()] !== undefined ? ENT[g.toLowerCase()] : m;
});

// HTML from mammoth -> [{t, runs}]
function htmlToBlocks(html) {
  const blocks = [];
  let cur = null;
  let title = '';
  const fmt = { b: 0, i: 0, u: 0 };
  let inTitle = false;
  const open = (t) => { cur = { t, runs: [] }; };
  const close = () => {
    if (!cur) return;
    cur.runs = D.normalizeRuns(cur.runs);
    const text = D.blockText(cur).trim();
    if (inTitle) { if (text && !title) title = text; }
    else if (text) blocks.push(cur);
    cur = null; inTitle = false;
  };
  const re = /<(\/?)([a-z0-9]+)([^>]*?)(\/?)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) {
      const text = decode(m[5].replace(/\s+/g, ' '));
      if (!cur) { if (!text.trim()) continue; open('p'); }
      const r = { text };
      if (fmt.b > 0) r.b = 1; if (fmt.i > 0) r.i = 1; if (fmt.u > 0) r.u = 1;
      cur.runs.push(r);
      continue;
    }
    const closing = !!m[1], tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (/^h[1-6]$/.test(tag)) { closing ? close() : (close(), open(tag === 'h1' ? 'h1' : 'h2')); }
    else if (tag === 'p') {
      if (closing) close();
      else { close(); if (/doc-title/.test(attrs)) { inTitle = true; open('p'); } else open('p'); }
    }
    else if (tag === 'blockquote') { closing ? close() : (close(), open('quote')); }
    else if (tag === 'li' || tag === 'tr') { closing ? close() : (close(), open('p')); }
    else if (tag === 'td' || tag === 'th') { if (closing && cur) cur.runs.push({ text: ' ' }); }
    else if (tag === 'br') { if (cur) cur.runs.push({ text: ' ' }); }
    else if (tag === 'strong' || tag === 'b') fmt.b += closing ? -1 : 1;
    else if (tag === 'em' || tag === 'i') fmt.i += closing ? -1 : 1;
    else if (tag === 'u') fmt.u += closing ? -1 : 1;
  }
  close();
  return { blocks, title };
}

function toDoc(blocks, name, title) {
  const doc = D.newDoc();
  doc.title = title || name || '';
  const h1s = blocks.filter((b) => b.t === 'h1').length;
  // several Heading 1: one chapter each. Otherwise the whole text is a single chapter.
  if (h1s >= 2) {
    const chapters = [];
    let c = null;
    for (const b of blocks) {
      if (b.t === 'h1' || !c) { c = { id: D.newChapter().id, title: '', blocks: [] }; chapters.push(c); }
      c.blocks.push(b);
    }
    doc.chapters = chapters;
  } else doc.chapters[0].blocks = blocks.length ? blocks : [{ t: 'p', runs: [] }];
  return doc;
}

async function importDocx(file, name) {
  const res = await mammoth.convertToHtml({ path: file }, {
    styleMap: STYLE_MAP,
    convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
  });
  const { blocks, title } = htmlToBlocks(res.value);
  return toDoc(blocks, name, title);
}
module.exports = { importDocx, htmlToBlocks, toDoc };
