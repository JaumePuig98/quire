/* Compare two versions of a document: paragraph diff, then a word diff inside paragraphs that changed.
   Works in the app and in Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./doc.js'));
  else root.DocDiff = factory(root.DocFmt);
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  // Longest common subsequence of two string arrays, returned as ops. Equal head and tail are trimmed first so edits in a long book stay cheap.
  function diffArrays(a, b) {
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length, eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    const out = [];
    for (let i = 0; i < s; i++) out.push({ op: 'eq', a: a[i], b: b[i] });
    const A = a.slice(s, ea), B = b.slice(s, eb), n = A.length, m = B.length;
    if (n * m > 4000000) { // too large for the table: treat the middle as one replaced block
      A.forEach((x) => out.push({ op: 'del', a: x }));
      B.forEach((x) => out.push({ op: 'add', b: x }));
    } else {
      const w = m + 1, t = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = A[i] === B[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (A[i] === B[j]) { out.push({ op: 'eq', a: A[i], b: B[j] }); i++; j++; }
        else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) out.push({ op: 'del', a: A[i++] });
        else out.push({ op: 'add', b: B[j++] });
      }
      while (i < n) out.push({ op: 'del', a: A[i++] });
      while (j < m) out.push({ op: 'add', b: B[j++] });
    }
    for (let i = ea; i < a.length; i++) out.push({ op: 'eq', a: a[i], b: b[eb + i - ea] });
    return out;
  }

  const words = (s) => s.split(/(\s+)/).filter((x) => x !== '');

  // Word level diff of two paragraphs: [{op:'eq'|'del'|'add', text}], neighbours of the same kind merged.
  function diffWords(a, b) {
    const parts = [];
    for (const o of diffArrays(words(a), words(b))) {
      const op = o.op, text = op === 'add' ? o.b : o.a;
      const last = parts[parts.length - 1];
      if (last && last.op === op) last.text += text; else parts.push({ op, text });
    }
    return parts;
  }

  // Flatten a document into comparable lines: one per paragraph, chapter titles included.
  function lines(doc) {
    const out = [];
    doc.chapters.forEach((c, i) => {
      out.push({ key: 'C\u0001' + (c.title || ''), text: c.title || 'Chapter ' + (i + 1), chapter: true });
      for (const b of c.blocks) {
        const t = D.blockText(b);
        if (t.trim()) out.push({ key: 'B\u0001' + t, text: t, t: b.t });
      }
    });
    return out;
  }

  // compare(old, new) -> { rows:[{kind:'same'|'del'|'add'|'chg', text?, parts?, chapter?}], added, removed, changed, words }
  function compare(oldDoc, newDoc) {
    const A = lines(oldDoc), B = lines(newDoc);
    const ops = diffArrays(A.map((x) => x.key), B.map((x) => x.key));
    const rows = [];
    let ai = 0, bi = 0, i = 0;
    const st = { added: 0, removed: 0, changed: 0, words: 0 };
    while (i < ops.length) {
      if (ops[i].op === 'eq') { rows.push({ kind: 'same', text: B[bi].text, chapter: B[bi].chapter }); ai++; bi++; i++; continue; }
      const dels = [], adds = [];
      while (i < ops.length && ops[i].op !== 'eq') { if (ops[i].op === 'del') dels.push(A[ai++]); else adds.push(B[bi++]); i++; }
      const pairs = Math.min(dels.length, adds.length);
      // Pair a removed paragraph with an added one in order, so an edited paragraph shows as one changed row with word marks.
      for (let k = 0; k < pairs; k++) {
        if (dels[k].chapter !== adds[k].chapter) { rows.push({ kind: 'del', text: dels[k].text, chapter: dels[k].chapter }, { kind: 'add', text: adds[k].text, chapter: adds[k].chapter }); st.removed++; st.added++; continue; }
        const parts = diffWords(dels[k].text, adds[k].text);
        const kept = parts.filter((p) => p.op === 'eq').reduce((n, p) => n + p.text.length, 0);
        if (kept < 0.3 * Math.max(dels[k].text.length, adds[k].text.length)) { // mostly different: show it as removed plus added, not as a messy word diff
          rows.push({ kind: 'del', text: dels[k].text, chapter: dels[k].chapter }, { kind: 'add', text: adds[k].text, chapter: adds[k].chapter });
          st.removed++; st.added++; st.words += dels[k].text.split(/\s+/).filter(Boolean).length + adds[k].text.split(/\s+/).filter(Boolean).length; continue;
        }
        rows.push({ kind: 'chg', parts, chapter: adds[k].chapter }); st.changed++;
        for (const p of parts) if (p.op !== 'eq' && p.text.trim()) st.words += p.text.trim().split(/\s+/).length;
      }
      for (let k = pairs; k < dels.length; k++) { rows.push({ kind: 'del', text: dels[k].text, chapter: dels[k].chapter }); st.removed++; st.words += dels[k].text.split(/\s+/).filter(Boolean).length; }
      for (let k = pairs; k < adds.length; k++) { rows.push({ kind: 'add', text: adds[k].text, chapter: adds[k].chapter }); st.added++; st.words += adds[k].text.split(/\s+/).filter(Boolean).length; }
    }
    return Object.assign({ rows }, st);
  }

  return { diffArrays, diffWords, compare };
});
