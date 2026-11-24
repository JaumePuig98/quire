/* Bringing the text of a Word copy back into a book without losing what Word cannot hold.
   The Word copy only has text, headings, quotes and bold/italic/underline. Notes, chapter targets and hidden page numbers
   live in the .draft, so everything that did not change keeps its original block, and notes are moved to the edited text.
   Pure functions: used by the app and by the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./doc.js'), require('./diff.js'));
  else root.DocMerge = factory(root.DocFmt, root.DocDiff);
})(typeof self !== 'undefined' ? self : this, function (D, DD) {
  'use strict';

  const collapse = (s) => s.replace(/\s+/g, ' ');

  // Text and formatting of a block, ignoring notes and what a round trip through Word or Google Docs may change.
  function key(b) {
    const quote = b.t === 'quote';
    let runs = D.normalizeRuns((b.runs || []).map((r) => {
      const x = { text: collapse(r.text) };
      if (r.b) x.b = 1;
      if (r.i && !quote) x.i = 1; // the Word copy sets quotes in italics, so italics inside a quote say nothing
      if (r.u) x.u = 1;
      return x;
    }));
    if (runs.length) { runs[0].text = runs[0].text.replace(/^ +/, ''); runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ +$/, ''); }
    runs = runs.filter((r) => r.text);
    return b.t + '\u0001' + runs.map((r) => (r.b ? 'b' : '') + (r.i ? 'i' : '') + (r.u ? 'u' : '') + ':' + r.text).join('\u0002');
  }
  const isEmpty = (b) => !D.blockText(b).trim();

  // Imported paragraphs as the book's own blocks.
  function cleanBlock(t, runs) {
    let rs = D.normalizeRuns(runs.map((r) => { const x = { text: r.text }; if (r.b) x.b = 1; if (r.i && t !== 'quote') x.i = 1; if (r.u) x.u = 1; return x; }));
    const b = { t, runs: rs };
    if (D.isBreak(b)) b.runs = [{ text: '* * *' }];
    return b;
  }

  // raw: [{t:'p'|'quote'|'h1'|'h2', lvl?, runs}] from the Word file, headings with their Word level.
  // chaptered: the book was exported with one Heading 1 per chapter (several chapters, or a titled single one).
  function chaptersFromRaw(raw, chaptered) {
    const out = [];
    let c = null;
    for (const r of raw) {
      if (r.lvl) {
        if (chaptered && r.lvl === 1) {
          let title = D.blockText(r).replace(/\s+/g, ' ').trim();
          if (title === 'Untitled chapter') title = '';
          c = { title, blocks: [] }; out.push(c); continue;
        }
        const t = chaptered ? (r.lvl === 2 ? 'h1' : 'h2') : (r.lvl === 1 ? 'h1' : 'h2');
        if (!c) { c = { title: '', blocks: [] }; out.push(c); }
        c.blocks.push(cleanBlock(t, r.runs));
        continue;
      }
      if (!c) { c = { title: '', blocks: [] }; out.push(c); }
      c.blocks.push(cleanBlock(r.t === 'quote' ? 'quote' : 'p', r.runs));
    }
    return out;
  }

  // Put note n=id on the characters [start, end) of a block's runs (only where no other note sits).
  function anchor(runs, start, end, id) {
    const out = [];
    let pos = 0;
    for (const r of runs) {
      const a = pos, b = pos + r.text.length;
      pos = b;
      if (b <= start || a >= end) { out.push(r); continue; }
      const s = Math.max(start, a) - a, e = Math.min(end, b) - a;
      if (s > 0) out.push(Object.assign({}, r, { text: r.text.slice(0, s) }));
      const mid = Object.assign({}, r, { text: r.text.slice(s, e) });
      if (!r.n) mid.n = id;
      out.push(mid);
      if (e < r.text.length) out.push(Object.assign({}, r, { text: r.text.slice(e) }));
    }
    return D.normalizeRuns(out);
  }

  // The edited paragraph keeps its notes: on the same words if they are still there, otherwise on its first word.
  function carryNotes(oldBlock, newBlock) {
    const anchors = new Map();
    for (const r of oldBlock.runs) if (r.n) anchors.set(r.n, (anchors.get(r.n) || '') + r.text);
    if (!anchors.size) return { block: newBlock, moved: 0 };
    let runs = newBlock.runs;
    for (const [id, text] of anchors) {
      const all = D.blockText({ runs });
      let at = all.indexOf(text);
      let end = at + text.length;
      if (at < 0) { const m = /\S+/.exec(all); if (!m) continue; at = m.index; end = at + m[0].length; }
      runs = anchor(runs, at, end, id);
    }
    return { block: { t: newBlock.t, runs }, moved: anchors.size };
  }

  const similar = (a, b) => {
    const parts = DD.diffWords(D.blockText(a), D.blockText(b));
    const kept = parts.filter((p) => p.op === 'eq').reduce((n, p) => n + p.text.length, 0);
    return kept >= 0.3 * Math.max(D.blockText(a).length, D.blockText(b).length);
  };

  // Old blocks + imported blocks -> merged blocks. Empty old blocks stay after the paragraph that precedes them.
  function mergeBlocks(oldBlocks, newBlocks, stats) {
    const lead = [], trail = [], O = [];
    for (const b of oldBlocks) {
      if (isEmpty(b)) { if (O.length) trail[O.length - 1].push(b); else lead.push(b); }
      else { O.push(b); trail.push([]); }
    }
    const out = lead.slice();
    const ops = DD.diffArrays(O.map(key), newBlocks.map(key));
    let oi = 0, ni = 0, i = 0;
    while (i < ops.length) {
      if (ops[i].op === 'eq') { out.push(O[oi], ...trail[oi]); oi++; ni++; i++; continue; }
      const dels = [], adds = [];
      while (i < ops.length && ops[i].op !== 'eq') { if (ops[i].op === 'del') dels.push(oi++); else adds.push(ni++); i++; }
      // pair an old paragraph with a new one when they are clearly the same paragraph, edited
      let a = 0;
      for (const d of dels) {
        if (a < adds.length && similar(O[d], newBlocks[adds[a]])) {
          const r = carryNotes(O[d], newBlocks[adds[a]]);
          stats.notesMoved += r.moved; stats.edited++;
          out.push(r.block, ...trail[d]); a++;
        } else stats.removed++; // a deleted paragraph takes its notes with it (the History snapshot keeps them)
      }
      for (; a < adds.length; a++) { out.push(newBlocks[adds[a]]); stats.added++; }
    }
    return out;
  }

  // current: the book now. imported: chapters from chaptersFromRaw. exportedIds: the chapters that were in the Word copy.
  // Returns { doc, stats }. The book's own metadata, notes, chapter targets and hidden page numbers are kept.
  function merge(current, imported, exportedIds) {
    const stats = { edited: 0, added: 0, removed: 0, notesMoved: 0, chaptersAdded: 0, chaptersRemoved: 0 };
    const E = current.chapters;
    const exported = E.filter((c) => exportedIds.has(c.id));
    // match chapters by title in order; in the stretches between matches, pair them one to one (a renamed chapter)
    const match = new Array(imported.length).fill(null);
    const titles = (x) => x.map((c) => (c.title || '').trim());
    const ops = DD.diffArrays(titles(exported), titles(imported));
    let ei = 0, ii = 0, i = 0;
    const usedE = new Set();
    while (i < ops.length) {
      if (ops[i].op === 'eq') { match[ii] = exported[ei]; usedE.add(exported[ei].id); ei++; ii++; i++; continue; }
      const dels = [], adds = [];
      while (i < ops.length && ops[i].op !== 'eq') { if (ops[i].op === 'del') dels.push(ei++); else adds.push(ii++); i++; }
      const n = Math.min(dels.length, adds.length);
      for (let k = 0; k < n; k++) { match[adds[k]] = exported[dels[k]]; usedE.add(exported[dels[k]].id); }
    }
    stats.chaptersRemoved = exported.filter((c) => !usedE.has(c.id)).length;
    const result = [];
    const flushed = new Set();
    const flushBefore = (idx) => { for (let k = 0; k < idx; k++) if (!exportedIds.has(E[k].id) && !flushed.has(E[k].id)) { flushed.add(E[k].id); result.push(E[k]); } };
    imported.forEach((imp, k) => {
      const e = match[k];
      if (!e) { result.push({ id: D.newChapter().id, title: imp.title, blocks: imp.blocks.length ? imp.blocks : [{ t: 'p', runs: [] }] }); stats.chaptersAdded++; return; }
      flushBefore(E.indexOf(e));
      const ch = Object.assign({}, e, { title: imp.title, blocks: mergeBlocks(e.blocks, imp.blocks, stats) });
      if (!ch.blocks.length) ch.blocks = [{ t: 'p', runs: [] }];
      result.push(ch);
    });
    flushBefore(E.length);
    const doc = Object.assign({}, current, { chapters: result.length ? result : E });
    return { doc, stats };
  }

  return { key, chaptersFromRaw, merge, mergeBlocks, carryNotes };
});
