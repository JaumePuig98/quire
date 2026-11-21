(function () {
  'use strict';
  const D = window.DocFmt;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const editor = $('#editor');
  const scroller = $('#scroller');
  const page = $('#page');
  const glow = $('#glow');
  const root = document.documentElement;

  document.execCommand('defaultParagraphSeparator', false, 'p');

  /* ============================ state ============================ */
  const init = window.api.init();
  let prefs = init.prefs;
  const DEFAULTS = init.defaults || {};
  let systemDark = init.systemDark;
  let doc = null;
  let cur = 0; // index of the chapter in the editor
  let filePath = null;
  let reading = false;
  let dirty = false;
  let saving = false;
  let wordCounts = []; // cached words per chapter
  let activeNote = null;
  let review = false; // review mode: typos and notes, no centering, no fading
  let shiftX = 0; // horizontal slide of the line being written
  let liveEl = null; // the paragraph being written; its current line is drawn on a sliding layer

  /* ============================ helpers ============================ */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const baseName = (p) => (p ? p.split(/[\\/]/).pop() : 'Untitled');
  const stem = (p) => baseName(p).replace(/\.[^.]+$/, '');
  const todayKey = () => new Date().toISOString().slice(0, 10);

  /* ============================ preferences ============================ */
  // Accent colors: caret, note underline, selection and the soft light. [light theme, dark theme, light glow, dark glow]
  const ACCENTS = {
    amber: { ink: '159 89 26', name: 'Amber', l: '181 101 29', d: '232 165 90', gl: '255 224 150', gd: '255 190 100' },
    rose: { ink: '176 72 90', name: 'Rose', l: '176 72 90', d: '232 130 150', gl: '255 205 215', gd: '255 150 170' },
    sage: { ink: '76 115 86', name: 'Sage', l: '83 125 94', d: '140 190 150', gl: '205 235 210', gd: '140 200 160' },
    ocean: { ink: '52 107 150', name: 'Ocean', l: '52 107 150', d: '120 175 220', gl: '195 222 245', gd: '110 170 225' },
    plum: { ink: '128 85 150', name: 'Plum', l: '128 85 150', d: '190 150 215', gl: '226 206 240', gd: '170 130 200' },
    slate: { ink: '90 90 95', name: 'Slate', l: '90 90 95', d: '190 190 195', gl: '226 226 231', gd: '200 200 210' },
  };
  const CHEV_R = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.2 2.2 8 6l-3.8 3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHEV_L = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.8 2.2 4 6l3.8 3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function savePrefs(patch) {
    Object.assign(prefs, patch);
    window.api.setPrefs(patch);
    applyPrefs();
    if (patch.readScope !== undefined && reading) renderChapter();
  }
  function applyPrefs() {
    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemDark);
    document.body.classList.toggle('dark', dark);
    document.body.dataset.font = prefs.font;
    document.body.classList.toggle('justify', prefs.justify !== false);
    const fmtHidden = prefs.fmtbar === false;
    document.body.classList.toggle('fmthidden', fmtHidden);
    const ft = $('#fmtToggle');
    if (ft) {
      ft.innerHTML = fmtHidden ? CHEV_L : CHEV_R;
      ft.title = fmtHidden ? 'Show the formatting bar (Ctrl+/)' : 'Hide the formatting bar (Ctrl+/)';
      ft.setAttribute('aria-expanded', String(!fmtHidden));
    }
    const ac = ACCENTS[prefs.accent] || ACCENTS.amber;
    document.body.style.setProperty('--accent', dark ? ac.d : ac.l);
    document.body.style.setProperty('--accent-ink', dark ? ac.d : ac.ink); // darker on light backgrounds so text in the accent stays readable
    document.body.style.setProperty('--glow', dark ? ac.gd : ac.gl);
    const sw = $('.swatches');
    if (sw && sw.children.length !== Object.keys(ACCENTS).length) {
      sw.innerHTML = '';
      Object.keys(ACCENTS).forEach((id) => {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.v = id; b.title = ACCENTS[id].name; b.setAttribute('aria-label', ACCENTS[id].name);
        sw.appendChild(b);
      });
    }
    if (sw) $$('button', sw).forEach((b) => { const a = ACCENTS[b.dataset.v]; b.style.background = 'rgb(' + (dark ? a.d : a.l) + ')'; });
    root.style.setProperty('--fs', prefs.size + 'px');
    const oneWeight = prefs.font === 'type'; // Courier Prime comes in a single weight
    root.style.setProperty('--fw', oneWeight ? 400 : (prefs.weight || 400));
    $$('[data-pref=weight],[data-num=weight]').forEach((el) => { el.disabled = oneWeight; });
    const wrow = $('[data-pref=weight]'); if (wrow) { const rw = wrow.closest('.row'); rw.classList.toggle('disabled', oneWeight); rw.title = oneWeight ? 'The Typewriter font has one weight' : ''; }
    root.style.setProperty('--measure', prefs.measure + 'px');
    root.style.setProperty('--anchor', prefs.anchor);
    document.body.classList.toggle('nofade', !prefs.fade);
    document.body.classList.toggle('noglow', !prefs.glow);
    $('#btnFull').textContent = 'Full screen';
    // settings panel
    $$('[data-pref]').forEach((el) => {
      const k = el.dataset.pref;
      if (el.classList.contains('seg') || el.classList.contains('swatches')) $$('button', el).forEach((b) => { const on = b.dataset.v === String(prefs[k]); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      else if (el.type === 'checkbox') el.checked = !!prefs[k];
      else if (document.activeElement !== el) el.value = prefs[k];
    });
    $$('[data-num]').forEach((el) => { if (document.activeElement !== el) el.value = prefs[el.dataset.num]; });
    $$('[data-reset]').forEach((b) => { b.classList.toggle('show', DEFAULTS[b.dataset.reset] !== undefined && prefs[b.dataset.reset] !== DEFAULTS[b.dataset.reset]); });
    kick(false);
    if (reading) layoutGutter();
    updateStatus();
  }

  /* ============================ DOM <-> model ============================ */
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI', 'UL', 'OL']);

  function collectRuns(node, fmt, out) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const text = n.nodeValue.replace(/ /g, ' ').replace(/[​﻿]/g, '');
        if (text) out.push(Object.assign({ text }, fmt));
      } else if (n.nodeType === 1) {
        if (n.tagName === 'BR') { out.push(Object.assign({ text: '\n' }, fmt)); continue; }
        const f = Object.assign({}, fmt);
        const tag = n.tagName;
        const st = n.style || {};
        if (tag === 'B' || tag === 'STRONG' || st.fontWeight === 'bold' || +st.fontWeight >= 600) f.b = 1;
        if (tag === 'I' || tag === 'EM' || st.fontStyle === 'italic') f.i = 1;
        if (tag === 'U' || (st.textDecorationLine || st.textDecoration || '').includes('underline')) f.u = 1;
        if (n.dataset && n.dataset.note) f.n = n.dataset.note;
        collectRuns(n, f, out);
      }
    }
  }
  function domToBlocks(rootEl) {
    const blocks = [];
    const push = (t, holder) => {
      const runs = [];
      collectRuns(holder, {}, runs);
      while (runs.length && runs[runs.length - 1].text === '\n') runs.pop();
      blocks.push({ t, runs: D.normalizeRuns(runs) });
    };
    const hasBlockChild = (el) => Array.from(el.children).some((c) => BLOCK.has(c.tagName));
    const walk = (parent, inherited) => {
      let loose = [];
      const flush = () => {
        if (loose.length && loose.some((n) => n.nodeType === 1 || n.nodeValue.trim())) push(inherited || 'p', { childNodes: loose });
        loose = [];
      };
      for (const n of parent.childNodes) {
        if (n.nodeType === 1 && BLOCK.has(n.tagName)) {
          flush();
          const tag = n.tagName;
          const t = tag === 'H1' ? 'h1' : /^H[2-6]$/.test(tag) ? 'h2' : tag === 'BLOCKQUOTE' ? 'quote' : inherited || 'p';
          if (hasBlockChild(n)) walk(n, t);
          else push(t, n);
        } else if (n.nodeType === 1 || n.nodeType === 3) loose.push(n);
      }
      flush();
    };
    walk(rootEl, null);
    if (!blocks.length) blocks.push({ t: 'p', runs: [] });
    return blocks;
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function blocksToHtml(blocks) {
    return blocks.map((b) => {
      const tag = b.t === 'h1' ? 'h1' : b.t === 'h2' ? 'h2' : b.t === 'quote' ? 'blockquote' : 'p';
      let inner = '';
      for (const r of b.runs) {
        let h = esc(r.text).replace(/\n/g, '<br>');
        if (r.u) h = '<u>' + h + '</u>';
        if (r.i) h = '<i>' + h + '</i>';
        if (r.b) h = '<b>' + h + '</b>';
        if (r.n) {
          const nt = doc.notes[r.n] ? esc(doc.notes[r.n].text) : '';
          h = '<span class="note" data-note="' + r.n + '" title="' + nt + '">' + h + '</span>';
        }
        inner += h;
      }
      const cls = D.isCite(b) ? ' class="cite"' : '';
      return '<' + tag + cls + '>' + (inner || '<br>') + '</' + tag + '>';
    }).join('');
  }

  let bookScrollRef = -1; // where the page was put by the program; only a real scroll by the reader changes the chapter
  const readingBook = () => reading && prefs.readScope === 'book';
  function syncFromDom() {
    if (!doc || readingBook()) return; // the page then holds the whole book and the text cannot be edited
    doc.chapters[cur].blocks = domToBlocks(editor);
    wordCounts[cur] = D.countWords(doc.chapters[cur].blocks);
  }
  function snapshotDoc() {
    syncFromDom();
    const used = D.usedNoteIds(doc);
    for (const id of Object.keys(doc.notes)) if (!used.has(id)) delete doc.notes[id];
    doc.modified = D.now();
    return doc;
  }
  function renderChapter() {
    setLive(null);
    layoutMarks();
    if (readingBook()) {
      const multi = doc.chapters.length > 1;
      editor.innerHTML = doc.chapters.map((c, i) => (multi ? '<div class="chapsep" data-ch="' + i + '" contenteditable="false">' + (c.title.trim() ? c.title.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;') : '* * *') + '</div>' : '') + blocksToHtml(c.blocks)).join('');
      const s = editor.querySelector('.chapsep[data-ch="' + cur + '"]');
      scroller.scrollTop = s ? Math.max(0, s.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 40) : 0;
      bookScrollRef = scroller.scrollTop;
      layoutGutter();
      if (!fb.hidden) { find.ranges = collectRanges(); paintFind(); }
      return;
    }
    editor.innerHTML = blocksToHtml(doc.chapters[cur].blocks);
    if (!histFor().stack.length) { const st = snapState(); st.caret = null; histFor().stack.push(st); histFor().i = 0; }
    scroller.scrollTop = 0;
    if (reading) layoutGutter();
    if (!fb.hidden) { find.ranges = collectRanges(); paintFind(); }
  }
  function placeCaretAtEnd() {
    const last = editor.lastElementChild;
    if (!last) return;
    const r = document.createRange();
    r.selectNodeContents(last);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  /* ============================ loading / saving ============================ */
  function loadDoc(d, path, opts) {
    opts = opts || {};
    doc = d;
    cur = 0;
    filePath = path || null;
    histories.clear();
    wordCounts = doc.chapters.map((c) => D.countWords(c.blocks));
    renderChapter();
    dirty = !!opts.dirty;
    if (!reading) { editor.focus(); placeCaretAtEnd(); kick(true); }
    renderOutline();
    $('#docTitle').value = doc.title || '';
    updateFileHint();
    updateTitle();
    updateStatus();
    setSaveState(dirty ? 'Not saved yet' : path ? 'Saved' : '');
    setGoalBase();
  }
  function parseByExtension(path, text) {
    if (/\.draft$/i.test(path)) return { doc: D.parseDraft(text), path };
    return { doc: D.fromMarkdown(text, stem(path)), path: null, imported: true };
  }
  async function openResult(r) {
    if (!r) return;
    if (r.error) { await window.api.error(r.error); return; }
    try {
      const p = parseByExtension(r.path, r.text);
      loadDoc(p.doc, p.path, { dirty: !!p.imported });
      if (p.imported) toast('Imported. Save to keep it as a .draft file.');
    } catch (e) {
      await window.api.error(e.message);
    }
  }
  function updateTitle() {
    window.api.setTitle((filePath ? baseName(filePath) : docTitle()) + ' | Quire');
  }
  function setSaveState(s) { $('#saveState').textContent = s; }

  /* ============================ own file browser: renderer/filebrowser.js ============================ */
  const dirOf = (p) => { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i > 0 ? p.slice(0, i) : p; };
  const pickFile = (o) => window.QuireFiles.pick(o, { before: closePanels, after: () => { if (!reading) editor.focus(); } });

  /* ---- names: the title gives the file names ---- */
  function firstHeading() {
    for (const c of doc.chapters) for (const b of c.blocks) if (b.t === 'h1' && D.blockText(b).trim()) return D.blockText(b).trim();
    return '';
  }
  // A chapter without its own title is named after the first heading 1 inside it.
  function chapterHeading(c) {
    for (const b of c.blocks) if (b.t === 'h1' && D.blockText(b).trim()) return D.blockText(b).trim();
    return '';
  }
  const chapterName = (c) => c.title.trim() || chapterHeading(c);
  function docTitle() {
    return (doc.title || '').trim() || firstHeading() || chapterName(doc.chapters[0]) || firstWords() || 'Untitled';
  }
  const draftName = () => D.slugify(docTitle()) + '.draft';
  function updateFileHint() {
    const h = $('#fileHint');
    if (h) h.textContent = filePath ? baseName(filePath) : draftName();
  }

  // mode: 'save' (in place; asks only the first time) or 'as' (choose a new name; the copy gets its own history)
  async function save(mode) {
    snapshotDoc();
    setSaveState('Saving\u2026');
    const oldId = doc.id;
    if (mode === 'as' && filePath) doc.id = D.uid();
    let target = filePath, system = false;
    if (!filePath || mode === 'as') {
      const p = await pickFile({ mode: 'save', kind: 'doc', title: mode === 'as' ? 'Save as' : 'Save', name: filePath ? baseName(filePath).replace(/\.draft$/i, '') : D.slugify(docTitle()), exts: ['.draft'], startDir: filePath ? dirOf(filePath) : '' });
      if (p === null) { doc.id = oldId; setSaveState(dirty ? 'Not saved yet' : 'Saved'); return false; }
      if (p === 'system') system = true; else target = p;
    }
    let r = await window.api.save({ path: system ? filePath : target, saveAs: system && mode === 'as', text: D.serializeDraft(doc), suggested: D.slugify(docTitle()) });
    if (r && r.conflict) {
      const how = await resolveConflict();
      r = how === 'force' ? await window.api.save({ path: filePath, text: D.serializeDraft(doc), suggested: D.slugify(docTitle()), force: true }) : null;
    }
    if (!r) { doc.id = oldId; setSaveState(dirty ? 'Not saved yet' : 'Saved'); return false; }
    filePath = r.path;
    dirty = false;
    updateTitle();
    updateFileHint();
    setSaveState('Saved');
    toast(mode === 'as' ? 'Saved as ' + baseName(r.path) : 'Saved');
    window.api.recoveryClear();
    editor.focus();
    return true;
  }
  function firstWords() {
    const b = doc.chapters[0].blocks.find((x) => D.blockText(x).trim());
    return b ? D.blockText(b).trim().split(/\s+/).slice(0, 6).join(' ') : '';
  }

  // Autosave: to the file once it has a name, otherwise to a recovery copy.
  let autoTimer;
  function markDirty() {
    dirty = true;
    setSaveState('Unsaved changes');
    clearTimeout(autoTimer);
    autoTimer = setTimeout(autosave, filePath ? 2500 : 1500);
  }
  // The file changed on disk while it was open here (git, OneDrive, Dropbox...). Nothing is overwritten until you choose.
  let conflictOpen = false, conflictPaused = false;
  async function resolveConflict() {
    if (conflictOpen) return false;
    conflictOpen = true;
    try {
      setSaveState('Changed outside Quire');
      const c = await window.api.confirm({
        message: '\u201c' + baseName(filePath) + '\u201d was changed outside Quire.',
        detail: 'Another program (git, OneDrive, Dropbox) wrote to this file. Whichever version you do not keep goes into History first, so nothing is lost.',
        buttons: ['Keep mine', 'Load theirs', 'Save mine as a copy', 'Decide later'],
      });
      if (c === 0) { await window.api.snapshotDoc({ path: filePath }); conflictPaused = false; return 'force'; }
      if (c === 1) {
        await window.api.snapshotDoc({ text: D.serializeDraft(snapshotDoc()) });
        conflictPaused = false;
        const r = await window.api.openPath(filePath);
        dirty = false; await openResult(r);
        toast('Loaded the version from disk. Yours is in History.');
        return false;
      }
      if (c === 2) { conflictPaused = false; await save('as'); return false; }
      conflictPaused = true; window.api.recoverySave(D.serializeDraft(snapshotDoc()));
      setSaveState('Not saved: file changed on disk');
      return false;
    } finally { conflictOpen = false; }
  }
  window.addEventListener('focus', async () => {
    if (!filePath || conflictOpen || !doc) return;
    if (!(await window.api.docChanged(filePath))) return;
    if (!dirty) { const r = await window.api.openPath(filePath); await openResult(r); toast('Reloaded: the file was changed outside Quire.'); }
    else { conflictPaused = false; const how = await resolveConflict(); if (how === 'force') await autosave(); }
  });
  async function autosave() {
    if (!doc) return;
    snapshotDoc();
    const text = D.serializeDraft(doc);
    if (!filePath) { updateTitle(); updateFileHint(); }
    if (filePath) {
      if (conflictPaused) { window.api.recoverySave(text); return; }
      let r = await window.api.autosave({ path: filePath, text });
      if (r && r.conflict) {
        const how = await resolveConflict();
        if (how !== 'force') return;
        r = await window.api.autosave({ path: filePath, text, force: true });
      }
      if (r && r.ok) { dirty = false; setSaveState('Saved'); } else setSaveState('Could not save');
    } else {
      window.api.recoverySave(text);
      setSaveState(D.countDoc(doc) ? 'Draft kept safe' : '');
    }
  }
  async function confirmDiscard() {
    if (filePath || !doc || !D.countDoc(snapshotDoc())) return true;
    const c = await window.api.confirm({
      message: 'This document has not been saved to a file yet.',
      detail: 'A recovery copy is kept, but starting something else will replace it.',
      buttons: ['Save…', 'Discard', 'Cancel'],
    });
    if (c === 0) return save('save');
    return c === 1;
  }
  async function doNew() {
    if (!(await confirmDiscard())) return;
    if (filePath) await autosave();
    window.api.recoveryClear();
    loadDoc(D.newDoc(), null);
  }
  async function doOpen() {
    if (!(await confirmDiscard())) return;
    if (filePath && dirty) await autosave();
    const p = await pickFile({ mode: 'open', kind: 'doc', title: 'Open', exts: ['.draft', '.md', '.markdown', '.txt'], startDir: filePath ? dirOf(filePath) : '' });
    if (p === null) return;
    await openResult(p === 'system' ? await window.api.openDialog() : await window.api.openPath(p));
  }

  /* ============================ word count + goal ============================ */
  function setGoalBase() {
    try {
      const key = filePath || 'untitled';
      let g = JSON.parse(localStorage.getItem('goal') || '{}');
      if (g.date !== todayKey()) g = { date: todayKey(), base: {} };
      if (g.base[key] === undefined) g.base[key] = totalWords();
      localStorage.setItem('goal', JSON.stringify(g));
    } catch (e) { /* ignore */ }
  }
  function totalWords() { return wordCounts.reduce((a, b) => a + (b || 0), 0); }
  function wordsToday() {
    try {
      const g = JSON.parse(localStorage.getItem('goal') || '{}');
      const base = g.date === todayKey() && g.base ? g.base[filePath || 'untitled'] : undefined;
      return Math.max(0, totalWords() - (base === undefined ? totalWords() : base));
    } catch (e) { return 0; }
  }
  let countTimer;
  function scheduleCount() {
    clearTimeout(countTimer);
    countTimer = setTimeout(() => {
      const t = editor.innerText.trim();
      wordCounts[cur] = t ? t.split(/\s+/).length : 0;
      updateStatus();
    }, 250);
  }
  function updateStatus() {
    if (!doc) return;
    const ch = doc.chapters[cur];
    const multi = doc.chapters.length > 1;
    const parts = [];
    if (multi) parts.push(chapterName(ch) || 'Chapter ' + (cur + 1));
    const w = wordCounts[cur] || 0;
    parts.push(w.toLocaleString() + (w === 1 ? ' word' : ' words'));
    if (multi) parts.push(totalWords().toLocaleString() + ' in total');
    if (prefs.goal > 0) parts.push(wordsToday().toLocaleString() + ' / ' + prefs.goal.toLocaleString() + ' today');
    $('#statusLeft').textContent = parts.join(' · ');
    updateBookTotal();
  }

  /* ============================ typewriter engine ============================ */
  let follow = false;
  let raf = 0;
  function caretRect() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return null;
    let rects = range.getClientRects();
    if (rects.length) return rects[rects.length - 1];
    let el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    el = el && el.closest('p,h1,h2,blockquote,div');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, height: Math.min(r.height, parseFloat(getComputedStyle(el).lineHeight) || r.height), left: r.left };
  }
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let typedKick = false; // the last movement came from typing (not from arrow keys or the mouse)
  function kick(wantScroll, typed) {
    if (wantScroll) follow = true;
    if (typed) typedKick = true;
    if (!raf) raf = requestAnimationFrame(tick);
  }
  // Typewriter line: the paragraph you are writing keeps its normal line breaks, but the one line you are on is
  // drawn on a separate layer that slides sideways so the caret stays in the middle of the screen. The real text
  // is never touched (undo, saving and spellcheck behave as usual); that line is just hidden underneath.
  const layer = document.createElement('div');
  layer.id = 'lineLayer';
  layer.setAttribute('aria-hidden', 'true'); // it repeats the text of the line being written
  page.appendChild(layer);
  let recentering = false;
  let lineKey = null, lineHtml = '', wrapEl = null, textEl = null, caretEl = null, ghostTimer = 0;

  function resetMask(el) { ['--bt', '--bb', '--gt', '--gb'].forEach((p) => el.style.removeProperty(p)); }
  function setLive(el) {
    if (liveEl && !editor.contains(liveEl)) liveEl = null;
    if (el === liveEl) return;
    if (liveEl) { liveEl.classList.remove('live'); resetMask(liveEl); }
    $$('.live', editor).forEach((x) => { if (x !== el) { x.classList.remove('live'); resetMask(x); } }); // copies made by Enter / formatBlock
    liveEl = el;
    shiftX = 0; recentering = false; lineKey = null; lineHtml = ''; wrapEl = textEl = caretEl = null;
    clearTimeout(ghostTimer);
    layer.innerHTML = '';
    if (el) el.classList.add('live');
  }
  // The line that was just completed glides back to its place while the new line starts at the center.
  function spawnGhost(oldTop, lh, fromX) {
    const g = wrapEl.cloneNode(true);
    const c = g.querySelector('.lineCaret');
    if (c) c.remove();
    g.classList.add('ghost');
    g.querySelector('.lineText').style.setProperty('--bt', oldTop + 'px');
    g.querySelector('.lineText').style.setProperty('--bb', (oldTop + lh) + 'px');
    g.style.transition = 'none';
    g.style.transform = motionQuery.matches ? 'translateX(0)' : 'translateX(' + Math.round(fromX) + 'px)';
    layer.insertBefore(g, wrapEl);
    liveEl.style.setProperty('--gt', oldTop + 'px');
    liveEl.style.setProperty('--gb', (oldTop + lh) + 'px');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      g.style.transition = 'transform .24s cubic-bezier(.2,.7,.2,1)';
      g.style.transform = 'translateX(0)';
    }));
    const el = liveEl;
    clearTimeout(ghostTimer);
    ghostTimer = setTimeout(() => {
      g.remove();
      if (liveEl === el) { el.style.setProperty('--gt', '0px'); el.style.setProperty('--gb', '0px'); }
    }, 280);
  }
  function paintLine(r, lr, lh, top) {
    if (!wrapEl) {
      wrapEl = document.createElement('div'); wrapEl.className = 'lineWrap';
      textEl = document.createElement('div'); textEl.className = 'lineText';
      caretEl = document.createElement('i'); caretEl.className = 'lineCaret';
      wrapEl.append(textEl, caretEl);
      layer.appendChild(wrapEl);
    }
    const pr = page.getBoundingClientRect();
    wrapEl.style.left = (lr.left - pr.left) + 'px';
    wrapEl.style.top = (lr.top - pr.top) + 'px';
    wrapEl.style.width = lr.width + 'px';
    const html = liveEl.tagName + liveEl.className.replace('live', '') + liveEl.innerHTML;
    if (html !== lineHtml) {
      lineHtml = html;
      const c = liveEl.cloneNode(true);
      c.classList.remove('live'); c.removeAttribute('style');
      textEl.replaceChildren(c);
      caretEl.style.animation = 'none'; void caretEl.offsetWidth; caretEl.style.animation = '';
    }
    textEl.style.setProperty('--bt', top + 'px');
    textEl.style.setProperty('--bb', (top + lh) + 'px');
    liveEl.style.setProperty('--bt', top + 'px');
    liveEl.style.setProperty('--bb', (top + lh) + 'px');
    caretEl.style.left = (r.left - lr.left) + 'px';
    caretEl.style.top = (r.top - lr.top) + 'px';
    caretEl.style.height = r.height + 'px';
    wrapEl.style.transform = shiftX ? 'translateX(' + Math.round(shiftX) + 'px)' : '';
  }
  // Centering is for writing new text: the caret has to be at the end of its paragraph (not in the middle of older text).
  function atWritingEnd() {
    const sel = getSelection();
    const b = currentBlock();
    if (!sel.rangeCount || !sel.isCollapsed || !b) return false;
    const rg = document.createRange();
    rg.setStart(sel.anchorNode, sel.anchorOffset);
    rg.setEnd(b, b.childNodes.length);
    return rg.toString().replace(/[\u200b\ufeff]/g, '') === '';
  }
  function tick() {
    raf = 0;
    const focused = !reading && document.activeElement === editor;
    const canFollow = follow && focused;
    const mode = review ? 'off' : prefs.centerMode || 'soft';
    // Only new text slides: the caret must be at the end of its paragraph and you must be typing, not just moving around.
    if (!focused || mode === 'off' || !atWritingEnd()) setLive(null);
    else if (canFollow && typedKick) setLive(currentBlock());
    let r = caretRect();
    if (!r) return;
    const mid = r.top + r.height / 2;
    glow.style.setProperty('--ly', mid + 'px');
    let more = false;

    if (canFollow && prefs.typewriter && !review) {
      const anchorY = innerHeight * prefs.anchor / 100;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const target = Math.max(0, Math.min(max, scroller.scrollTop + mid - anchorY));
      const d = target - scroller.scrollTop;
      if (Math.abs(d) < 1) scroller.scrollTop = target;
      else if (motionQuery.matches) scroller.scrollTop = target; // reduced motion: no gliding
      else { scroller.scrollTop += Math.sign(d) * Math.max(1, Math.round(Math.abs(d) * 0.24)); more = true; } // at least a pixel, or it never arrives
    }

    if (liveEl) {
      r = caretRect() || r; // measured again after the vertical step
      const lr = liveEl.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(liveEl).lineHeight) || r.height;
      const top = Math.round(r.top + r.height / 2 - lh / 2 - lr.top);
      if (lineKey !== null && top !== lineKey && !canFollow) setLive(null); // caret moved to another line by mouse
      else {
        const mid2 = innerWidth / 2;
        let target = mid2 - r.left;
        if (mode === 'soft' && lineKey !== null && top === lineKey) {
          // soft: the caret may wander a little around the middle; the line only slides when it strays further
          // once it has strayed, it glides all the way back to the middle, then rests again
          const zone = Math.min(110, innerWidth * 0.09), off = Math.abs(r.left + shiftX - mid2);
          if (!recentering && off > zone) recentering = true;
          if (recentering && off < 2) recentering = false;
          if (!recentering) target = shiftX;
        }
        const oldTop = lineKey, oldShift = shiftX, changed = lineKey !== null && top !== lineKey;
        if (changed || mode === 'strict') shiftX = target; // a new line starts at the middle, like a carriage return; strict keeps the caret exactly there
        else {
          const dx = target - shiftX;
          if (Math.abs(dx) < 0.6 || motionQuery.matches) shiftX = target; else { shiftX += dx * 0.3; more = true; }
        }
        lineKey = top;
        paintLine(r, lr, lh, top);
        if (changed) spawnGhost(oldTop, lh, oldShift);
      }
    }

    if (more) raf = requestAnimationFrame(tick);
    else if (canFollow) { follow = false; typedKick = false; }
  }
  scroller.addEventListener('scroll', () => { if (scroller.scrollLeft) scroller.scrollLeft = 0; });
  let scrollRaf = 0;
  scroller.addEventListener('scroll', () => {
    if (!readingBook() || scrollRaf || Math.abs(scroller.scrollTop - bookScrollRef) < 3) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const top = scroller.getBoundingClientRect().top + 120;
      let at = cur;
      for (const s of editor.querySelectorAll('.chapsep')) { if (s.getBoundingClientRect().top <= top) at = +s.dataset.ch; else break; }
      if (at !== cur) { cur = at; updateStatus(); if (!$('#outline').hidden) renderOutline(); }
    });
  });

  /* ============================ undo / redo ============================ */
  // Own history, one per chapter, so switching chapters never loses it. A state is the chapter's content plus the caret.
  const histories = new Map(); // chapter id -> { stack: [{ j, caret }], i }
  let histTimer = 0;
  const HIST_MAX = 200, HIST_CHARS = 30e6;
  function histFor() {
    const id = doc.chapters[cur].id;
    let h = histories.get(id);
    if (!h) { h = { stack: [], i: -1 }; histories.set(id, h); }
    return h;
  }
  function caretPos() {
    const sel = getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return null;
    const at = (node, off) => {
      let b = node.nodeType === 1 ? node : node.parentElement;
      while (b && b.parentElement !== editor) b = b.parentElement;
      if (!b) return null;
      const r = document.createRange();
      r.setStart(b, 0); r.setEnd(node, off);
      return { b: Array.prototype.indexOf.call(editor.children, b), o: r.toString().length };
    };
    const a = at(sel.anchorNode, sel.anchorOffset), f = at(sel.focusNode, sel.focusOffset);
    return a && f ? { a, f } : null;
  }
  function placeCaretPos(pos) {
    if (!pos) return placeCaretAtEnd();
    const point = (p) => {
      const blk = editor.children[Math.min(p.b, editor.children.length - 1)];
      if (!blk) return null;
      let left = p.o;
      const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
      let last = null;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        last = n;
        if (left <= n.nodeValue.length) return [n, left];
        left -= n.nodeValue.length;
      }
      return last ? [last, last.nodeValue.length] : [blk, 0];
    };
    const a = point(pos.a), f = point(pos.f);
    if (!a || !f) return placeCaretAtEnd();
    const sel = getSelection();
    sel.setBaseAndExtent(a[0], a[1], f[0], f[1]);
  }
  function snapState() { return { j: JSON.stringify(domToBlocks(editor)), caret: caretPos() }; }
  function commitHistory() {
    clearTimeout(histTimer); histTimer = 0;
    if (reading || !doc) return;
    const h = histFor();
    const st = snapState();
    const top = h.stack[h.i];
    if (top && top.j === st.j) { top.caret = st.caret || top.caret; return; }
    h.stack.length = h.i + 1;
    h.stack.push(st); h.i++;
    let chars = h.stack.reduce((n, x) => n + x.j.length, 0);
    while (h.stack.length > 1 && (h.stack.length > HIST_MAX || chars > HIST_CHARS)) { chars -= h.stack[0].j.length; h.stack.shift(); h.i--; }
  }
  function scheduleHistory() { clearTimeout(histTimer); histTimer = setTimeout(commitHistory, 700); }
  function undoRedo(dir) {
    if (reading || !doc) return;
    commitHistory();
    const h = histFor();
    const ni = h.i + dir;
    if (ni < 0 || ni >= h.stack.length) { toast(dir < 0 ? 'Nothing to undo' : 'Nothing to redo'); return; }
    h.i = ni;
    const st = h.stack[ni];
    setLive(null);
    const blocks = JSON.parse(st.j);
    blocks.forEach((b) => b.runs.forEach((r) => { if (r.n && !doc.notes[r.n]) delete r.n; })); // a deleted note stays deleted
    editor.innerHTML = blocksToHtml(blocks);
    placeCaretPos(st.caret);
    markDirty(); scheduleCount(); updateActive(); kick(true); layoutMarks();
  }

  /* ============================ formatting ============================ */
  function currentBlock() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    let n = sel.anchorNode;
    n = n && (n.nodeType === 1 ? n : n.parentElement);
    while (n && n !== editor && !/^(P|H1|H2|H3|BLOCKQUOTE|DIV)$/.test(n.tagName)) n = n.parentElement;
    return n && n !== editor ? n : null;
  }
  function inQuote() {
    let n = getSelection().anchorNode;
    n = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(n && n.closest && n.closest('blockquote'));
  }
  // formatBlock copies attributes (class, style) from the old block to the new one; keep blocks clean.
  function cleanBlocks() {
    editor.querySelectorAll('p,h1,h2,blockquote').forEach((el) => {
      if (el.classList.contains('live')) return;
      if (el.hasAttribute('style') && !el.style.cssText.trim()) el.removeAttribute('style');
      if (el.hasAttribute('class') && !el.className.trim()) el.removeAttribute('class');
      if (el.tagName !== 'BLOCKQUOTE' && el.classList.contains('cite')) el.classList.remove('cite');
    });
  }
  function setBlock(kind) {
    if (reading) return;
    editor.focus();
    commitHistory();
    const tag = kind === 'h1' ? 'H1' : kind === 'h2' ? 'H2' : 'BLOCKQUOTE';
    const b = currentBlock();
    const isThis = kind === 'quote' ? inQuote() : b && b.tagName === tag;
    if (isThis) {
      document.execCommand('formatBlock', false, 'p');
      if (kind === 'quote' && inQuote()) document.execCommand('outdent');
    } else {
      if (inQuote()) { document.execCommand('formatBlock', false, 'p'); if (inQuote()) document.execCommand('outdent'); }
      document.execCommand('formatBlock', false, tag);
    }
    cleanBlocks();
    afterEdit();
  }
  function command(cmd) {
    if (cmd === 'note') return addNote();
    if (reading) return;
    editor.focus();
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') { document.execCommand(cmd); afterEdit(); }
    else setBlock(cmd);
  }
  function afterEdit() { commitHistory(); markDirty(); scheduleCount(); updateActive(); kick(true); layoutMarks(); }
  function updateActive() {
    const set = (cmd, on) => { const b = $('[data-cmd="' + cmd + '"]'); if (b) b.classList.toggle('on', !!on); };
    if (reading || document.activeElement !== editor) return;
    set('bold', document.queryCommandState('bold'));
    set('italic', document.queryCommandState('italic'));
    set('underline', document.queryCommandState('underline'));
    const b = currentBlock();
    set('h1', b && b.tagName === 'H1');
    set('h2', b && b.tagName === 'H2');
    set('quote', inQuote());
    const n = noteAtCaret();
    set('note', !!n);
    $$('.note.active').forEach((x) => x.classList.remove('active'));
  }

  /* ============================ notes ============================ */
  function noteAtCaret() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    let n = sel.anchorNode;
    n = n && (n.nodeType === 1 ? n : n.parentElement);
    return n && n.closest ? n.closest('.note') : null;
  }
  function wrapSelectionAsNote(id) {
    const sel = getSelection();
    const range = sel.getRangeAt(0);
    const root = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (range.intersectsNode(n) && n.nodeValue.length) nodes.push(n);
    if (root.nodeType === 3) nodes.push(root);
    if (nodes.some((n) => n.parentElement.closest('.note'))) return false;
    for (const t of nodes) {
      let start = 0, end = t.nodeValue.length;
      if (t === range.startContainer) start = range.startOffset;
      if (t === range.endContainer) end = range.endOffset;
      if (start >= end) continue;
      let target = t;
      if (end < t.nodeValue.length) t.splitText(end);
      if (start > 0) target = t.splitText(start);
      const span = document.createElement('span');
      span.className = 'note';
      span.dataset.note = id;
      target.parentNode.insertBefore(span, target);
      span.appendChild(target);
    }
    sel.removeAllRanges();
    return true;
  }
  function addNote() {
    if (reading) { toast('Switch to writing mode to add notes'); return; }
    const existing = noteAtCaret();
    if (existing) { openNotePop(existing.dataset.note, existing); return; }
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !editor.contains(sel.anchorNode)) { toast('Select some text first, then press Ctrl+Alt+M'); return; }
    const id = D.uid();
    if (!wrapSelectionAsNote(id)) { toast('That passage already has a note'); return; }
    doc.notes[id] = { text: '', created: D.now() };
    const span = editor.querySelector('.note[data-note="' + id + '"]');
    openNotePop(id, span, true);
    markDirty();
  }
  function openNotePop(id, anchorEl, isNew) {
    activeNote = { id, isNew: !!isNew };
    const pop = $('#notePop');
    $('#noteText').value = (doc.notes[id] && doc.notes[id].text) || '';
    $('#noteDelete').hidden = !!isNew;
    pop.hidden = false;
    const r = anchorEl ? anchorEl.getBoundingClientRect() : { left: innerWidth / 2 - 150, top: innerHeight / 2, bottom: innerHeight / 2 };
    pop.style.right = 'auto';
    const fromMark = anchorEl && anchorEl.classList && anchorEl.classList.contains('nmark');
    pop.style.left = Math.max(12, Math.min(innerWidth - 320, fromMark ? r.left - 312 : r.left)) + 'px';
    const below = r.bottom + 10;
    pop.style.top = (below + 190 > innerHeight ? Math.max(12, r.top - 200) : below) + 'px';
    $$('.note[data-note="' + id + '"]').forEach((x) => x.classList.add('active'));
    setTimeout(() => $('#noteText').focus(), 0);
    hideTip();
    layoutMarks();
  }
  function unwrapNote(id) {
    $$('.note[data-note="' + id + '"]', editor).forEach((span) => {
      while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
      span.remove();
    });
    editor.normalize();
  }
  function closeNotePop(save) {
    if (!activeNote) return;
    const { id, isNew } = activeNote;
    const text = $('#noteText').value.trim();
    if (save && text) {
      doc.notes[id] = { text, created: (doc.notes[id] && doc.notes[id].created) || D.now() };
      $$('.note[data-note="' + id + '"]', editor).forEach((s) => (s.title = text));
    } else if (isNew || (save && !text)) {
      unwrapNote(id);
      delete doc.notes[id];
    }
    $$('.note.active').forEach((x) => x.classList.remove('active'));
    activeNote = null;
    $('#notePop').hidden = true;
    markDirty();
    if (reading) layoutGutter();
    else editor.focus();
    layoutMarks();
  }
  function deleteNote() {
    if (!activeNote) return;
    unwrapNote(activeNote.id);
    delete doc.notes[activeNote.id];
    activeNote = null;
    $('#notePop').hidden = true;
    markDirty();
    if (reading) layoutGutter(); else editor.focus();
  }
  // Margin marks: a small note icon at the right of the column, level with the first line of each annotated passage.
  const NOTE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2.5h10v8.5l-3 3H3z"/><path d="M10 14v-3h3"/><path d="M5.5 6h5M5.5 8.5h3"/></svg>';
  const marks = document.createElement('div');
  marks.id = 'noteMarks';
  page.appendChild(marks);
  const tip = document.createElement('div');
  tip.id = 'noteTip';
  tip.hidden = true;
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let marksRaf = 0;
  function layoutMarks() {
    if (marksRaf) return;
    marksRaf = requestAnimationFrame(() => { marksRaf = 0; drawMarks(); });
  }
  function drawMarks() {
    marks.innerHTML = '';
    if (reading || !doc) return;
    const pr = page.getBoundingClientRect();
    const seen = new Set();
    let floor = -1e9;
    for (const span of $$('.note', editor)) {
      const id = span.dataset.note;
      if (seen.has(id)) continue;
      seen.add(id);
      const rects = span.getClientRects();
      if (!rects.length) continue;
      const top = Math.max(rects[0].top - pr.top + rects[0].height / 2 - 11, floor);
      floor = top + 26;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'nmark'; b.dataset.note = id;
      b.setAttribute('aria-label', 'Note: ' + ((doc.notes[id] && doc.notes[id].text) || 'empty').slice(0, 60));
      b.innerHTML = NOTE_ICON;
      b.style.top = (top + 3) + 'px';
      b.style.left = Math.min(pr.width + 14, innerWidth - pr.left - 30) + 'px';
      if (activeNote && activeNote.id === id) b.classList.add('open');
      marks.appendChild(b);
    }
  }
  function showTip(id, el, side) {
    const n = doc.notes[id];
    if (!n || !n.text || (activeNote && activeNote.id === id)) return hideTip();
    tip.textContent = n.text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = side === 'left' ? r.left - w - 10 : r.left;
    let top = side === 'left' ? r.top - 4 : r.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 8);
    tip.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip() { tip.hidden = true; }
  marks.addEventListener('mousedown', (e) => e.preventDefault());
  marks.addEventListener('click', (e) => {
    const b = e.target.closest('.nmark');
    if (!b) return;
    const id = b.dataset.note;
    hideTip();
    if (activeNote && activeNote.id === id) closeNotePop(true);
    else { if (activeNote) closeNotePop(true); openNotePop(id, b.isConnected ? b : null); }
    drawMarks();
  });
  marks.addEventListener('mouseover', (e) => { const b = e.target.closest('.nmark'); if (b) showTip(b.dataset.note, b, 'left'); });
  marks.addEventListener('mouseout', hideTip);
  editor.addEventListener('mouseover', (e) => { const n = e.target.closest && e.target.closest('.note'); if (n) showTip(n.dataset.note, n); });
  editor.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('.note')) hideTip(); });

  function layoutGutter() {
    const g = $('#gutter');
    g.innerHTML = '';
    if (!reading) return;
    const seen = new Set();
    const pageTop = page.getBoundingClientRect().top;
    let floor = 0;
    for (const span of $$('.note', editor)) {
      const id = span.dataset.note;
      if (seen.has(id) || !doc.notes[id]) continue;
      seen.add(id);
      const card = document.createElement('div');
      card.className = 'gcard';
      card.textContent = doc.notes[id].text;
      g.appendChild(card);
      const top = Math.max(span.getBoundingClientRect().top - pageTop - 6, floor);
      card.style.top = top + 'px';
      floor = top + card.offsetHeight + 8;
      card.addEventListener('click', () => openNotePop(id, card));
      card.addEventListener('mouseenter', () => $$('.note[data-note="' + id + '"]').forEach((x) => x.classList.add('active')));
      card.addEventListener('mouseleave', () => $$('.note.active').forEach((x) => x.classList.remove('active')));
    }
  }

  /* ============================ find and replace ============================ */
  const fb = $('#findbar'), fIn = $('#findInput'), rIn = $('#replaceInput');
  const find = { ranges: [], idx: -1, matchCase: false, all: false, anchor: null };
  const hasHL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  const escRe = (q) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const findRegex = () => (fIn.value ? new RegExp(escRe(fIn.value), 'g' + (find.matchCase ? '' : 'i')) : null);
  function collectRanges() {
    const re = findRegex();
    const out = [];
    if (!re) return out;
    for (const blk of editor.children) {
      const nodes = [];
      let text = '';
      const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { nodes.push({ n, start: text.length }); text += n.nodeValue; }
      if (!nodes.length) continue;
      const pos = (off, isEnd) => {
        for (const nd of nodes) {
          const end = nd.start + nd.n.nodeValue.length;
          if (off < end || (isEnd && off <= end)) return [nd.n, off - nd.start];
        }
        const l = nodes[nodes.length - 1];
        return [l.n, l.n.nodeValue.length];
      };
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (!m[0].length) { re.lastIndex++; continue; }
        const a = pos(m.index, false), b = pos(m.index + m[0].length, true);
        const r = document.createRange();
        r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]);
        out.push(r);
      }
    }
    return out;
  }
  function otherChapterCounts() {
    const re = findRegex();
    const counts = doc.chapters.map(() => 0);
    if (!re) return counts;
    doc.chapters.forEach((c, i) => {
      if (i === cur) return;
      for (const b of c.blocks) { const m = D.blockText(b).match(re); if (m) counts[i] += m.length; }
    });
    return counts;
  }
  function paintFind() {
    if (!hasHL) return;
    CSS.highlights.delete('find'); CSS.highlights.delete('find-current');
    if (fb.hidden) return;
    if (find.ranges.length) CSS.highlights.set('find', new Highlight(...find.ranges));
    const c = find.ranges[find.idx];
    if (c) CSS.highlights.set('find-current', new Highlight(c));
  }
  function updateFindCount() {
    const el = $('#findCount');
    if (!fIn.value) { el.textContent = ''; return; }
    let t = find.ranges.length ? (find.idx + 1) + ' of ' + find.ranges.length : 'No matches';
    if (find.all) { const o = otherChapterCounts().reduce((a, b) => a + b, 0); if (o) t += ' +' + o; }
    el.textContent = t;
  }
  function goToMatch(i) {
    find.idx = i;
    const r = find.ranges[i];
    if (r) {
      const rect = r.getBoundingClientRect();
      scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + rect.top - innerHeight * 0.4), behavior: 'smooth' });
    }
    paintFind(); updateFindCount();
  }
  function refreshFind(keepIdx) {
    find.ranges = collectRanges();
    if (!find.ranges.length) find.idx = -1;
    else if (!keepIdx || find.idx < 0 || find.idx >= find.ranges.length) {
      let first = 0;
      if (find.anchor) { const k = find.ranges.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, find.anchor) >= 0); first = k < 0 ? 0 : k; }
      find.idx = first;
    }
    paintFind(); updateFindCount();
    if (find.idx >= 0 && !keepIdx) goToMatch(find.idx);
  }
  function stepFind(dir) {
    if (!fIn.value) return;
    const n = find.ranges.length;
    const next = find.idx + dir;
    if (n && next >= 0 && next < n) return goToMatch(next);
    if (find.all) {
      const counts = otherChapterCounts();
      for (let k = 1; k < doc.chapters.length; k++) {
        const j = ((cur + dir * k) % doc.chapters.length + doc.chapters.length) % doc.chapters.length;
        if (counts[j]) {
          selectChapter(j);
          find.anchor = null;
          refreshFind(false);
          fIn.focus();
          return goToMatch(dir > 0 ? 0 : find.ranges.length - 1);
        }
      }
    }
    if (n) goToMatch(dir > 0 ? 0 : n - 1); // wrap around
  }
  function replaceRange(r, text) {
    editor.focus();
    const s = getSelection();
    s.removeAllRanges(); s.addRange(r);
    if (text) document.execCommand('insertText', false, text); else document.execCommand('delete');
  }
  function replaceOne() {
    if (reading) return;
    const r = find.ranges[find.idx];
    if (!r) return;
    commitHistory();
    replaceRange(r, rIn.value);
    afterEdit();
    const keep = find.idx;
    refreshFind(true);
    find.idx = Math.min(keep, find.ranges.length - 1);
    fIn.focus();
    if (find.idx >= 0) goToMatch(find.idx);
  }
  function replaceAll() {
    if (reading || !fIn.value) return;
    let total = 0;
    const doChapter = () => {
      const rs = collectRanges();
      if (!rs.length) return;
      commitHistory();
      for (let i = rs.length - 1; i >= 0; i--) replaceRange(rs[i], rIn.value);
      afterEdit();
      total += rs.length;
    };
    doChapter();
    if (find.all) {
      const origin = cur;
      for (let j = 0; j < doc.chapters.length; j++) {
        if (j === origin) continue;
        selectChapter(j);
        doChapter();
      }
      selectChapter(origin);
    }
    refreshFind(false);
    fIn.focus();
    toast(total ? 'Replaced ' + total + (total === 1 ? ' match' : ' matches') : 'No matches to replace');
  }
  function openFind(focusReplace) {
    closePanels();
    const sel = getSelection();
    if (sel.rangeCount && editor.contains(sel.anchorNode)) {
      find.anchor = sel.getRangeAt(0).cloneRange();
      const t = sel.toString();
      if (t && t.length < 80 && !/\n/.test(t)) fIn.value = t;
    }
    fb.classList.toggle('readonly', reading);
    fb.hidden = false;
    showChrome();
    (focusReplace && !reading ? rIn : fIn).focus();
    (focusReplace && !reading ? rIn : fIn).select();
    refreshFind(false);
  }
  function closeFind() {
    fb.hidden = true;
    paintFind();
    if (!reading) editor.focus();
  }
  let findTimer = 0;
  function refreshFindSoon() { if (fb.hidden) return; clearTimeout(findTimer); findTimer = setTimeout(() => refreshFind(true), 250); }
  fIn.addEventListener('input', () => { find.anchor = null; refreshFind(false); });
  fIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); } });
  rIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } });
  $('#findNext').addEventListener('click', () => stepFind(1));
  $('#findPrev').addEventListener('click', () => stepFind(-1));
  $('#findClose').addEventListener('click', closeFind);
  $('#replaceOne').addEventListener('click', replaceOne);
  $('#replaceAll').addEventListener('click', replaceAll);
  $('#findCase').addEventListener('click', () => { find.matchCase = !find.matchCase; $('#findCase').setAttribute('aria-pressed', String(find.matchCase)); refreshFind(false); });
  $('#findAllChapters').addEventListener('change', (e) => { find.all = e.target.checked; updateFindCount(); });

  /* ============================ reading mode ============================ */
  function updateModeUI() {
    const m = reading ? 'read' : review ? 'review' : 'write';
    $('#btnMode').title = 'Mode: ' + { write: 'Writing', review: 'Review', read: 'Read' }[m];
    $('#btnMode').classList.toggle('on', m !== 'write');
    $$('#modeMenu [data-mode]').forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  }
  function setMode(m) {
    if (m === 'write') { setReading(false); setReview(false); }
    else if (m === 'review') { setReading(false); setReview(true); }
    else setReading(true);
    $('#modeWrap').classList.remove('open'); $('#btnMode').setAttribute('aria-expanded', 'false');
    const f = document.activeElement; if (f && f.closest && f.closest('#modeMenu')) f.blur();
  }
  function setReview(on) {
    if (on === review) return;
    if (on && reading) setReading(false);
    review = on;
    document.body.classList.toggle('review', on);
    updateModeUI();
    setLive(null);
    toast(on ? 'Review mode: typos and notes stand out, nothing slides' : 'Back to writing mode');
    if (!reading) editor.focus();
    layoutMarks(); kick(false);
  }
  function setReading(on) {
    if (on === reading) return;
    if (on && review) setReview(false);
    if (on) syncFromDom();
    reading = on;
    document.body.classList.toggle('reading', on);
    editor.contentEditable = on ? 'false' : 'true';
    $('#readbar').hidden = !on;
    updateModeUI();
    closePanels();
    layoutMarks();
    if (on) {
      if (prefs.readScope === 'book') renderChapter();
      else { scroller.scrollTop = 0; layoutGutter(); }
    } else {
      renderChapter();
      editor.focus();
      placeCaretAtEnd();
      kick(true);
    }
  }

  /* ============================ chapters ============================ */
  function selectChapter(i) {
    if (i < 0 || i >= doc.chapters.length || (i === cur && !readingBook())) return;
    commitHistory();
    syncFromDom();
    cur = i;
    renderChapter();
    renderOutline();
    updateStatus();
    if (!reading) { editor.focus(); placeCaretAtEnd(); kick(true); }
  }
  function renderOutline() {
    const ol = $('#chapterList');
    ol.innerHTML = '';
    doc.chapters.forEach((c, i) => {
      const li = document.createElement('li');
      if (i === cur) li.className = 'current';
      const num = document.createElement('span'); num.className = 'num'; num.textContent = i + 1;
      const inp = document.createElement('input');
      inp.value = c.title; inp.placeholder = chapterHeading(c) || 'Untitled chapter'; inp.setAttribute('aria-label', 'Chapter ' + (i + 1) + ' title');
      inp.addEventListener('focus', () => { if (i !== cur) selectChapter(i); });
      inp.addEventListener('input', () => { c.title = inp.value; markDirty(); updateStatus(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); closeOutline(); } });
      const wc = document.createElement('span'); wc.className = 'wc'; wc.textContent = (wordCounts[i] || 0).toLocaleString();
      const mk = (label, title, fn, dis) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.disabled = !!dis; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
      li.append(num, inp, wc,
        mk('Up', 'Move up', () => moveChapter(i, -1), i === 0),
        mk('Down', 'Move down', () => moveChapter(i, 1), i === doc.chapters.length - 1),
        mk('Del', 'Delete chapter', () => deleteChapter(i), doc.chapters.length < 2));
      li.addEventListener('click', (e) => { if (e.target === li || e.target === num || e.target === wc) selectChapter(i); });
      ol.appendChild(li);
    });
    updateBookTotal();
  }
  function updateBookTotal() {
    const el = $('#bookTotal');
    if (!el || !doc) return;
    const total = totalWords();
    const mins = Math.max(1, Math.round(total / 230));
    let t = total.toLocaleString() + ' words in total \u00b7 about ' + (mins >= 90 ? (mins / 60).toFixed(1) + ' h' : mins + ' min') + ' to read';
    if (prefs.bookGoal > 0) t += ' \u00b7 ' + Math.min(100, Math.round((total / prefs.bookGoal) * 100)) + '% of ' + prefs.bookGoal.toLocaleString();
    el.textContent = t;
  }
  function moveChapter(i, d) {
    syncFromDom();
    const j = i + d;
    if (j < 0 || j >= doc.chapters.length) return;
    [doc.chapters[i], doc.chapters[j]] = [doc.chapters[j], doc.chapters[i]];
    [wordCounts[i], wordCounts[j]] = [wordCounts[j], wordCounts[i]];
    if (cur === i) cur = j; else if (cur === j) cur = i;
    renderOutline(); markDirty();
  }
  async function deleteChapter(i) {
    if (doc.chapters.length < 2) return;
    const c = await window.api.confirm({ message: 'Delete “' + (chapterName(doc.chapters[i]) || 'Untitled chapter') + '”?', detail: 'Its text and notes will be removed. Earlier versions in History still contain it.', buttons: ['Delete', 'Cancel'] });
    if (c !== 0) return;
    syncFromDom();
    doc.chapters.splice(i, 1);
    wordCounts.splice(i, 1);
    if (cur >= doc.chapters.length) cur = doc.chapters.length - 1;
    else if (i < cur) cur--;
    renderChapter(); renderOutline(); updateStatus(); markDirty();
  }
  function addChapter() {
    syncFromDom();
    doc.chapters.push(D.newChapter());
    wordCounts.push(0);
    cur = doc.chapters.length - 1;
    renderChapter(); renderOutline(); updateStatus(); markDirty();
    const inputs = $$('#chapterList input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }
  function openOutline() { syncFromDom(); closePanels(); $('#outline').hidden = false; renderOutline(); }
  function closeOutline() { $('#outline').hidden = true; if (!reading) { editor.focus(); } }

  /* ============================ export / history ============================ */
  async function doExport(format) {
    $('#exportMenu').hidden = true;
    snapshotDoc();
    const ext = { docx: '.docx', pdf: '.pdf', md: '.md', txt: '.txt' }[format];
    const label = { docx: 'Word document', pdf: 'PDF', md: 'Markdown', txt: 'Plain text' }[format];
    const chosen = await pickFile({ mode: 'save', kind: 'export', title: 'Export as ' + label, name: D.slugify(docTitle()) === 'untitled' ? 'Untitled' : docTitle(), exts: [ext], ok: 'Export' });
    if (chosen === null) { if (!reading) editor.focus(); return; }
    toast('Preparing ' + format.toUpperCase() + '…');
    const r = await window.api.exportDoc({
      format, doc, suggested: docTitle(), path: chosen === 'system' ? undefined : chosen,
      opts: { notes: $('#exportNotes').checked, font: prefs.font, justify: prefs.justify !== false, author: doc.author || undefined },
    });
    if (r && r.error) await window.api.error('Export failed: ' + r.error);
    else if (r && r.path) toast('Exported to ' + baseName(r.path));
    if (!reading) editor.focus();
  }
  async function openVersions() {
    closePanels();
    const list = $('#versionList');
    list.innerHTML = '';
    if (!filePath) { list.innerHTML = '<li class="small">Save the document first. History is kept for saved documents.</li>'; }
    else {
      await autosave();
      const items = await window.api.versionsList(doc.id);
      if (!items.length) list.innerHTML = '<li class="small">No earlier versions yet. A snapshot is taken every few minutes while you write, and before a save that removes a lot of text.</li>';
      for (const it of items) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<span></span><span class="hint">Open as new document</span>';
        b.firstChild.textContent = new Date(it.time).toLocaleString();
        b.addEventListener('click', async () => {
          const text = await window.api.versionsRead(it.file);
          try {
            const d = D.parseDraft(text);
            $('#modal').hidden = true;
            window.api.recoveryClear();
            loadDoc(d, null, { dirty: true });
            toast('Opened an earlier version. Save it under a new name to keep it.');
          } catch (e) { window.api.error(e.message); }
        });
        li.appendChild(b);
        list.appendChild(li);
      }
    }
    $('#modal').hidden = false;
  }

  /* ============================ panels ============================ */
  function closePanels() {
    if (activeNote && !$('#notePop').hidden) closeNotePop(true);
    ['#exportMenu', '#settings'].forEach((s) => ($(s).hidden = true));
    $('#outline').hidden = true;
  }
  const anyPanelOpen = () => ['#exportMenu', '#settings', '#outline', '#notePop', '#modal', '#fileDlg'].some((s) => !$(s).hidden);
  function placePopover(pop, btn, align) {
    const b = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = align === 'right' ? b.right - w : b.left;
    pop.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + 'px';
    pop.style.right = 'auto';
    pop.style.top = (b.bottom + 8) + 'px';
  }
  function toggle(sel, btnSel, align) {
    if (sel === '#outline' && $(sel).hidden) { openOutline(); return; }
    const open = !$(sel).hidden;
    closePanels();
    $(sel).hidden = open;
    if (!open) {
      showChrome();
      if (btnSel && sel !== '#settings') placePopover($(sel), $(btnSel), align);
      if (sel === '#settings') { const f = $('#settings .st-nav button.on'); if (f) f.focus({ preventScroll: true }); }
      else if (sel === '#exportMenu') { const f = $(sel).querySelector('button,input,select'); if (f) f.focus({ preventScroll: true }); }
    } else if (!reading) editor.focus();
  }

  /* ============================ chrome visibility ============================ */
  let idleTimer;
  function showChrome() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (anyPanelOpen() || $('#topbar').matches(':hover')) return showChromeLater();
      document.body.classList.add('idle');
    }, 2200);
  }
  function showChromeLater() { clearTimeout(idleTimer); idleTimer = setTimeout(showChrome, 1500); }
  function hideChrome() { if (!anyPanelOpen() && !$('#topbar').contains(document.activeElement)) document.body.classList.add('idle'); }

  /* ============================ events ============================ */
  document.addEventListener('mousemove', showChrome);
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (!ctrl && !e.altKey && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) {
      hideChrome();
      document.body.classList.add('typing');
    }
    if (e.key === 'F11') { e.preventDefault(); window.api.toggleFullscreen(); return; }
    if (e.key === 'F10') { e.preventDefault(); showChrome(); $('#btnChapters').focus(); return; } // the menu bar by keyboard
    if (e.key === 'F3' && !fb.hidden) { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Escape') {
      if (activeNote && !$('#notePop').hidden) { e.preventDefault(); closeNotePop(false); return; }
      if (!fb.hidden) { e.preventDefault(); closeFind(); return; }
      if (!$('#fileDlg').hidden) return;
      if (!$('#modal').hidden) { $('#modal').hidden = true; return; }
      if (anyPanelOpen()) { e.preventDefault(); closePanels(); if (!reading) editor.focus(); }
      return;
    }
    if (ctrl && !e.altKey && !reading && document.activeElement === editor && (k === 'z' || k === 'y')) {
      e.preventDefault();
      undoRedo(k === 'y' || e.shiftKey ? 1 : -1);
      return;
    }
    if (!ctrl) return;
    if (e.altKey) {
      if (k === 'm') { e.preventDefault(); addNote(); }
      else if (k === 's') { e.preventDefault(); save('as'); }
      return;
    }
    const shift = e.shiftKey;
    switch (k) {
      case 'b': e.preventDefault(); command('bold'); break;
      case 'i': e.preventDefault(); command('italic'); break;
      case 'u': e.preventDefault(); command('underline'); break;
      case '1': e.preventDefault(); command('h1'); break;
      case '2': e.preventDefault(); command('h2'); break;
      case '0': e.preventDefault(); if (!reading) { document.execCommand('formatBlock', false, 'p'); if (inQuote()) document.execCommand('outdent'); afterEdit(); } break;
      case 'q': if (shift) { e.preventDefault(); command('quote'); } break;
      case 's': e.preventDefault(); save(shift ? 'as' : 'save'); break;
      case 'o': e.preventDefault(); if (shift) toggle('#outline'); else doOpen(); break;
      case 'n': e.preventDefault(); doNew(); break;
      case 'e': e.preventDefault(); toggle('#exportMenu', '#btnExport'); break;
      case 'r': e.preventDefault(); break; // swallowed: Ctrl+R must not reload the window
      case 'f': e.preventDefault(); openFind(false); break;
      case 'h': e.preventDefault(); openFind(true); break;
      case ',': e.preventDefault(); toggle('#settings', '#btnSettings', 'right'); break;
      case '/': e.preventDefault(); savePrefs({ fmtbar: prefs.fmtbar === false }); break;
      case 'pagedown': e.preventDefault(); selectChapter(cur + 1); break;
      case 'pageup': e.preventDefault(); selectChapter(cur - 1); break;
      default: break;
    }
  });
  document.addEventListener('keyup', () => document.body.classList.remove('typing'));

  // A quote line that starts with a dash is the author: upright, set apart.
  function refreshCite() {
    const b = currentBlock();
    if (!b) return;
    if (b.tagName === 'BLOCKQUOTE') b.classList.toggle('cite', /^\s*[-\u2013\u2014]/.test(b.textContent));
    else b.classList.remove('cite');
  }
  // Enter inside a quote starts another quote line. Enter on an empty line, or after the author line, leaves the quote.
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || reading) return;
    const b = currentBlock();
    if (!b || b.tagName !== 'BLOCKQUOTE' || !getSelection().isCollapsed) return;
    e.preventDefault();
    if (!b.textContent.trim() || b.classList.contains('cite')) {
      document.execCommand('insertParagraph');
      const nb = currentBlock();
      if (nb && nb.tagName === 'BLOCKQUOTE') document.execCommand('formatBlock', false, 'p');
    } else {
      document.execCommand('insertParagraph');
      const nb = currentBlock();
      if (nb && nb.tagName !== 'BLOCKQUOTE') document.execCommand('formatBlock', false, 'blockquote');
    }
    const nb = currentBlock();
    if (nb) nb.classList.remove('cite');
    afterEdit();
  });
  /* ---- Markdown shortcuts while typing ---- */
  // '# ' / '## ' / '> ' at the start of a line make a heading / sub-heading / quote.
  function markdownBlock() {
    const b = currentBlock();
    if (!b || b.tagName !== 'P') return false;
    const m = /^(#{1,2}|>)[ \u00a0]$/.exec(b.textContent);
    if (!m) return false;
    const rg = document.createRange();
    rg.selectNodeContents(b);
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(rg);
    document.execCommand('delete');
    setBlock(m[1] === '#' ? 'h1' : m[1] === '##' ? 'h2' : 'quote');
    return true;
  }
  // **bold**, __bold__, *italic*, _italic_: converted when the closing mark is typed.
  function markdownInline(ch) {
    const sel = getSelection();
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !sel.isCollapsed || !editor.contains(node)) return false;
    if (node.parentElement.closest('.note, code')) return false;
    const before = node.data.slice(0, sel.anchorOffset);
    let m = ch === '*' || ch === '_' ? /(\*\*|__)(?=\S)(.+?)(?<=\S)\1$/.exec(before) : null;
    let cmd = 'bold';
    if (!m) { m = /(?<![\w*_])([*_])(?=[^\s*_])([^*_]*?[^\s*_])\1$/.exec(before); cmd = 'italic'; }
    if (!m) return false;
    const start = m.index, end = before.length, inner = m[2];
    const rg = document.createRange();
    rg.setStart(node, start); rg.setEnd(node, end);
    sel.removeAllRanges(); sel.addRange(rg);
    document.execCommand('insertText', false, inner);
    const after = getSelection();
    const tn = after.anchorNode;
    const r2 = document.createRange();
    r2.setStart(tn, after.anchorOffset - inner.length); r2.setEnd(tn, after.anchorOffset);
    after.removeAllRanges(); after.addRange(r2);
    document.execCommand(cmd);
    after.collapseToEnd();
    if (document.queryCommandState(cmd)) document.execCommand(cmd); // keep typing in normal text
    return true;
  }
  editor.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); undoRedo(e.inputType === 'historyUndo' ? -1 : 1); return; }
    if (/^(insertFromPaste|insertFromDrop|deleteByCut|insertParagraph|insertLineBreak|deleteByDrag)$/.test(e.inputType)) commitHistory();
  });
  editor.addEventListener('input', (e) => {
    if (!e.isComposing && e.inputType === 'insertText' && e.data) {
      if (e.data === ' ') markdownBlock();
      else if (e.data === '*' || e.data === '_') markdownInline(e.data);
    }
    refreshCite();
    scheduleHistory();
    if (!editor.firstChild || editor.innerHTML === '<br>') { editor.innerHTML = '<p><br></p>'; placeCaretAtEnd(); }
    markDirty(); scheduleCount(); kick(true, true); layoutMarks(); refreshFindSoon();
  });
  editor.addEventListener('keyup', (e) => {
    if (/^(Arrow|Page|Home|End)/.test(e.key)) kick(true);
  });
  document.addEventListener('selectionchange', () => {
    if (liveEl && (!editor.contains(liveEl) || currentBlock() !== liveEl)) setLive(null);
    updateActive(); kick(false);
  });
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    if (reading) return;
    const text = (e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    if (lines.length > 40) {
      // big pastes in one step: a paragraph at a time is far too slow (thousands of layouts)
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      document.execCommand('insertHTML', false, lines.map((l) => '<p>' + (l ? esc(l) : '<br>') + '</p>').join(''));
      cleanBlocks();
      return;
    }
    lines.forEach((line, i) => {
      if (i) document.execCommand('insertParagraph');
      if (line) document.execCommand('insertText', false, line);
    });
  });
  editor.addEventListener('drop', (e) => e.preventDefault());
  editor.addEventListener('click', (e) => {
    const span = e.target.closest && e.target.closest('.note');
    if (span && (e.ctrlKey || reading)) openNotePop(span.dataset.note, span);
  });
  editor.addEventListener('blur', () => { if (!anyPanelOpen()) autosaveSoon(); });
  let blurTimer; function autosaveSoon() { clearTimeout(blurTimer); if (dirty) blurTimer = setTimeout(autosave, 400); }
  window.addEventListener('resize', () => { kick(true); layoutMarks(); if (reading) layoutGutter(); });

  // Buttons
  $('#btnChapters').addEventListener('click', () => toggle('#outline'));
  $('#btnNew').addEventListener('click', doNew);
  $('#btnOpen').addEventListener('click', doOpen);
  $('#btnSave').addEventListener('click', () => save('save'));
  $('#btnExport').addEventListener('click', () => toggle('#exportMenu', '#btnExport'));
  $('#btnVersions').addEventListener('click', openVersions);
  $('#btnMode').addEventListener('click', () => { const o = $('#modeWrap').classList.toggle('open'); $('#btnMode').setAttribute('aria-expanded', String(o)); });
  $$('#modeMenu [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#modeWrap')) { $('#modeWrap').classList.remove('open'); $('#btnMode').setAttribute('aria-expanded', 'false'); } });
  $('#btnSettings').addEventListener('click', () => toggle('#settings', '#btnSettings', 'right'));
  $('#btnFull').addEventListener('click', () => window.api.toggleFullscreen());
  $('#btnClose').addEventListener('click', () => window.api.close());
  async function loadSpellLangs() {
    try {
      const info = await window.api.spellInfo();
      if (!info || !info.available || !info.available.length) { $$('#spellA,#spellB').forEach((x) => x.closest('.row').hidden = true); return; }
      const names = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' });
      const label = (c) => { try { return names.of(c) + ' (' + c + ')'; } catch (e) { return c; } };
      const fill = (sel, withNone, value) => {
        sel.innerHTML = '';
        if (withNone) sel.appendChild(new Option('None', ''));
        info.available.slice().sort((a, b) => label(a).localeCompare(label(b))).forEach((c) => sel.appendChild(new Option(label(c), c)));
        sel.value = value || '';
      };
      fill($('#spellA'), false, info.current[0]);
      fill($('#spellB'), true, info.current[1]);
      const apply = () => window.api.spellSet([$('#spellA').value, $('#spellB').value].filter(Boolean));
      $('#spellA').addEventListener('change', apply);
      $('#spellB').addEventListener('change', apply);
    } catch (e) { /* the list is optional */ }
  }
  loadSpellLangs();
  window.api.onUpdateReady((v) => toast('Version ' + (v || '') + ' is ready. It installs when you close Quire.'));
  $('#fmtToggle').addEventListener('mousedown', (e) => e.preventDefault());
  $('#fmtToggle').addEventListener('click', () => savePrefs({ fmtbar: prefs.fmtbar === false }));
  // keyboard: the top bar opens with F10 or when it gets focus; the Mode menu works with the arrow keys
  $('#topbar').addEventListener('focusin', showChrome);
  $('#topbar').addEventListener('keydown', (e) => {
    const wrap = $('#modeWrap'), items = $$('#modeMenu [data-mode]');
    const inMenu = e.target.closest && e.target.closest('#modeMenu');
    if (e.key === 'Escape') {
      if (wrap.classList.contains('open') || inMenu) { e.preventDefault(); e.stopPropagation(); wrap.classList.remove('open'); $('#btnMode').setAttribute('aria-expanded', 'false'); $('#btnMode').focus(); }
      else { e.stopPropagation(); if (document.activeElement) document.activeElement.blur(); if (!reading) editor.focus(); }
      return;
    }
    if (e.target.id === 'btnMode' && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); wrap.classList.add('open'); $('#btnMode').setAttribute('aria-expanded', 'true');
      (items.find((b) => b.classList.contains('on')) || items[0]).focus(); return;
    }
    if (inMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  });
  // settings: Tab stays inside the page (even if the focus had slipped back to the text)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || $('#settings').hidden) return;
    const f = [...$('#settings').querySelectorAll('button:not(:disabled),input:not(:disabled),select')].filter((x) => x.offsetParent);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
  });
  // settings page: sections on the left
  $$('.st-nav button').forEach((b) => b.addEventListener('click', () => {
    $$('.st-nav button').forEach((x) => x.classList.toggle('on', x === b));
    $$('#settings [data-secpane]').forEach((p) => { p.hidden = p.dataset.secpane !== b.dataset.sec; });
  }));
  $('#readBack').addEventListener('click', () => setMode('write'));
  $('#settingsClose').addEventListener('click', () => { closePanels(); if (!reading) editor.focus(); });
  $('#settings').addEventListener('mousedown', (e) => { if (e.target === $('#settings')) { closePanels(); if (!reading) editor.focus(); } });
  $('#docTitle').addEventListener('input', (e) => { doc.title = e.target.value; markDirty(); updateFileHint(); });
  $('#outlineClose').addEventListener('click', closeOutline);
  $('#addChapter').addEventListener('click', addChapter);
  $('#modalClose').addEventListener('click', () => { $('#modal').hidden = true; });
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });
  $$('#fmtbar button').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
    b.addEventListener('click', () => command(b.dataset.cmd));
  });
  $$('#exportMenu [data-format]').forEach((b) => b.addEventListener('click', () => doExport(b.dataset.format)));
  $('#noteSave').addEventListener('click', () => closeNotePop(true));
  $('#noteDelete').addEventListener('click', deleteNote);
  $('#noteText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeNotePop(true); }
  });
  document.addEventListener('mousedown', (e) => {
    if (!$('#notePop').hidden && !e.target.closest('#notePop') && !e.target.closest('.gcard') && !e.target.closest('.nmark')) closeNotePop(true);
    if (!e.target.closest('.popover') && !e.target.closest('#topbar') && !e.target.closest('#outline')) {
      $('#exportMenu').hidden = true;
    }
  });

  // Settings controls
  $$('[data-pref]').forEach((el) => {
    const k = el.dataset.pref;
    if (el.classList.contains('seg') || el.classList.contains('swatches')) el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) savePrefs({ [k]: b.dataset.v }); });
    else if (el.type === 'checkbox') el.addEventListener('change', () => savePrefs({ [k]: el.checked }));
    else if (el.type === 'range') {
      el.addEventListener('input', () => savePrefs({ [k]: +el.value }));
      const panel = $('#settings'), row = el.closest('.row');
      let t;
      const on = () => { clearTimeout(t); panel.classList.add('adjusting'); row.classList.add('live'); };
      const off = () => { clearTimeout(t); panel.classList.remove('adjusting'); row.classList.remove('live'); };
      el.addEventListener('pointerdown', on);
      window.addEventListener('pointerup', off); window.addEventListener('pointercancel', off);
      el.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') { on(); clearTimeout(t); t = setTimeout(off, 900); } });
      window.addEventListener('mouseup', off); el.addEventListener('lostpointercapture', off);
    }
    else if (el.type === 'number') el.addEventListener('change', () => savePrefs({ [k]: Math.max(0, +el.value || 0) }));
  });
  $$('[data-num]').forEach((el) => {
    const k = el.dataset.num;
    const commit = () => {
      const mn = +el.min, mx = +el.max;
      let v = Math.round(+el.value);
      if (!isFinite(v) || el.value === '') v = prefs[k];
      v = Math.min(mx, Math.max(mn, v));
      el.value = v;
      savePrefs({ [k]: v });
    };
    el.addEventListener('change', commit);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); el.select(); } });
    el.addEventListener('focus', () => el.select());
  });
  $$('[data-reset]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.reset; savePrefs({ [k]: DEFAULTS[k] }); }));
  const RESETTABLE = ['theme', 'accent', 'font', 'justify', 'weight', 'size', 'measure', 'anchor', 'typewriter', 'centerMode', 'fmtbar', 'fade', 'glow', 'goal', 'bookGoal', 'autoUpdate'];
  $('#resetAll').addEventListener('click', () => {
    const patch = {};
    RESETTABLE.forEach((k) => { if (DEFAULTS[k] !== undefined) patch[k] = DEFAULTS[k]; });
    savePrefs(patch);
    toast('Settings back to their defaults');
  });

  // From the main process
  window.api.onSystemTheme((dark) => { systemDark = dark; applyPrefs(); });
  window.api.onOpenFile(async (r) => { if (await confirmDiscard()) { if (filePath && dirty) await autosave(); openResult(r); } });
  window.api.onFlush(async () => {
    try { await autosave(); } finally { window.api.closeNow(); }
  });

  /* ============================ start ============================ */
  applyPrefs();
  updateModeUI();
  (function start() {
    if (init.open && !init.open.error) {
      try {
        const p = parseByExtension(init.open.path, init.open.text);
        loadDoc(p.doc, p.path, { dirty: !!p.imported });
        return;
      } catch (e) { /* fall through to a blank page */ }
    } else if (init.recovery) {
      try { loadDoc(D.parseDraft(init.recovery), null, { dirty: true }); toast('Restored your unsaved draft'); return; } catch (e) { /* ignore */ }
    }
    loadDoc(D.newDoc(), null);
    if (init.open && init.open.error) window.api.error(init.open.error);
  })();
  showChrome();
  kick(true);

  // exposed for tests
  window.__app = { get doc() { return doc; }, syncFromDom, snapshotDoc, domToBlocks, blocksToHtml, setReading, setMode, addChapter, selectChapter, loadDoc, get cur() { return cur; } };
})();
