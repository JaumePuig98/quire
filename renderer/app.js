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
  let systemDark = init.systemDark;
  let doc = null;
  let cur = 0; // index of the chapter in the editor
  let filePath = null;
  let reading = false;
  let dirty = false;
  let saving = false;
  let wordCounts = []; // cached words per chapter
  let activeNote = null;
  let revision = 1; // number in the file name: title_v1.draft, title_v2.draft ...
  let shiftX = 0; // horizontal slide of the line being written
  let liveEl = null; // the paragraph being written: shown as one line that slides under the caret

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
    amber: { name: 'Amber', l: '181 101 29', d: '232 165 90', gl: '255 224 150', gd: '255 190 100' },
    rose: { name: 'Rose', l: '176 72 90', d: '232 130 150', gl: '255 205 215', gd: '255 150 170' },
    sage: { name: 'Sage', l: '83 125 94', d: '140 190 150', gl: '205 235 210', gd: '140 200 160' },
    ocean: { name: 'Ocean', l: '52 107 150', d: '120 175 220', gl: '195 222 245', gd: '110 170 225' },
    plum: { name: 'Plum', l: '128 85 150', d: '190 150 215', gl: '226 206 240', gd: '170 130 200' },
    slate: { name: 'Slate', l: '90 90 95', d: '190 190 195', gl: '226 226 231', gd: '200 200 210' },
  };
  function savePrefs(patch) {
    Object.assign(prefs, patch);
    window.api.setPrefs(patch);
    applyPrefs();
  }
  function applyPrefs() {
    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemDark);
    document.body.classList.toggle('dark', dark);
    document.body.dataset.font = prefs.font;
    const ac = ACCENTS[prefs.accent] || ACCENTS.amber;
    document.body.style.setProperty('--accent', dark ? ac.d : ac.l);
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
    root.style.setProperty('--measure', prefs.measure + 'px');
    root.style.setProperty('--anchor', prefs.anchor);
    document.body.classList.toggle('nofade', !prefs.fade);
    document.body.classList.toggle('noglow', !prefs.glow);
    $('#btnTheme').textContent = prefs.theme === 'system' ? 'Theme: Auto' : prefs.theme === 'dark' ? 'Theme: Dark' : 'Theme: Light';
    $('#btnFull').textContent = 'Full screen';
    // settings panel
    $$('[data-pref]').forEach((el) => {
      const k = el.dataset.pref;
      if (el.classList.contains('seg') || el.classList.contains('swatches')) $$('button', el).forEach((b) => b.classList.toggle('on', b.dataset.v === String(prefs[k])));
      else if (el.type === 'checkbox') el.checked = !!prefs[k];
      else if (document.activeElement !== el) el.value = prefs[k];
    });
    $$('[data-out]').forEach((o) => { const k = o.dataset.out; o.textContent = k === 'anchor' ? prefs[k] + '%' : prefs[k] + 'px'; });
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
      return '<' + tag + '>' + (inner || '<br>') + '</' + tag + '>';
    }).join('');
  }

  function syncFromDom() {
    if (!doc) return;
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
    liveEl = null; shiftX = 0;
    editor.innerHTML = blocksToHtml(doc.chapters[cur].blocks);
    scroller.scrollTop = 0;
    if (reading) layoutGutter();
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
    revision = path ? revisionFromPath(path) : 1;
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
    window.api.setTitle(baseName(filePath) + ' — Quire');
  }
  function setSaveState(s) { $('#saveState').textContent = s; }

  /* ---- names: the title gives the file names ---- */
  function firstHeading() {
    for (const c of doc.chapters) for (const b of c.blocks) if (b.t === 'h1' && D.blockText(b).trim()) return D.blockText(b).trim();
    return '';
  }
  function docTitle() {
    return (doc.title || '').trim() || firstHeading() || doc.chapters[0].title.trim() || firstWords() || 'Untitled';
  }
  const revisionFromPath = (p) => { const m = baseName(p).match(/_v(\d+)\.draft$/i); return m ? +m[1] : 1; };
  const draftName = () => D.slugify(docTitle()) + '_v' + revision + '.draft';
  function updateFileHint() {
    const h = $('#fileHint');
    if (h) h.textContent = filePath ? baseName(filePath) : draftName();
  }

  // mode: 'save' (in place; asks only the first time), 'version' (next numbered file, no questions), 'as' (choose a name)
  async function save(mode) {
    snapshotDoc();
    setSaveState('Saving…');
    if (mode === 'version' && filePath) await autosave(); // the old version stays exactly as it was
    const r = await window.api.save({
      path: filePath, saveAs: mode === 'as', newVersion: mode === 'version' && !!filePath,
      text: D.serializeDraft(doc), suggested: D.slugify(docTitle()) + '_v' + revision,
      base: D.slugify(docTitle()), revision,
    });
    if (!r) { setSaveState(dirty ? 'Not saved yet' : 'Saved'); return false; }
    filePath = r.path;
    revision = r.revision || revisionFromPath(r.path);
    dirty = false;
    updateTitle();
    updateFileHint();
    setSaveState('Saved');
    toast(mode === 'version' ? 'Saved as ' + baseName(r.path) : 'Saved');
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
  async function autosave() {
    if (!doc) return;
    snapshotDoc();
    const text = D.serializeDraft(doc);
    if (filePath) {
      const ok = await window.api.autosave({ path: filePath, text });
      if (ok) { dirty = false; setSaveState('Saved'); } else setSaveState('Could not save');
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
    await openResult(await window.api.openDialog());
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
    if (multi) parts.push((ch.title.trim() || 'Chapter ' + (cur + 1)));
    const w = wordCounts[cur] || 0;
    parts.push(w.toLocaleString() + (w === 1 ? ' word' : ' words'));
    if (multi) parts.push(totalWords().toLocaleString() + ' in total');
    if (prefs.goal > 0) parts.push(wordsToday().toLocaleString() + ' / ' + prefs.goal.toLocaleString() + ' today');
    $('#statusLeft').textContent = parts.join(' · ');
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
  function kick(wantScroll) {
    if (wantScroll) follow = true;
    if (!raf) raf = requestAnimationFrame(tick);
  }
  // The paragraph you are writing is shown as a single line that slides sideways, so the caret stays in the
  // middle of the screen. Every other paragraph stays exactly where it is.
  function setLive(el) {
    if (liveEl && !editor.contains(liveEl)) liveEl = null;
    if (el === liveEl) return;
    if (liveEl) { liveEl.classList.remove('live'); liveEl.style.transform = ''; }
    liveEl = el;
    shiftX = 0;
    if (el) el.classList.add('live');
  }
  function setShift(v) {
    shiftX = v;
    if (liveEl) liveEl.style.transform = v ? 'translateX(' + Math.round(v) + 'px)' : '';
  }
  // Vertical: the writing line stays at one height. Horizontal: the line you are writing slides under the caret.
  function tick() {
    raf = 0;
    const focused = !reading && document.activeElement === editor;
    const canFollow = follow && focused;
    if (!(focused && prefs.centerCaret)) setLive(null);
    else if (canFollow && getSelection().isCollapsed) setLive(currentBlock());
    const r = caretRect();
    if (!r) return;
    const mid = r.top + r.height / 2;
    glow.style.setProperty('--ly', mid + 'px');
    let more = false;

    if (canFollow && prefs.typewriter) {
      const anchorY = innerHeight * prefs.anchor / 100;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const target = Math.max(0, Math.min(max, scroller.scrollTop + mid - anchorY));
      const d = target - scroller.scrollTop;
      if (Math.abs(d) < 1) scroller.scrollTop = target;
      else { scroller.scrollTop += d * 0.24; more = true; }
    }

    let tx = shiftX;
    if (!liveEl) tx = 0;
    else if (canFollow) tx = innerWidth / 2 - (r.left - shiftX);
    const dx = tx - shiftX;
    if (Math.abs(dx) < 0.6) { if (shiftX !== tx) setShift(tx); }
    else { setShift(shiftX + dx * 0.3); more = true; }

    if (more) raf = requestAnimationFrame(tick);
    else if (canFollow) follow = false;
  }
  scroller.addEventListener('scroll', () => { if (scroller.scrollLeft) scroller.scrollLeft = 0; });

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
  function setBlock(kind) {
    if (reading) return;
    editor.focus();
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
    afterEdit();
  }
  function command(cmd) {
    if (cmd === 'note') return addNote();
    if (reading) return;
    editor.focus();
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') { document.execCommand(cmd); afterEdit(); }
    else setBlock(cmd);
  }
  function afterEdit() { markDirty(); scheduleCount(); updateActive(); kick(true); }
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
    pop.style.left = Math.max(12, Math.min(innerWidth - 320, r.left)) + 'px';
    const below = r.bottom + 10;
    pop.style.top = (below + 190 > innerHeight ? Math.max(12, r.top - 200) : below) + 'px';
    $$('.note[data-note="' + id + '"]').forEach((x) => x.classList.add('active'));
    setTimeout(() => $('#noteText').focus(), 0);
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

  /* ============================ reading mode ============================ */
  function setReading(on) {
    if (on === reading) return;
    if (on) syncFromDom();
    reading = on;
    document.body.classList.toggle('reading', on);
    editor.contentEditable = on ? 'false' : 'true';
    $('#readbar').hidden = !on;
    $('#btnRead').textContent = on ? 'Write' : 'Read';
    $('#btnRead').classList.toggle('on', on);
    closePanels();
    if (on) {
      scroller.scrollTop = 0;
      layoutGutter();
    } else {
      renderChapter();
      editor.focus();
      placeCaretAtEnd();
      kick(true);
    }
  }

  /* ============================ chapters ============================ */
  function selectChapter(i) {
    if (i < 0 || i >= doc.chapters.length || i === cur) return;
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
      inp.value = c.title; inp.placeholder = 'Untitled chapter'; inp.setAttribute('aria-label', 'Chapter ' + (i + 1) + ' title');
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
    const c = await window.api.confirm({ message: 'Delete “' + (doc.chapters[i].title || 'Untitled chapter') + '”?', detail: 'Its text and notes will be removed. Earlier versions in History still contain it.', buttons: ['Delete', 'Cancel'] });
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
  function openOutline() { closePanels(); $('#outline').hidden = false; renderOutline(); }
  function closeOutline() { $('#outline').hidden = true; if (!reading) { editor.focus(); } }

  /* ============================ export / history ============================ */
  async function doExport(format) {
    $('#exportMenu').hidden = true;
    snapshotDoc();
    toast('Preparing ' + format.toUpperCase() + '…');
    const r = await window.api.exportDoc({
      format, doc, suggested: docTitle(),
      opts: { notes: $('#exportNotes').checked, font: prefs.font, author: doc.author || undefined },
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
      const items = await window.api.versionsList(filePath);
      if (!items.length) list.innerHTML = '<li class="small">No earlier versions yet. A snapshot is taken about every ten minutes while you write.</li>';
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
  const anyPanelOpen = () => ['#exportMenu', '#settings', '#outline', '#notePop', '#modal'].some((s) => !$(s).hidden);
  function placePopover(pop, btn, align) {
    const b = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = align === 'right' ? b.right - w : b.left;
    pop.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + 'px';
    pop.style.right = 'auto';
    pop.style.top = (b.bottom + 8) + 'px';
  }
  function toggle(sel, btnSel, align) {
    const open = !$(sel).hidden;
    closePanels();
    $(sel).hidden = open;
    if (!open) {
      showChrome();
      if (btnSel) placePopover($(sel), $(btnSel), align);
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
  function hideChrome() { if (!anyPanelOpen()) document.body.classList.add('idle'); }

  /* ============================ sound ============================ */
  let actx, clickBuf;
  function ensureAudio() {
    if (actx) return;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const len = Math.floor(actx.sampleRate * 0.03);
    clickBuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = clickBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  function playKey(kind) {
    if (!prefs.sound) return;
    ensureAudio();
    const t = actx.currentTime;
    const src = actx.createBufferSource(); src.buffer = clickBuf;
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = kind === 'space' ? 700 : 1800 + Math.random() * 500; f.Q.value = 0.8;
    const g = actx.createGain(); g.gain.value = kind === 'space' ? 0.5 : 0.35;
    src.connect(f); f.connect(g); g.connect(actx.destination); src.start(t);
    if (kind === 'enter') {
      const o = actx.createOscillator(); const og = actx.createGain();
      o.type = 'sine'; o.frequency.value = 2350;
      og.gain.setValueAtTime(0.0001, t + 0.05); og.gain.exponentialRampToValueAtTime(0.12, t + 0.06); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(og); og.connect(actx.destination); o.start(t + 0.05); o.stop(t + 0.95);
    }
  }

  /* ============================ events ============================ */
  document.addEventListener('mousemove', showChrome);
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (!ctrl && !e.altKey && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) {
      hideChrome();
      document.body.classList.add('typing');
      if (!reading && document.activeElement === editor) playKey(e.key === 'Enter' ? 'enter' : e.key === ' ' ? 'space' : 'key');
    }
    if (e.key === 'F11') { e.preventDefault(); window.api.toggleFullscreen(); return; }
    if (e.key === 'Escape') {
      if (activeNote && !$('#notePop').hidden) { e.preventDefault(); closeNotePop(false); return; }
      if (!$('#modal').hidden) { $('#modal').hidden = true; return; }
      if (anyPanelOpen()) { e.preventDefault(); closePanels(); if (!reading) editor.focus(); }
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
      case 's': e.preventDefault(); save(shift ? 'version' : 'save'); break;
      case 'o': e.preventDefault(); if (shift) toggle('#outline'); else doOpen(); break;
      case 'n': e.preventDefault(); doNew(); break;
      case 'e': e.preventDefault(); toggle('#exportMenu', '#btnExport'); break;
      case 'r': e.preventDefault(); setReading(!reading); break;
      case ',': e.preventDefault(); toggle('#settings', '#btnSettings', 'right'); break;
      case 'pagedown': e.preventDefault(); selectChapter(cur + 1); break;
      case 'pageup': e.preventDefault(); selectChapter(cur - 1); break;
      default: break;
    }
  });
  document.addEventListener('keyup', () => document.body.classList.remove('typing'));

  editor.addEventListener('input', () => {
    if (!editor.firstChild || editor.innerHTML === '<br>') { editor.innerHTML = '<p><br></p>'; placeCaretAtEnd(); }
    markDirty(); scheduleCount(); kick(true);
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
    text.split('\n').forEach((line, i) => {
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
  window.addEventListener('resize', () => { kick(true); if (reading) layoutGutter(); });

  // Buttons
  $('#btnChapters').addEventListener('click', () => toggle('#outline'));
  $('#btnNew').addEventListener('click', doNew);
  $('#btnOpen').addEventListener('click', doOpen);
  $('#btnSave').addEventListener('click', () => save('save'));
  $('#btnVersion').addEventListener('click', () => save('version'));
  $('#btnExport').addEventListener('click', () => toggle('#exportMenu', '#btnExport'));
  $('#btnVersions').addEventListener('click', openVersions);
  $('#btnRead').addEventListener('click', () => setReading(!reading));
  $('#btnTheme').addEventListener('click', () => savePrefs({ theme: { system: 'light', light: 'dark', dark: 'system' }[prefs.theme] }));
  $('#btnSettings').addEventListener('click', () => toggle('#settings', '#btnSettings', 'right'));
  $('#btnFull').addEventListener('click', () => window.api.toggleFullscreen());
  $('#btnClose').addEventListener('click', () => window.api.close());
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
    if (!$('#notePop').hidden && !e.target.closest('#notePop') && !e.target.closest('.gcard')) closeNotePop(true);
    if (!e.target.closest('.popover') && !e.target.closest('#topbar') && !e.target.closest('#outline')) {
      $('#exportMenu').hidden = true; $('#settings').hidden = true;
    }
  });

  // Settings controls
  $$('[data-pref]').forEach((el) => {
    const k = el.dataset.pref;
    if (el.classList.contains('seg') || el.classList.contains('swatches')) el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) savePrefs({ [k]: b.dataset.v }); });
    else if (el.type === 'checkbox') el.addEventListener('change', () => savePrefs({ [k]: el.checked }));
    else if (el.type === 'range') el.addEventListener('input', () => savePrefs({ [k]: +el.value }));
    else if (el.type === 'number') el.addEventListener('change', () => savePrefs({ [k]: Math.max(0, +el.value || 0) }));
  });

  // From the main process
  window.api.onSystemTheme((dark) => { systemDark = dark; applyPrefs(); });
  window.api.onOpenFile(async (r) => { if (await confirmDiscard()) { if (filePath && dirty) await autosave(); openResult(r); } });
  window.api.onFlush(async () => {
    try { await autosave(); } finally { window.api.closeNow(); }
  });

  /* ============================ start ============================ */
  applyPrefs();
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
  window.__app = { get doc() { return doc; }, syncFromDom, snapshotDoc, domToBlocks, blocksToHtml, setReading, addChapter, selectChapter, loadDoc, get cur() { return cur; } };
})();
