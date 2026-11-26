/* Document model + format helpers, shared by the main process and the renderer.
 *
 * Model
 *   doc      = { format:'draft', version:1, title, created, modified, chapters:[chapter], notes:{id:{text,created}} }
 *   chapter  = { id, title, blocks:[block] }
 *   block    = { t:'p'|'h1'|'h2'|'quote'|'poem', runs:[run] }  (a poem block is one stanza: its lines are separated by \n)
 *   run      = { text, b?, i?, u?, n? }          n = note id the run belongs to
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DocFmt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FORMAT = 'draft';
  const VERSION = 1;

  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = () => new Date().toISOString();

  function newChapter(title) {
    return { id: uid(), title: title || '', blocks: [{ t: 'p', runs: [] }] };
  }
  // kind: 'book' (the default, left out of the file), 'text' (one piece of writing) or 'journal' (dated entries).
  const KINDS = ['book', 'text', 'journal'];
  function newDoc(kind) {
    const doc = { format: FORMAT, version: VERSION, id: uid(), title: '', created: now(), modified: now(), chapters: [newChapter()], notes: {} };
    if (kind === 'text' || kind === 'journal') doc.kind = kind;
    if (kind === 'journal') doc.chapters = [newEntry()];
    return doc;
  }
  // A journal entry is a chapter with the moment it was started (ISO time) and an optional title.
  function newEntry(when) {
    const c = newChapter();
    c.at = (when instanceof Date ? when : new Date()).toISOString();
    return c;
  }
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // How a journal shows its dates: the date part and the time part (a journal keeps its choice in its file).
  const DATE_FMTS = ['long', 'full', 'us', 'iso', 'dmy'], TIME_FMTS = ['24', '12', 'none'];
  // "Wed 25 Nov 2026, 09:32" (the default) in the computer's time zone
  function stamp(iso, fmt) {
    const t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    fmt = fmt || {};
    const p2 = (n) => String(n).padStart(2, '0');
    const df = DATE_FMTS.indexOf(fmt.date) >= 0 ? fmt.date : 'long', tf = TIME_FMTS.indexOf(fmt.time) >= 0 ? fmt.time : '24';
    const y = t.getFullYear(), m = t.getMonth(), dd = t.getDate(), w = t.getDay();
    const date = df === 'full' ? DAYS_FULL[w] + ' ' + dd + ' ' + MONTHS_FULL[m] + ' ' + y
      : df === 'us' ? DAYS[w] + ', ' + MONTHS[m] + ' ' + dd + ', ' + y
      : df === 'iso' ? y + '-' + p2(m + 1) + '-' + p2(dd)
      : df === 'dmy' ? p2(dd) + '/' + p2(m + 1) + '/' + y
      : DAYS[w] + ' ' + dd + ' ' + MONTHS[m] + ' ' + y;
    const h = t.getHours();
    const time = tf === 'none' ? '' : tf === '12' ? (h % 12 || 12) + ':' + p2(t.getMinutes()) + ' ' + (h < 12 ? 'AM' : 'PM') : p2(h) + ':' + p2(t.getMinutes());
    return time ? date + (df === 'iso' || df === 'dmy' ? ' ' : ', ') + time : date;
  }
  // The day an entry belongs to, when a new day starts at startHour (0 = midnight; 4 means 1 a.m. still counts as the evening before).
  function dayKey(iso, startHour) {
    const t = new Date(new Date(iso).getTime() - (Math.max(0, Math.min(12, parseInt(startHour, 10) || 0))) * 3600000);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }
  const stampFor = (doc, iso) => stamp(iso, { date: doc.dateFmt, time: doc.timeFmt });
  // The name of a chapter as it is shown and exported: a journal entry is its date and time, then its title if it has one.
  function chapterLabel(doc, c) {
    const title = (c.title || '').trim();
    if (doc.kind === 'journal') {
      const s = c.at ? stampFor(doc, c.at) : '';
      return s && title ? s + ' \u00b7 ' + title : s || title || 'Untitled entry';
    }
    return title || 'Untitled chapter';
  }

  const blockText = (b) => b.runs.map((r) => r.text).join('');
  // A quote line that starts with a dash is the author of the quote.
  const isCite = (b) => b.t === 'quote' && /^\s*[-\u2013\u2014]/.test(blockText(b));
  function countWords(blocks) {
    let n = 0;
    for (const b of blocks) {
      const t = blockText(b).trim();
      if (t) n += t.split(/\s+/).length;
    }
    return n;
  }
  const countDoc = (doc) => doc.chapters.reduce((s, c) => s + countWords(c.blocks), 0);

  // A scene break is an ordinary paragraph that holds only * * * : older versions of the app still show it, and it exports centered.
  const isBreak = (b) => b.t === 'p' && /^\s*(\*\s*){3}$/.test(blockText(b));
  const sameFmt = (a, b) => !!a.b === !!b.b && !!a.i === !!b.i && !!a.u === !!b.u && (a.n || '') === (b.n || '');
  // A poem block as one list of runs per line (the lines are separated by \n inside the runs).
  function poemLines(block) {
    const lines = [[]];
    normalizeRuns(block.runs).forEach((r) => {
      r.text.split('\n').forEach((t, i) => {
        if (i > 0) lines.push([]);
        if (t) lines[lines.length - 1].push(Object.assign({}, r, { text: t }));
      });
    });
    return lines;
  }

  function normalizeRuns(runs) {
    const out = [];
    for (const r of runs) {
      if (!r.text) continue;
      const last = out[out.length - 1];
      if (last && sameFmt(last, r)) last.text += r.text;
      else out.push(Object.assign({}, r));
    }
    return out;
  }

  // File-name friendly version of a title: "Mi Novela: Capítulo 1" -> "mi-novela-capitulo-1"
  function slugify(s) {
    const out = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
    return out || 'untitled';
  }

  /* ---------- .draft file ---------- */
  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const BLOCK_TYPES = { p: 1, h1: 1, h2: 1, quote: 1, poem: 1 };
  // Reads a document from outside (a file, a backup) and returns a clean copy: whatever is damaged is repaired or dropped,
  // so a bad file can never crash the app.
  function validate(doc) {
    if (!doc || typeof doc !== 'object' || doc.format !== FORMAT) throw new Error('This is not a .draft document.');
    if (typeof doc.version !== 'number' || doc.version > VERSION)
      throw new Error('This document was made with a newer version of the app. Please update the app to open it.');
    const str = (v) => (typeof v === 'string' ? v : '');
    const out = {
      format: FORMAT, version: VERSION,
      id: typeof doc.id === 'string' && ID_RE.test(doc.id) ? doc.id : uid(),
      title: str(doc.title), created: str(doc.created) || now(), modified: str(doc.modified) || now(),
      chapters: [], notes: {},
    };
    for (const k of ['author', 'subtitle', 'extra']) if (typeof doc[k] === 'string' && doc[k].trim()) out[k] = doc[k];
    if (doc.kind === 'text' || doc.kind === 'journal') out.kind = doc.kind;
    if (doc.kind === 'journal') { if (DATE_FMTS.indexOf(doc.dateFmt) > 0) out.dateFmt = doc.dateFmt; if (TIME_FMTS.indexOf(doc.timeFmt) > 0) out.timeFmt = doc.timeFmt; } // only a choice other than the default is kept
    const seen = new Set();
    for (const c of Array.isArray(doc.chapters) ? doc.chapters : []) {
      if (!c || typeof c !== 'object') continue;
      let id = typeof c.id === 'string' && ID_RE.test(c.id) ? c.id : uid();
      while (seen.has(id)) id = uid();
      seen.add(id);
      const blocks = [];
      for (const b of Array.isArray(c.blocks) ? c.blocks : []) {
        if (!b || typeof b !== 'object') continue;
        const runs = [];
        for (const r of Array.isArray(b.runs) ? b.runs : []) {
          if (!r || typeof r !== 'object' || typeof r.text !== 'string') continue;
          const run = { text: r.text };
          if (r.b) run.b = 1;
          if (r.i) run.i = 1;
          if (r.u) run.u = 1;
          if (typeof r.n === 'string' && ID_RE.test(r.n)) run.n = r.n;
          runs.push(run);
        }
        blocks.push({ t: BLOCK_TYPES[b.t] === 1 ? b.t : 'p', runs });
      }
      const ch = { id, title: str(c.title), blocks: blocks.length ? blocks : [{ t: 'p', runs: [] }] };
      if (typeof c.at === 'string' && !isNaN(Date.parse(c.at))) ch.at = c.at;
      if (c.nonum) ch.nonum = true; // this chapter's page numbers are not shown (the pages are still counted)
      if (Number.isInteger(c.goal) && c.goal > 0 && c.goal <= 2000000) ch.goal = c.goal; // this chapter's word target
      out.chapters.push(ch);
    }
    if (!out.chapters.length) out.chapters = [newChapter()];
    if (doc.notes && typeof doc.notes === 'object') {
      for (const id of Object.keys(doc.notes)) {
        const n = doc.notes[id];
        if (ID_RE.test(id) && n && typeof n === 'object' && typeof n.text === 'string') out.notes[id] = { text: n.text, created: str(n.created) || now() };
      }
    }
    return out;
  }
  function parseDraft(text) {
    let doc;
    if (typeof text === 'string' && text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // Notepad and PowerShell can add a byte-order mark
    try { doc = JSON.parse(text); } catch (e) { throw new Error('This file is damaged or is not a .draft document.'); }
    return validate(doc);
  }
  // One block per line, so version control (git) shows readable diffs.
  function serializeDraft(doc) {
    const head = { format: FORMAT, version: VERSION, id: doc.id, title: doc.title || '', created: doc.created, modified: doc.modified };
    for (const k of ['subtitle', 'author', 'extra']) if (doc[k]) head[k] = doc[k];
    if (doc.kind === 'text' || doc.kind === 'journal') head.kind = doc.kind;
    if (doc.kind === 'journal') { if (DATE_FMTS.indexOf(doc.dateFmt) > 0) head.dateFmt = doc.dateFmt; if (TIME_FMTS.indexOf(doc.timeFmt) > 0) head.timeFmt = doc.timeFmt; }
    const chapters = doc.chapters.map((c) => {
      const blocks = c.blocks.map((b) => '    ' + JSON.stringify({ t: b.t, runs: normalizeRuns(b.runs) })).join(',\n');
      return '  {\n   "id": ' + JSON.stringify(c.id) + ', "title": ' + JSON.stringify(c.title) + (c.at ? ', "at": ' + JSON.stringify(c.at) : '') + (c.nonum ? ', "nonum": true' : '') + (c.goal > 0 ? ', "goal": ' + (c.goal | 0) : '') + ',\n   "blocks": [\n' + blocks + '\n   ]\n  }';
    });
    const used = usedNoteIds(doc);
    const notes = {};
    for (const id of Object.keys(doc.notes)) if (used.has(id)) notes[id] = doc.notes[id];
    const noteLines = Object.keys(notes).map((id) => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(notes[id]));
    return (
      '{\n' +
      Object.keys(head).map((k) => ' ' + JSON.stringify(k) + ': ' + JSON.stringify(head[k])).join(',\n') +
      ',\n "chapters": [\n' + chapters.join(',\n') + '\n ],\n "notes": {' +
      (noteLines.length ? '\n' + noteLines.join(',\n') + '\n ' : '') + '}\n}\n'
    );
  }
  function usedNoteIds(doc) {
    const s = new Set();
    for (const c of doc.chapters) for (const b of c.blocks) for (const r of b.runs) if (r.n) s.add(r.n);
    return s;
  }
  // Notes in order of first appearance: [{id, text, num}]
  function orderedNotes(doc) {
    const out = [];
    const seen = new Set();
    for (const c of doc.chapters) for (const b of c.blocks) for (const r of b.runs) {
      if (r.n && !seen.has(r.n) && doc.notes[r.n]) { seen.add(r.n); out.push({ id: r.n, text: doc.notes[r.n].text || '', num: out.length + 1 }); }
    }
    return out;
  }

  /* ---------- headings ---------- */
  // With several chapters, chapter titles are the top heading and in-text headings move one level down.
  // The copy of a document that gets exported: only the chosen chapters, and a chapter without a name takes its first Heading 1
  // as its name (so it is not exported as "Untitled chapter" with the real title demoted underneath).
  function forExport(doc, opts) {
    opts = opts || {};
    const manyChapters = doc.chapters.length > 1;
    let chapters = doc.chapters;
    if (Array.isArray(opts.chapterIds)) {
      const keep = new Set(opts.chapterIds);
      const picked = chapters.filter((c) => keep.has(c.id));
      if (picked.length) chapters = picked;
    }
    chapters = chapters.map((c) => {
      if (!manyChapters || c.title.trim() || doc.kind === 'journal') return c;
      const i = c.blocks.findIndex((b) => blockText(b).trim());
      if (i < 0 || c.blocks[i].t !== 'h1') return c;
      return Object.assign({}, c, { title: blockText(c.blocks[i]).trim(), blocks: c.blocks.slice(0, i).concat(c.blocks.slice(i + 1)) });
    });
    // A chapter with no title and no text at all is left out, so it does not become an "Untitled chapter" page.
    const filled = chapters.filter((c) => c.title.trim() || c.blocks.some((b) => blockText(b).trim()));
    if (filled.length && filled.length < chapters.length) chapters = filled;
    return Object.assign({}, doc, { chapters });
  }
  function headingPlan(doc) {
    const titled = doc.kind === 'journal' || doc.chapters.length > 1 || (doc.chapters[0] && doc.chapters[0].title.trim() !== '');
    return { chapterHeadings: titled, shift: titled ? 1 : 0 };
  }
  const blockLevel = (b, shift) => (b.t === 'h1' ? 1 + shift : b.t === 'h2' ? 2 + shift : 0);

  /* ---------- Markdown ---------- */
  function escMd(s) { return s.replace(/\\/g, '\\\\').replace(/\*/g, '\\*'); }
  function mdRun(r) {
    let t = escMd(r.text).replace(/\n/g, '  \n');
    if (!t.trim()) return t;
    const lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0];
    let core = t.slice(lead.length, t.length - trail.length);
    if (r.u) core = '<u>' + core + '</u>';
    if (r.b && r.i) core = '***' + core + '***';
    else if (r.b) core = '**' + core + '**';
    else if (r.i) core = '*' + core + '*';
    return lead + core + trail;
  }
  function inlineMd(runs, marker) {
    let s = '';
    runs = normalizeRuns(runs);
    for (let k = 0; k < runs.length; k++) {
      s += mdRun(runs[k]);
      const r = runs[k], nx = runs[k + 1];
      if (r.n && marker && (!nx || nx.n !== r.n)) { const m = marker(r.n); if (m) s += m; }
    }
    return s;
  }
  function toMarkdown(doc, opts) {
    opts = opts || {};
    doc = forExport(doc, opts);
    const plan = headingPlan(doc);
    const notes = opts.notes ? orderedNotes(doc) : [];
    const num = {};
    notes.forEach((n) => (num[n.id] = n.num));
    const emitted = new Set();
    const marker = (id) => { if (!num[id] || emitted.has(id)) return ''; emitted.add(id); return '[^' + num[id] + ']'; };
    const out = [];
    if (opts.titlePage && (doc.title || '').trim()) { out.push('# ' + escMd(doc.title.trim())); if (doc.subtitle) out.push('*' + escMd(doc.subtitle.trim()) + '*'); if (opts.author) out.push('by ' + escMd(opts.author)); if (doc.extra) out.push(escMd(doc.extra.trim())); out.push('---'); }
    doc.chapters.forEach((c) => {
      if (plan.chapterHeadings) out.push('# ' + escMd(chapterLabel(doc, c)));
      for (const b of c.blocks) {
        if (isBreak(b)) { out.push('* * *'); continue; }
        const body = inlineMd(b.runs, opts.notes ? marker : null);
        if (!body.trim()) continue;
        const lvl = blockLevel(b, plan.shift);
        if (lvl) out.push('#'.repeat(Math.min(lvl, 6)) + ' ' + body.replace(/\n/g, ' '));
        else if (b.t === 'quote') out.push(body.split('\n').map((l) => '> ' + l).join('\n'));
        else out.push(/^[#>]/.test(body) ? '\\' + body : body);
      }
    });
    if (notes.length) out.push(notes.map((n) => '[^' + n.num + ']: ' + n.text.replace(/\n+/g, ' ')).join('\n'));
    return out.join('\n\n') + '\n';
  }
  function toPlainText(doc, opts) {
    opts = opts || {};
    doc = forExport(doc, opts);
    const plan = headingPlan(doc);
    const notes = opts.notes ? orderedNotes(doc) : [];
    const num = {};
    notes.forEach((n) => (num[n.id] = n.num));
    const emitted = new Set();
    const out = [];
    if (opts.titlePage && (doc.title || '').trim()) { out.push(doc.title.trim().toUpperCase()); if (doc.subtitle) out.push(doc.subtitle.trim()); if (opts.author) out.push('by ' + opts.author); if (doc.extra) out.push(doc.extra.trim()); out.push('* * *'); }
    doc.chapters.forEach((c, ci) => {
      if (plan.chapterHeadings) out.push((ci ? '\n' : '') + chapterLabel(doc, c).toUpperCase());
      for (const b of c.blocks) {
        let s = '';
        const runs = normalizeRuns(b.runs);
        runs.forEach((r, k) => {
          s += r.text;
          const nx = runs[k + 1];
          if (r.n && num[r.n] && !emitted.has(r.n) && (!nx || nx.n !== r.n)) { emitted.add(r.n); s += '[' + num[r.n] + ']'; }
        });
        if (!s.trim()) continue;
        out.push(b.t === 'quote' || b.t === 'poem' ? s.split('\n').map((l) => '    ' + l).join('\n') : s);
      }
    });
    if (notes.length) out.push('\nNotes\n' + notes.map((n) => '[' + n.num + '] ' + n.text.replace(/\n+/g, ' ')).join('\n'));
    return out.join('\n\n') + '\n';
  }

  function parseInlineMd(src) {
    const runs = [];
    let b = false, i = false, u = false, buf = '';
    const flush = () => { if (buf) runs.push({ text: buf, b, i, u }); buf = ''; };
    for (let k = 0; k < src.length; k++) {
      const ch = src[k];
      if (ch === '\\' && k + 1 < src.length) { buf += src[++k]; continue; }
      if (ch === '*') {
        flush();
        if (src[k + 1] === '*') { b = !b; k++; } else i = !i;
        continue;
      }
      if (src.startsWith('<u>', k)) { flush(); u = true; k += 2; continue; }
      if (src.startsWith('</u>', k)) { flush(); u = false; k += 3; continue; }
      buf += ch;
    }
    flush();
    return normalizeRuns(runs.map((r) => { const o = { text: r.text }; if (r.b) o.b = 1; if (r.i) o.i = 1; if (r.u) o.u = 1; return o; }));
  }
  // Markdown / plain text -> one-chapter document. Lines separated by a blank line are paragraphs.
  function fromMarkdown(text, title) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let para = [];
    const flushPara = () => {
      if (para.length) blocks.push({ t: 'p', runs: parseInlineMd(para.join(' ').trim()) });
      para = [];
    };
    for (const line of lines) {
      let m;
      if (!line.trim()) { flushPara(); continue; }
      if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) { flushPara(); blocks.push({ t: 'p', runs: [{ text: '* * *' }] }); continue; } // a horizontal rule is a scene break
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara();
        blocks.push({ t: m[1].length === 1 ? 'h1' : 'h2', runs: parseInlineMd(m[2]) });
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        flushPara();
        const last = blocks[blocks.length - 1];
        if (last && last.t === 'quote' && last._open) { last.runs.push({ text: ' ' }); last.runs.push(...parseInlineMd(m[1])); }
        else blocks.push({ t: 'quote', runs: parseInlineMd(m[1]), _open: true });
      } else {
        if (blocks.length && blocks[blocks.length - 1]._open) delete blocks[blocks.length - 1]._open;
        para.push(line.trim());
      }
    }
    flushPara();
    blocks.forEach((b) => { delete b._open; b.runs = normalizeRuns(b.runs); });
    if (!blocks.length) blocks.push({ t: 'p', runs: [] });
    const doc = newDoc();
    doc.title = title || '';
    doc.chapters[0].blocks = blocks;
    return doc;
  }

  return {
    FORMAT, VERSION, KINDS, DATE_FMTS, TIME_FMTS, slugify, uid, now, newDoc, newChapter, newEntry, stamp, stampFor, dayKey, chapterLabel, blockText, isCite, countWords, countDoc, normalizeRuns, poemLines, isBreak, validate,
    parseDraft, serializeDraft, usedNoteIds, orderedNotes, headingPlan, forExport, blockLevel,
    toMarkdown, toPlainText, fromMarkdown, parseInlineMd,
  };
});
