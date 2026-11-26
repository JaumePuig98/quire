// Export: EPUB 3 e-book. A small zip writer is built in, so no extra package is needed.
const zlib = require('zlib');
const crypto = require('crypto');
const D = require('./shared/doc.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------------------- zip ---------------------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// entries: [{ name, data (Buffer|string), store (keep uncompressed) }]. The first entry of an EPUB must be "mimetype", stored.
function zip(entries) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const packed = e.store ? raw : zlib.deflateRawSync(raw);
    const method = e.store ? 0 : 8;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat([cd, end]));
}

/* ---------------------------- EPUB ---------------------------- */
const FAMILY = { serif: 'Georgia, "Times New Roman", serif', sans: 'Arial, Helvetica, sans-serif', type: '"Courier New", Courier, monospace' };
const uuidOf = (id) => { const h = crypto.createHash('sha1').update('quire:' + id).digest('hex'); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-5' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32); };
const langOf = (l) => (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(l || '')) ? l : 'en');

const CSS = (family, justify) =>
  'html{font-family:' + family + '}\n' +
  'body{margin:0 5%;line-height:1.5}\n' +
  'p{margin:0;text-indent:1.4em' + (justify ? ';text-align:justify' : '') + '}\n' +
  'h1+p,h2+p,h3+p,blockquote+p,p.first{text-indent:0}\n' +
  'h1,h2,h3{font-weight:bold;line-height:1.25;page-break-after:avoid;break-after:avoid}\n' +
  'h1{font-size:1.6em;margin:1.2em 0 1em}h2{font-size:1.25em;margin:1.4em 0 .6em}h3{font-size:1.1em;margin:1.2em 0 .5em}\n' +
  'blockquote{margin:1em 0 .2em 25%;font-style:italic;text-align:right;text-indent:0}blockquote.cite{font-style:normal}\n' +
  '.titlepage{text-align:center;margin-top:25%}.titlepage h1{font-size:2.2em;margin:0 0 .4em}.subtitle{font-style:italic;font-size:1.2em;text-align:center;text-indent:0;margin:0 0 2em}.byline{font-size:1.1em;text-align:center;text-indent:0}.extra{color:#555;text-align:center;text-indent:0}\n' +
  'p.poem{margin:0 0 1em 2em;text-indent:0;text-align:left}\n' +
  'p.sb{text-align:center;text-indent:0;margin:1.2em 0}p.sb+p{text-indent:0}\n' +
  'sup a{text-decoration:none}\n' +
  '.endnotes{margin-top:2em;border-top:1px solid #999;font-size:.9em}.endnotes h2{font-size:1em;margin:.6em 0 .4em}.endnotes p{text-indent:0}.endnotes ol{padding-left:1.6em}\n';

function toEpub(doc, opts) {
  opts = opts || {};
  doc = D.forExport(doc, opts);
  const plan = D.headingPlan(doc);
  const lang = langOf(opts.lang);
  const notes = opts.notes ? D.orderedNotes(doc) : [];
  const num = {}, noteText = {};
  notes.forEach((n) => { num[n.id] = n.num; noteText[n.id] = n.text; });
  const emitted = new Set();
  let chapNotes = [];

  const page = (title, body) =>
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' + lang + '" xml:lang="' + lang + '">\n<head><meta charset="utf-8"/><title>' +
    esc(title) + '</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body>\n' + body + '\n</body>\n</html>\n';

  function inline(block) {
    const runs = D.normalizeRuns(block.runs);
    let h = '';
    runs.forEach((r, k) => {
      let t = esc(r.text).replace(/\n/g, '<br/>');
      if (r.u) t = '<u>' + t + '</u>';
      if (r.i) t = '<i>' + t + '</i>';
      if (r.b) t = '<b>' + t + '</b>';
      h += t;
      const nx = runs[k + 1];
      if (r.n && num[r.n] && !emitted.has(r.n) && (!nx || nx.n !== r.n)) {
        emitted.add(r.n); chapNotes.push(r.n);
        h += '<sup><a epub:type="noteref" id="r' + num[r.n] + '" href="#n' + num[r.n] + '">' + num[r.n] + '</a></sup>';
      }
    });
    return h;
  }

  const files = []; // { id, href, title, xhtml }
  const titlePage = !!(opts.titlePage && (doc.title || '').trim());
  if (titlePage) {
    files.push({
      id: 'title', href: 'title.xhtml', title: doc.title.trim(), nav: false,
      xhtml: page(doc.title.trim(), '<section class="titlepage" epub:type="titlepage"><h1>' + esc(doc.title.trim()) + '</h1>' +
        (doc.subtitle ? '<p class="subtitle">' + esc(doc.subtitle.trim()) + '</p>' : '') +
        (opts.author ? '<p class="byline">' + esc(opts.author) + '</p>' : '') +
        (doc.extra ? '<p class="extra">' + esc(doc.extra.trim()) + '</p>' : '') + '</section>'),
    });
  }
  doc.chapters.forEach((c, ci) => {
    chapNotes = [];
    let body = '';
    const name = plan.chapterHeadings ? D.chapterLabel(doc, c) : (doc.title.trim() || 'Text');
    if (plan.chapterHeadings) body += '<h1>' + esc(name) + '</h1>\n';
    for (const b of c.blocks) {
      if (!D.blockText(b).trim()) continue;
      const lvl = D.blockLevel(b, plan.shift);
      if (D.isBreak(b)) body += '<p class="sb">*&#160;&#160;&#160;*&#160;&#160;&#160;*</p>\n';
      else if (lvl) body += '<h' + Math.min(lvl, 3) + '>' + inline(b) + '</h' + Math.min(lvl, 3) + '>\n';
      else if (b.t === 'poem') body += '<p class="poem">' + inline(b) + '</p>\n';
      else if (b.t === 'quote') body += '<blockquote' + (D.isCite(b) ? ' class="cite"' : '') + '>' + inline(b) + '</blockquote>\n';
      else body += '<p>' + inline(b) + '</p>\n';
    }
    if (chapNotes.length) {
      body += '<section class="endnotes" epub:type="endnotes"><h2>Notes</h2><ol>' +
        chapNotes.map((id) => '<li value="' + num[id] + '" id="n' + num[id] + '" epub:type="endnote"><p>' + esc(noteText[id]).replace(/\n+/g, '<br/>') + ' <a href="#r' + num[id] + '">&#8617;</a></p></li>').join('') + '</ol></section>\n';
    }
    if (!body.trim()) body = '<p></p>';
    const href = 'chapter' + (ci + 1) + '.xhtml';
    files.push({ id: 'ch' + (ci + 1), href, title: name, nav: true, xhtml: page(name, body) });
  });

  const bookTitle = (doc.title || '').trim() || 'Untitled';
  const uid = 'urn:uuid:' + uuidOf(doc.id || bookTitle);
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const navItems = files.filter((f) => f.nav);
  const opf = '<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="' + lang + '">\n' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="bookid">' + uid + '</dc:identifier>\n<dc:title>' + esc(bookTitle) + '</dc:title>\n' +
    (opts.author ? '<dc:creator>' + esc(opts.author) + '</dc:creator>\n' : '') + '<dc:language>' + lang + '</dc:language>\n<meta property="dcterms:modified">' + modified + '</meta>\n</metadata>\n' +
    '<manifest>\n<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n<item id="css" href="style.css" media-type="text/css"/>\n' +
    files.map((f) => '<item id="' + f.id + '" href="' + f.href + '" media-type="application/xhtml+xml"/>').join('\n') + '\n</manifest>\n' +
    '<spine toc="ncx">\n' + files.map((f) => '<itemref idref="' + f.id + '"/>').join('\n') + '\n</spine>\n</package>\n';
  const nav = '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="' + lang + '" xml:lang="' + lang + '">\n<head><meta charset="utf-8"/><title>Contents</title></head>\n<body>\n' +
    '<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>\n' + navItems.map((f) => '<li><a href="' + f.href + '">' + esc(f.title) + '</a></li>').join('\n') + '\n</ol></nav>\n</body>\n</html>\n';
  const ncx = '<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n<head><meta name="dtb:uid" content="' + uid + '"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>\n' +
    '<docTitle><text>' + esc(bookTitle) + '</text></docTitle>\n<navMap>\n' +
    navItems.map((f, i) => '<navPoint id="np' + (i + 1) + '" playOrder="' + (i + 1) + '"><navLabel><text>' + esc(f.title) + '</text></navLabel><content src="' + f.href + '"/></navPoint>').join('\n') + '\n</navMap>\n</ncx>\n';
  const container = '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n';

  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/style.css', data: CSS(FAMILY[opts.font] || FAMILY.serif, opts.justify !== false) },
  ].concat(files.map((f) => ({ name: 'OEBPS/' + f.href, data: f.xhtml }))));
}

module.exports = { toEpub, zip, crc32 };
