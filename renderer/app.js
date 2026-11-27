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
  const appVersion = init.version || '';
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
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }
  /* ---- friendly messages: a greeting by time of day and a cheer at goals. Short, rare, and one switch turns them off. ---- */
  const CHEER = {
    morning: ['Good morning. A clean page is waiting.', 'Morning. Coffee first, then words.', 'Good morning. Even a few lines count.'],
    afternoon: ['Good afternoon. Pick up where you left off.', 'Afternoon. One sentence at a time.', 'Good afternoon. The next paragraph is the hard one, and you have it.'],
    evening: ['Good evening. Time for a few good pages.', 'Evening. Let the day go and write.', 'Good evening. The page is quiet, which suits you.'],
    night: ['Late night writing. The best kind.', 'Quiet hours. Perfect for a rough draft.', 'Night owl hours. Write it now, fix it tomorrow.'],
    goal: ['Daily goal reached. Well done.', 'Today\u2019s goal is done. Anything more is a bonus.', 'Goal reached. Take a break, or write a few more lines.'],
    chapter: ['Chapter target reached.', 'This chapter hit its target. Nicely done.', 'Chapter target done. On to the next one?'],
    egg: ['Quire was made for slow, careful writing. Carry on.', 'No one has ever finished a book by reorganizing the settings. Go write.'],
  };
  let lastCheer = '';
  function cheer(kind, ms) {
    if (!prefs.friendly || !CHEER[kind]) return;
    const pool = CHEER[kind].filter((m) => m !== lastCheer);
    lastCheer = pool[Math.floor(Math.random() * pool.length)] || CHEER[kind][0];
    toast(lastCheer, ms || 3600);
  }
  function welcome() {
    if (!$('#tplDlg').hidden) { setTimeout(welcome, 1200); return; } // let the person choose what to start first
    welcomed = true;
    if (prefs.introSeen === false) { // first install only: one quiet pointer to the settings, never again
      savePrefs({ introSeen: true, lastVersion: appVersion });
      toast('Welcome to Quire. When you have a minute, open Settings (Ctrl+,) and set it up the way you like to write.', 9000);
      return;
    }
    if (appVersion && prefs.lastVersion !== appVersion) { // after an update: the release note, once
      savePrefs({ lastVersion: appVersion });
      const note = window.WhatsNew && window.WhatsNew[appVersion];
      if (note) { toast(note, 9000); return; }
    }
    if (resumeNote) { toast(resumeNote, 4200); resumeNote = ''; return; }
    const pc = paceInfo();
    if (pc && pc.per && localStorage.getItem('paceDay') !== todayKey()) { // the daily pace, once a day
      try { localStorage.setItem('paceDay', todayKey()); } catch (e) { /* ignore */ }
      toast(pc.short, 5200);
      return;
    }
    const h = new Date().getHours();
    const kind = h >= 5 && h < 12 ? 'morning' : h < 17 && h >= 12 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night';
    cheer(kind, 4200);
  }
  // Each milestone cheers once per day, so the message stays a treat.
  function cheerOnce(key, kind) {
    try {
      const c = JSON.parse(localStorage.getItem('cheered') || '{}');
      const day = todayKey();
      if (c.day !== day) { c.day = day; c.done = {}; }
      if (c.done[key]) return;
      c.done[key] = 1; localStorage.setItem('cheered', JSON.stringify(c));
    } catch (e) { /* storage unavailable: cheer anyway, once per session below */ }
    cheer(kind);
  }
  const baseName = (p) => (p ? p.split(/[\\/]/).pop() : 'Untitled');
  const stem = (p) => baseName(p).replace(/\.[^.]+$/, '');
  // the local calendar day (not UTC: in Toronto the UTC day changes at 7 pm)
  const dayKey = (offset) => { const d = new Date(); d.setDate(d.getDate() + (offset || 0)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const todayKey = () => dayKey(0);

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
  // The formatting bar shows the buttons you chose. Hidden ones still work through their shortcuts and Markdown.
  const FMT_ITEMS = [['bold', 'Bold', 'Ctrl+B'], ['italic', 'Italic', 'Ctrl+I'], ['underline', 'Underline', 'Ctrl+U'], ['h1', 'Heading 1', 'Ctrl+1'], ['h2', 'Heading 2', 'Ctrl+2'], ['h3', 'Heading 3', 'Ctrl+3'], ['h4', 'Heading 4', 'Ctrl+4'],
    ['quote', 'Quote', 'Ctrl+Shift+Q'], ['poem', 'Poem', 'Ctrl+Shift+P'], ['break', 'Scene break', 'Ctrl+Shift+Enter'], ['note', 'Note', 'Ctrl+Alt+M']];
  const headingDepth = () => Math.min(4, Math.max(2, +prefs.headingDepth || 2));
  function applyFmtItems() {
    const hide = Array.isArray(prefs.fmtHide) ? prefs.fmtHide : [];
    document.body.classList.toggle('nohints', prefs.fmtHints === false);
    const bar = $('#fmtbar'); if (!bar) return;
    let shown = 0, seen = false, pending = null;
    [...bar.children].forEach((el) => {
      if (el.classList.contains('sep')) { el.hidden = true; pending = el; return; }
      el.hidden = hide.includes(el.dataset.cmd) || (/^h[34]$/.test(el.dataset.cmd) && +el.dataset.cmd[1] > headingDepth());
      if (!el.hidden) { shown++; if (seen && pending) pending.hidden = false; seen = true; pending = null; } // a divider only between two groups that are showing
    });
    $('#fmtdock').hidden = shown === 0;
    $$('#fmtItems input').forEach((i) => { i.checked = !hide.includes(i.dataset.fmt); i.closest('label').hidden = /^h[34]$/.test(i.dataset.fmt) && +i.dataset.fmt[1] > headingDepth(); });
  }
  function applyPrefs() {
    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemDark) || (prefs.theme === 'evening' && window.Sun.isNight());
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
    applyFmtItems();
    syncTitleLine();
    const ac = ACCENTS[prefs.accent] || ACCENTS.amber;
    document.body.style.setProperty('--accent', dark ? ac.d : ac.l);
    document.body.style.setProperty('--accent-ink', dark ? ac.d : ac.ink); // darker on light backgrounds so text in the accent stays readable
    // Two swatch groups: the accent color, and the color of the soft light (which can simply follow the accent).
    $$('.swatches').forEach((sw) => {
      const glowGroup = sw.dataset.pref === 'glowColor';
      const ids = glowGroup ? ['accent'].concat(Object.keys(ACCENTS), ['white']) : Object.keys(ACCENTS);
      if (sw.children.length !== ids.length) {
        sw.innerHTML = '';
        ids.forEach((id) => {
          const b = document.createElement('button');
          const name = id === 'accent' ? 'Match the accent color' : id === 'white' ? 'White' : ACCENTS[id].name;
          b.type = 'button'; b.dataset.v = id; b.title = name; b.setAttribute('aria-label', name);
          if (id === 'accent') b.classList.add('glowmatch'); else if (id === 'white') b.classList.add('glowwhite');
          sw.appendChild(b);
        });
      }
      $$('button', sw).forEach((b) => { const a = ACCENTS[b.dataset.v]; if (a) b.style.background = 'rgb(' + (glowGroup ? (dark ? a.gd : a.gl) : (dark ? a.d : a.l)) + ')'; });
    });
    {
      const gc = prefs.glowColor;
      const g = gc === 'white' ? '255 255 255' : (ACCENTS[gc] && gc !== 'accent') ? (dark ? ACCENTS[gc].gd : ACCENTS[gc].gl) : (dark ? ac.gd : ac.gl);
      document.body.style.setProperty('--glow', g);
      document.body.style.setProperty('--glow-k', String(Math.max(0, Math.min(200, prefs.glowStrength == null ? 100 : prefs.glowStrength)) / 100));
    }
    root.style.setProperty('--fs', prefs.size + 'px');
    const oneWeight = prefs.font === 'type'; // Courier Prime comes in a single weight
    root.style.setProperty('--fw', oneWeight ? 400 : (prefs.weight || 400));
    $$('[data-pref=weight],[data-num=weight]').forEach((el) => { el.disabled = oneWeight; });
    const wrow = $('[data-pref=weight]'); if (wrow) { const rw = wrow.closest('.row'); rw.classList.toggle('disabled', oneWeight); rw.title = oneWeight ? 'The Typewriter font has one weight' : ''; }
    root.style.setProperty('--measure', prefs.measure + 'px');
    root.style.setProperty('--lh', String(prefs.lineHeight || DEFAULTS.lineHeight || 1.7));
    root.style.setProperty('--pg', (prefs.paraGap != null ? prefs.paraGap : 0.6) + 'em');
    root.style.setProperty('--indent', (prefs.indent || 0) + 'em');
    root.style.setProperty('--hb', (prefs.headBefore != null ? prefs.headBefore : 0.9) + 'em');
    root.style.setProperty('--ha', (prefs.headAfter != null ? prefs.headAfter : 0.4) + 'em');
    root.style.setProperty('--qg', (prefs.quoteGap != null ? prefs.quoteGap : 0.9) + 'em');
    root.style.setProperty('--anchor', prefs.anchor);
    document.body.classList.toggle('nofade', !prefs.fade);
    document.body.style.setProperty('--fade-k', String(Math.max(20, Math.min(100, prefs.fadeReach == null ? 100 : prefs.fadeReach)) / 100));
    document.body.dataset.caret = prefs.caret === 'block' || prefs.caret === 'underline' ? prefs.caret : 'bar';
    document.body.classList.toggle('noblink', prefs.caretBlink === false);
    document.body.classList.toggle('noglow', !prefs.glow);
    // settings panel
    $$('[data-pref]').forEach((el) => {
      const k = el.dataset.pref;
      if (el.classList.contains('seg') || el.classList.contains('swatches')) $$('button', el).forEach((b) => { const on = b.dataset.v === String(prefs[k]); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      else if (el.type === 'checkbox') el.checked = !!prefs[k];
      else if (document.activeElement !== el) el.value = prefs[k];
      if (el.type === 'date') el.classList.toggle('empty', !prefs[k]);
    });
    $$('[data-num]').forEach((el) => { if (document.activeElement !== el) el.value = prefs[el.dataset.num]; });
    const stn = $('#streakNote');
    if (stn) { const st = prefs.streak || {}; stn.textContent = prefs.goal > 0 ? 'Streak: ' + streakNow() + (streakNow() === 1 ? ' day' : ' days') + ' in a row' + (st.best > 1 ? ' (best ' + st.best + ')' : '') + '. A day counts when you reach the daily goal.' : 'Set a daily goal to start a streak.'; }
    $$('[data-reset]').forEach((b) => { b.classList.toggle('show', DEFAULTS[b.dataset.reset] !== undefined && prefs[b.dataset.reset] !== DEFAULTS[b.dataset.reset]); });
    if (typeof updatePace === 'function') updatePace();
    kick(false);
    applyFocus();
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
          const t = /^H[1-6]$/.test(tag) ? 'h' + Math.min(+tag[1], 4) : tag === 'BLOCKQUOTE' ? 'quote' : tag === 'P' && n.classList.contains('poem') ? 'poem' : inherited || 'p';
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
      const tag = /^h[1-4]$/.test(b.t) ? b.t : b.t === 'quote' ? 'blockquote' : 'p';
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
      const cls = D.isCite(b) ? ' class="cite"' : D.isBreak(b) ? ' class="sbreak"' : b.t === 'poem' ? ' class="poem"' : '';
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
  /* ---- chapter title above the text: the same field as the name in the chapter menu ---- */
  const chapTitle = $('#chapTitle'), chapHead = $('#chapHead'), chapDup = $('#chapDup');
  const sameTitle = (x, y) => D.norm ? D.norm(x) === D.norm(y) : String(x).trim().toLowerCase() === String(y).trim().toLowerCase();
  function syncTitleLine() {
    if (!doc || !chapTitle) return;
    const c = doc.chapters[cur];
    // in Read mode the title stays (read only); the whole-book view already names each chapter
    const on = prefs.titleLine !== false && kindOf() !== 'journal' && D.headingPlan(doc).chapterHeadings && !readingBook() && (!reading || !!c.title.trim());
    chapHead.hidden = !on;
    chapTitle.readOnly = reading;
    if (!on) return;
    if (document.activeElement !== chapTitle) chapTitle.value = c.title;
    chapTitle.placeholder = 'Untitled ' + unitWord().toLowerCase();
    chapTitle.setAttribute('aria-label', unitWord() + ' title');
    const first = c.blocks.find((b) => D.blockText(b).trim());
    chapDup.hidden = !(c.title.trim() && first && first.t === 'h1' && sameTitle(D.blockText(first), c.title)) || reading;
    chapTitle.tabIndex = reading ? -1 : 0;
  }
  // A heading typed at the top of a chapter fills in the chapter's name while the name is empty (or still the heading's own text), so it is never typed twice
  let adopted = null;
  function adoptTitle() {
    if (!doc || reading || kindOf() === 'journal' || !D.headingPlan(doc).chapterHeadings) return;
    const f = editor.firstElementChild;
    if (!f || f.tagName !== 'H1') return;
    const text = f.textContent.replace(/\s+/g, ' ').trim();
    const c = doc.chapters[cur];
    if (!text || text === c.title) return;
    if (!c.title.trim() || (adopted && adopted.id === c.id && adopted.text === c.title)) {
      c.title = text.slice(0, 200); adopted = { id: c.id, text: c.title };
      const oi = $$('#chapterList li')[cur] && $$('#chapterList li')[cur].querySelector('input'); if (oi) oi.value = c.title;
      syncTitleLine();
    }
  }
  chapTitle.addEventListener('input', () => {
    const c = doc.chapters[cur]; c.title = chapTitle.value; markDirty(); updateStatus();
    const oi = $$('#chapterList li')[cur] && $$('#chapterList li')[cur].querySelector('input'); if (oi) oi.value = c.title;
    syncTitleLine();
  });
  chapTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); editor.focus(); const f = editor.firstElementChild; if (f) { const r = document.createRange(); r.selectNodeContents(f); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } kick(true); }
    else if (e.key === 'Escape') { e.preventDefault(); editor.focus(); }
  });
  chapDup.addEventListener('click', () => {
    syncFromDom(); commitHistory();
    const c = doc.chapters[cur]; const i = c.blocks.findIndex((b) => D.blockText(b).trim());
    if (i >= 0 && c.blocks[i].t === 'h1') { c.blocks.splice(i, 1); if (!c.blocks.length) c.blocks.push({ t: 'p', runs: [] }); renderChapter(); markDirty(); updateStatus(); editor.focus(); placeCaretAtEnd(); kick(true); }
  });
  function renderChapter() {
    setLive(null);
    syncTitleLine();
    layoutMarks();
    if (readingBook()) {
      const multi = doc.chapters.length > 1;
      const sepName = (c) => (kindOf() === 'journal' ? D.chapterLabel(doc, c) : c.title.trim());
      editor.innerHTML = doc.chapters.map((c, i) => (multi ? '<div class="chapsep" data-ch="' + i + '" contenteditable="false">' + (sepName(c) ? sepName(c).replace(/&/g, '&amp;').replace(/</g, '&lt;') : '* * *') + '</div>' : '') + blocksToHtml(c.blocks)).join('');
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
  /* ---- where you left off: the last chapter and caret place of each book ---- */
  let welcomed = false, resumeNote = '';
  function resumeLoad(path) { try { return (JSON.parse(localStorage.getItem('resume') || '{}'))[path] || null; } catch (e) { return null; } }
  function resumeSave() {
    if (!filePath || !doc || reading || document.activeElement !== editor) return;
    const cp = caretPos();
    if (!cp) return;
    try {
      const m = JSON.parse(localStorage.getItem('resume') || '{}');
      m[filePath] = { cid: doc.chapters[cur].id, pos: cp.f, t: Date.now() };
      const keys = Object.keys(m);
      if (keys.length > 40) keys.sort((a, b) => m[a].t - m[b].t).slice(0, keys.length - 40).forEach((k) => delete m[k]);
      localStorage.setItem('resume', JSON.stringify(m));
    } catch (e) { /* storage unavailable: just open at the end next time */ }
  }
  let resumeTimer;
  const resumeSoon = () => { clearTimeout(resumeTimer); resumeTimer = setTimeout(resumeSave, 1200); };
  let nbPage = null; // the notebook page being edited, or null while the list shows
  function loadDoc(d, path, opts) {
    opts = opts || {};
    doc = d;
    nbPage = null;
    let resumeAt = null;
    if (opts.resume && path && !readingBook()) {
      const r = resumeLoad(path);
      const i = r ? d.chapters.findIndex((c) => c.id === r.cid) : -1;
      if (i >= 0) resumeAt = { i, pos: r.pos };
    }
    cur = resumeAt ? resumeAt.i : d.kind === 'journal' ? d.chapters.length - 1 : 0; // a journal opens on its latest entry
    // a journal opened on a new day is ready for today's entry (an entry left empty is neither saved nor exported)
    if (d.kind === 'journal' && prefs.journalAuto !== false) {
      const last = d.chapters[d.chapters.length - 1];
      const dayOf = (iso) => D.dayKey(iso, prefs.journalDayStart);
      const filled = last.title.trim() || last.blocks.some((b) => D.blockText(b).trim());
      if (filled && last.at && dayOf(last.at) !== dayOf(new Date().toISOString())) { d.chapters.push(D.newEntry()); cur = d.chapters.length - 1; resumeAt = null; }
    }
    nameCache.t = 0;
    filePath = path || null;
    histories.clear();
    wordCounts = doc.chapters.map((c) => D.countWords(c.blocks));
    renderChapter();
    dirty = !!opts.dirty;
    if (!reading) { editor.focus(); if (resumeAt) placeCaretPos({ a: resumeAt.pos, f: resumeAt.pos }); else placeCaretAtEnd(); kick(true); }
    if (resumeAt) {
      const msg = doc.chapters.length > 1 ? 'Back where you stopped, in ' + chapterName(doc.chapters[cur]) + '.' : 'Back where you stopped.';
      if (welcomed) toast(msg, 3200); else resumeNote = msg;
    }
    renderOutline();
    $('#docTitle').value = doc.title || '';
    $('#docAuthor').value = doc.author || '';
    $('#docSubtitle').value = doc.subtitle || '';
    $('#docExtra').value = doc.extra || '';
    exportSel = null;
    updateFileHint();
    updateTitle();
    updateStatus();
    setSaveState(dirty ? 'Not saved yet' : path ? 'Saved' : '');
    setGoalBase();
  }
  function parseByExtension(path, text) {
    if (/\.draft$/i.test(path)) return { doc: D.parseDraft(text), path };
    if (/\.docx$/i.test(path)) return { doc: D.parseDraft(text), path: null, imported: true };
    return { doc: D.fromMarkdown(text, stem(path)), path: null, imported: true };
  }
  async function openResult(r) {
    if (!r) return;
    if (r.error) { await window.api.error(r.error); return; }
    try {
      const p = parseByExtension(r.path, r.text);
      loadDoc(p.doc, p.path, { dirty: !!p.imported, resume: true });
      if (p.imported) toast('Imported. Save to keep it as a .draft file.');
      setTimeout(checkCompanion, 600);
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
  // A journal entry is named by its date and time; a book has chapters, a single text has sections.
  const kindOf = () => (doc && doc.kind) || 'book';
  const unitWord = () => ({ journal: 'Entry', text: 'Section', book: 'Chapter' })[kindOf()];
  const chapterName = (c) => (kindOf() === 'journal' ? D.chapterLabel(doc, c) : c.title.trim() || chapterHeading(c));
  function docTitle() {
    if (kindOf() === 'journal') return (doc.title || '').trim() || 'Journal';
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
    const comp = await syncCompanion();
    toast((mode === 'as' ? 'Saved as ' + baseName(r.path) : 'Saved') + (comp === 'ok' ? ', Word copy updated' : ''));
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
    adoptTitle();
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
  /* ---- new book: blank or a starting structure ---- */
  let tplDone = null;
  function newFromTemplate(t) {
    const d = window.Templates.build(D, t.id);
    if (d.kind === 'journal') {
      if (D.DATE_FMTS.indexOf(prefs.journalDate) > 0) d.dateFmt = prefs.journalDate;
      if (D.TIME_FMTS.indexOf(prefs.journalTime) > 0) d.timeFmt = prefs.journalTime;
    }
    return d;
  }
  // Resolves to a template, 'open' (the person wants to open a file instead) or null.
  function pickTemplate(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const dlg = $('#tplDlg'), list = $('#tplList');
      list.innerHTML = '';
      const finish = (t) => { dlg.hidden = true; tplDone = null; resolve(t); };
      window.Templates.groups.forEach((g) => {
        const h = document.createElement('h3'); h.textContent = g.name; list.appendChild(h);
        if (g.kind !== 'journal') { const p = document.createElement('p'); p.className = 'grp'; p.textContent = g.desc; list.appendChild(p); }
        window.Templates.list.filter((t) => t.kind === g.kind).forEach((t) => {
          if (g.kind === 'journal') return; // the journal has one starting point: the group itself
          const b = document.createElement('button');
          b.type = 'button';
          b.innerHTML = '<strong></strong><small></small>';
          b.firstChild.textContent = t.name;
          b.lastChild.textContent = t.desc;
          b.addEventListener('click', () => finish(t));
          list.appendChild(b);
        });
        if (g.kind === 'journal') {
          const t = window.Templates.list.find((x) => x.kind === 'journal');
          const b = document.createElement('button'); b.type = 'button';
          b.innerHTML = '<strong></strong><small></small>'; b.firstChild.textContent = t.name; b.lastChild.textContent = t.desc;
          b.addEventListener('click', () => finish(t)); list.appendChild(b);
        }
      });
      $('#tplCancel').textContent = opts.resumed ? 'Back to my writing' : opts.start ? 'Not now' : 'Cancel';
      tplDone = finish;
      dlg.hidden = false;
      list.querySelector('button').focus();
    });
  }
  $('#tplCancel').addEventListener('click', () => { if (tplDone) tplDone(null); });
  $('#tplOpen').addEventListener('click', () => { if (tplDone) tplDone('open'); });
  async function doNew() {
    if (!(await confirmDiscard())) return;
    const t = await pickTemplate();
    if (t === 'open') { await doOpen(true); return; }
    if (!t) { if (!reading) editor.focus(); return; }
    if (filePath) await autosave();
    window.api.recoveryClear();
    loadDoc(newFromTemplate(t), null);
  }
  async function doOpen(confirmed) {
    if (!confirmed && !(await confirmDiscard())) return;
    if (filePath && dirty) await autosave();
    const p = await pickFile({ mode: 'open', kind: 'doc', title: 'Open', exts: ['.draft', '.md', '.markdown', '.txt', '.docx'], startDir: filePath ? dirOf(filePath) : '' });
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

  /* ============================ writing calendar and pace ============================ */
  function daysLoad() { try { return JSON.parse(localStorage.getItem('days') || '{}'); } catch (e) { return {}; } }
  // Words written today, kept per day (and per book) so the calendar can show the last weeks.
  function logDay() {
    if (!doc) return;
    try {
      const days = daysLoad(), t = todayKey(), key = filePath || 'untitled';
      const net = wordsToday();
      if (net <= 0 && !(days[t] && days[t][key])) return;
      days[t] = Object.assign(days[t] || {}, { [key]: net });
      const keys = Object.keys(days).sort();
      keys.slice(0, Math.max(0, keys.length - 400)).forEach((k) => delete days[k]);
      localStorage.setItem('days', JSON.stringify(days));
    } catch (e) { /* storage unavailable: the calendar just stays empty */ }
  }
  const dayTotal = (d) => Object.keys(d || {}).reduce((a, k) => a + (d[k] || 0), 0);
  function renderDayGrid() {
    const grid = $('#dayGrid');
    if (!grid) return;
    const days = daysLoad();
    const WEEKS = 12;
    const dow = (new Date().getDay() + 6) % 7; // Monday is the first row
    const cells = [];
    let max = 0, last7 = 0, best = 0, bestKey = '';
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const off = (w - (WEEKS - 1)) * 7 + (d - dow);
        if (off > 0) { cells.push({ off, fut: true }); continue; }
        const k = dayKey(off), n = dayTotal(days[k]);
        cells.push({ off, k, n });
        max = Math.max(max, n);
        if (off > -7) last7 += n;
        if (n > best) { best = n; bestKey = k; }
      }
    }
    const ref = prefs.goal > 0 ? prefs.goal : Math.max(200, max);
    const fmt = (k) => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };
    grid.innerHTML = '';
    cells.forEach((c) => {
      const i = document.createElement('i');
      i.setAttribute('aria-hidden', 'true');
      if (c.fut) i.className = 'fut';
      else {
        const lvl = c.n <= 0 ? 0 : c.n >= ref ? 4 : c.n >= ref * 0.5 ? 3 : c.n >= ref * 0.25 ? 2 : 1;
        i.className = (lvl ? 'l' + lvl : '') + (c.off === 0 ? ' today' : '');
        i.title = fmt(c.k) + ': ' + c.n.toLocaleString() + (c.n === 1 ? ' word' : ' words');
      }
      grid.appendChild(i);
    });
    const note = best > 0 ? 'Last 7 days: ' + last7.toLocaleString() + ' words. Best day: ' + best.toLocaleString() + ' words on ' + fmt(bestKey) + '.' : 'Nothing logged yet. The days you write will fill in here.';
    $('#dayNote').textContent = note;
    grid.setAttribute('aria-label', 'Writing calendar, last twelve weeks. ' + note);
  }
  // How many words a day it takes to reach the book target by the finish date.
  function paceInfo() {
    if (kindOf() === 'journal') return null;
    const target = prefs.bookGoal, by = prefs.finishBy;
    if (!(target > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(by || '')) return null;
    const p = by.split('-').map(Number);
    const end = new Date(p[0], p[1] - 1, p[2]);
    const t0 = new Date();
    const today = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate());
    const left = Math.round((end - today) / 864e5) + 1; // today counts
    const remaining = target - totalWords();
    const dateText = end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    if (remaining <= 0) return { done: true, text: 'You have reached your target.' };
    if (left < 1) return { late: true, text: 'The finish date has passed. ' + remaining.toLocaleString() + ' words to go.' };
    const per = Math.ceil(remaining / left);
    return {
      per,
      text: 'About ' + per.toLocaleString() + ' words a day. ' + left + (left === 1 ? ' day' : ' days') + ' left, ' + remaining.toLocaleString() + ' words to go.',
      short: 'To finish by ' + dateText + ', about ' + per.toLocaleString() + ' words a day.',
    };
  }
  function updatePace() {
    const n = $('#paceNote');
    if (!n) return;
    const pc = paceInfo();
    n.textContent = pc ? pc.text : (prefs.finishBy && !(prefs.bookGoal > 0) ? 'Set a book target above to see the daily pace.' : '');
  }

  const sessionBase = {};
  function sessionWords() { const k = filePath || 'untitled'; if (sessionBase[k] === undefined) sessionBase[k] = totalWords(); return Math.max(0, totalWords() - sessionBase[k]); }
  // A day counts when the daily goal is reached; the streak is the run of such days in a row.
  function recordGoalDay() {
    const st = prefs.streak || { last: '', count: 0, best: 0 };
    const today = todayKey();
    if (st.last === today) return;
    const count = st.last === dayKey(-1) ? st.count + 1 : 1;
    savePrefs({ streak: { last: today, count, best: Math.max(st.best || 0, count) } });
    cheerOnce('goal', 'goal');
  }
  function streakNow() {
    const st = prefs.streak || { last: '', count: 0, best: 0 };
    return st.last === todayKey() || st.last === dayKey(-1) ? st.count : 0;
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
      const was = wordCounts[cur] || 0;
      wordCounts[cur] = t ? t.split(/\s+/).length : 0;
      const goal = doc && doc.chapters[cur] && doc.chapters[cur].goal;
      if (goal > 0 && was < goal && wordCounts[cur] >= goal && wordCounts[cur] - was < 50) cheerOnce('ch' + doc.chapters[cur].id, 'chapter'); // typed across the line, not opened already past it
      updateStatus();
      logDay();
    }, 250);
  }
  let selWords = 0, phLast = 0, selTimer;
  function updateStatus(selOnly) {
    if (!doc) return;
    const ch = doc.chapters[cur];
    const multi = doc.chapters.length > 1;
    const parts = [];
    if (multi || kindOf() === 'journal') parts.push(chapterName(ch) || unitWord() + ' ' + (cur + 1));
    const w = wordCounts[cur] || 0;
    parts.push(w.toLocaleString() + (w === 1 ? ' word' : ' words'));
    if (selWords > 0) parts.push(selWords.toLocaleString() + (selWords === 1 ? ' word selected' : ' words selected'));
    if (multi) parts.push(totalWords().toLocaleString() + ' in total');
    if (prefs.showSession) parts.push('+' + sessionWords().toLocaleString() + ' this session');
    if (prefs.goal > 0) {
      const wt = wordsToday();
      if (wt >= prefs.goal) recordGoalDay();
      parts.push(wt.toLocaleString() + ' / ' + prefs.goal.toLocaleString() + ' today');
      const sn = streakNow();
      if (sn >= 2) parts.push(sn + ' day streak');
    }
    const ph = selOnly === true ? phLast : (phLast = placeholderCount());
    if (ph) parts.push(ph + ' to fill');
    if (sprint) parts.push(sprint.last ? 'sprint: last minute' : 'sprint');
    $('#statusLeft').textContent = parts.join(' · ');
    updateBookTotal();
  }


  // The status line counts the words you have selected.
  function selSoon() {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = getSelection();
      let n = 0;
      if (sel.rangeCount && !sel.isCollapsed && editor.contains(sel.anchorNode) && editor.contains(sel.focusNode)) {
        const t = sel.toString().trim();
        n = t ? t.split(/\s+/).length : 0;
      }
      if (n !== selWords) { selWords = n; updateStatus(true); }
    }, 120);
  }

  /* ============================ placeholders: TK and [[ ]] ============================ */
  // Type TK or [[what you need]] where you do not know something, keep writing, and come back with Ctrl+J.
  const PH_RE = /\bTK\b|\[\[[^\]\n]*\]\]/g;
  const phCount = (t) => { const m = t.match(PH_RE); return m ? m.length : 0; };
  const phTextOf = (c) => c.blocks.map((b) => D.blockText(b)).join('\n');
  const phCache = new WeakMap();
  function placeholderCount() {
    if (!doc) return 0;
    let n = 0;
    doc.chapters.forEach((c, i) => {
      if (i === cur && !reading) { n += phCount(editor.innerText); return; }
      let v = phCache.get(c.blocks);
      if (v === undefined) { v = phCount(phTextOf(c)); phCache.set(c.blocks, v); }
      n += v;
    });
    return n;
  }
  function phMatches() {
    const out = [];
    Array.prototype.forEach.call(editor.children, (blk, b) => {
      const t = blk.textContent;
      PH_RE.lastIndex = 0;
      let m;
      while ((m = PH_RE.exec(t))) out.push({ b, s: m.index, e: m.index + m[0].length });
    });
    return out;
  }
  function phSelect(m) {
    const rg = rangeAt(editor.children[m.b], m.s, m.e);
    if (!rg) return false;
    editor.focus();
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(rg);
    kick(true);
    return true;
  }
  function jumpPlaceholder(dir) {
    if (!doc || reading) return;
    dir = dir < 0 ? -1 : 1;
    syncFromDom();
    if (!placeholderCount()) { toast('Nothing left to fill in. Type TK or [[ ]] where you need to come back.', 3200); return; }
    const cp = caretPos();
    const lo = cp ? (cp.a.b < cp.f.b || (cp.a.b === cp.f.b && cp.a.o <= cp.f.o) ? cp.a : cp.f) : { b: 0, o: 0 };
    const hi = cp ? (lo === cp.a ? cp.f : cp.a) : { b: 0, o: 0 };
    const here = phMatches();
    const after = (m) => m.b > hi.b || (m.b === hi.b && m.s >= hi.o);
    const before = (m) => m.b < lo.b || (m.b === lo.b && m.e <= lo.o);
    let pick = dir > 0 ? here.find(after) : here.slice().reverse().find(before);
    if (pick) { phSelect(pick); return; }
    const n = doc.chapters.length;
    for (let step = 1; step <= n; step++) {
      const j = ((cur + dir * step) % n + n) % n;
      if (j === cur) { if (here.length) phSelect(dir > 0 ? here[0] : here[here.length - 1]); return; }
      if (phCount(phTextOf(doc.chapters[j])) > 0) {
        selectChapter(j);
        const ms = phMatches();
        if (ms.length) phSelect(dir > 0 ? ms[0] : ms[ms.length - 1]);
        return;
      }
    }
  }

  /* ============================ name suggestions: Tab completes a name that keeps coming up ============================ */
  const nameCache = { t: 0, list: [] };
  function buildNames() {
    const counts = new Map();
    const scan = (t) => {
      const re = /(?<![\p{L}\p{N}'’])\p{Lu}\p{L}{5,}(?![\p{L}])/gu;
      let m;
      while ((m = re.exec(t))) {
        const before = t.slice(Math.max(0, m.index - 4), m.index).trimEnd();
        if (!before || !/[\p{Ll},;:\u2013\u2014-]$/u.test(before)) continue; // sentence starts do not count: that is just a capital letter
        counts.set(m[0], (counts.get(m[0]) || 0) + 1);
      }
    };
    doc.chapters.forEach((c, i) => scan(i === cur && !reading ? editor.innerText : phTextOf(c)));
    nameCache.list = Array.from(counts.entries()).filter((e) => e[1] >= 3).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    nameCache.t = Date.now();
  }
  let nameTip = null; // { node, off, add }
  function nameHide() { nameTip = null; $('#nameHint').hidden = true; }
  function nameHintCheckMoved() {
    if (!nameTip) return;
    const sel = getSelection();
    if (!sel.isCollapsed || sel.anchorNode !== nameTip.node || sel.anchorOffset !== nameTip.off) nameHide();
  }
  function nameHintUpdate() {
    nameHide();
    if (prefs.names === false || reading || !doc) return;
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed || sel.anchorNode.nodeType !== 3 || !editor.contains(sel.anchorNode)) return;
    const text = sel.anchorNode.nodeValue;
    if (/\p{L}/u.test(text.charAt(sel.anchorOffset))) return; // the caret is inside a word
    const m = /(?:^|[^\p{L}\p{N}'’])(\p{Lu}\p{L}{2,})$/u.exec(text.slice(0, sel.anchorOffset));
    if (!m) return;
    if (Date.now() - nameCache.t > 20000) buildNames();
    const prefix = m[1];
    const full = nameCache.list.find((w) => w.length > prefix.length && w.startsWith(prefix));
    if (!full) return;
    const h = $('#nameHint');
    h.innerHTML = 'Tab for <b></b>';
    h.querySelector('b').textContent = full;
    h.hidden = false;
    nameTip = { node: sel.anchorNode, off: sel.anchorOffset, add: full.slice(prefix.length) };
    nameHintPlace();
  }
  // Under the caret as it is drawn: while typing the line slides sideways, so this follows the drawn caret and not the real one.
  function nameHintPlace() {
    if (!nameTip) return;
    const h = $('#nameHint');
    const r = caretEl && liveEl ? caretEl.getBoundingClientRect() : caretRect();
    if (!r) return;
    const left = r.left, bottom = r.bottom != null ? r.bottom : (r.top || 0) + (r.height || 24);
    h.style.left = Math.max(8, Math.min(innerWidth - h.offsetWidth - 8, left)) + 'px';
    h.style.top = Math.min(innerHeight - h.offsetHeight - 8, bottom + 6) + 'px';
  }
  editor.addEventListener('blur', nameHide);
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || !nameTip || e.isComposing) return;
    e.preventDefault();
    const add = nameTip.add;
    nameHide();
    document.execCommand('insertText', false, add);
  });

  /* ============================ sprints ============================ */
  let sprint = null; // { end, mins, base, started, timer, last }
  function recountNow() {
    if (reading) return;
    const t = editor.innerText.trim();
    wordCounts[cur] = t ? t.split(/\s+/).length : 0;
  }
  function sprintUI() { const b = $('#btnSprint'); if (b) b.textContent = sprint ? 'Stop' : 'Start'; }
  const wordsLabel = (n) => n.toLocaleString() + (n === 1 ? ' word' : ' words');
  function endSprint(early) {
    if (!sprint) return;
    clearInterval(sprint.timer);
    const s = sprint;
    sprint = null;
    recountNow();
    const w = Math.max(0, totalWords() - s.base);
    const mins = Math.max(1, Math.round((Date.now() - s.started) / 60000));
    toast(early ? 'Sprint stopped. ' + wordsLabel(w) + ' in ' + mins + (mins === 1 ? ' minute.' : ' minutes.') : 'Time. ' + wordsLabel(w) + ' in ' + s.mins + ' minutes. Nicely done.', 6500);
    sprintUI(); updateStatus();
  }
  function startSprint() {
    if (!doc) return;
    if (sprint) { endSprint(true); return; }
    const mins = Math.max(1, parseInt(prefs.sprintMin, 10) || 20);
    recountNow();
    sprint = { mins, started: Date.now(), end: Date.now() + mins * 60000, base: totalWords(), last: false, timer: 0 };
    sprint.timer = setInterval(() => {
      if (!sprint) return;
      const left = sprint.end - Date.now();
      if (left <= 0) { endSprint(false); return; }
      if (left <= 60000 && !sprint.last) { sprint.last = true; updateStatus(); }
    }, 1000);
    closePanels();
    toast('Sprint started: ' + mins + ' minutes. Just write.', 3200);
    sprintUI(); updateStatus();
    if (!reading) editor.focus();
  }
  $('#btnSprint').addEventListener('click', startSprint);

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
    el = el && el.closest('p,h1,h2,h3,h4,blockquote,div');
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
  /* ---- focus: everything but the paragraph (or sentence) being written is dimmed ---- */
  // Uses the CSS Custom Highlight API, so the text itself is never touched.
  function offsetIn(block, node, off) {
    let n = 0;
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { if (w.currentNode === node) return n + off; n += w.currentNode.nodeValue.length; }
    return n;
  }
  function rangeAt(root, a, b) {
    if (!(a < b)) return null;
    const r = document.createRange();
    let n = 0, s0 = false;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = w.currentNode, len = t.nodeValue.length;
      if (!s0 && a <= n + len) { r.setStart(t, a - n); s0 = true; }
      if (s0 && b <= n + len) { r.setEnd(t, b - n); return r; }
      n += len;
    }
    return null;
  }
  // the sentence around position pos in txt: [start, end)
  function sentenceBounds(txt, pos) {
    const re = /[.!?\u2026]+["'\u201d\u2019)\]]*(?=\s|$)/g;
    let start = 0, end = txt.length, m;
    while ((m = re.exec(txt))) {
      const e = m.index + m[0].length;
      if (e < pos) { const ws = /^\s*/.exec(txt.slice(e))[0].length; start = Math.min(pos, e + ws); }
      else { end = e; break; }
    }
    return [start, Math.max(start, end)];
  }
  function applyFocus() {
    if (!hasHL) return;
    const mode = prefs.focus || 'off';
    const sel = getSelection();
    const blk = currentBlock();
    if (mode === 'off' || reading || review || document.activeElement !== editor || !blk || !sel.rangeCount) { CSS.highlights.delete('focusdim'); return; }
    const ranges = [];
    const pre = document.createRange(); pre.setStart(editor, 0); pre.setEndBefore(blk); if (!pre.collapsed) ranges.push(pre);
    const post = document.createRange(); post.setStartAfter(blk); post.setEnd(editor, editor.childNodes.length); if (!post.collapsed) ranges.push(post);
    if (mode === 'sentence') {
      const txt = (() => { let t = ''; const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT); while (w.nextNode()) t += w.currentNode.nodeValue; return t; })();
      const [a, b] = sentenceBounds(txt, offsetIn(blk, sel.anchorNode, sel.anchorOffset));
      const roots = [blk];
      if (liveEl === blk && textEl && textEl.firstElementChild) roots.push(textEl.firstElementChild); // the sliding copy of the line
      for (const root of roots) for (const rg of [rangeAt(root, 0, a), rangeAt(root, b, txt.length)]) if (rg) ranges.push(rg);
    }
    CSS.highlights.set('focusdim', new Highlight(...ranges));
  }
  editor.addEventListener('blur', () => { if (hasHL) CSS.highlights.delete('focusdim'); });
  editor.addEventListener('focus', () => applyFocus());
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
      if (prefs.focus === 'sentence') applyFocus();
    }
    textEl.style.setProperty('--bt', top + 'px');
    textEl.style.setProperty('--bb', (top + lh) + 'px');
    liveEl.style.setProperty('--bt', top + 'px');
    liveEl.style.setProperty('--bb', (top + lh) + 'px');
    caretEl.style.left = (r.left - lr.left) + 'px';
    caretEl.style.top = (r.top - lr.top) + 'px';
    caretEl.style.height = r.height + 'px';
    if (prefs.caret === 'underline') { caretEl.style.height = '2px'; caretEl.style.top = (r.top - lr.top + r.height - 3) + 'px'; }
    wrapEl.style.transform = shiftX ? 'translateX(' + Math.round(shiftX) + 'px)' : '';
    if (nameTip) nameHintPlace();
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
    editor.querySelectorAll('p,h1,h2,h3,h4,blockquote').forEach((el) => {
      if (el.classList.contains('live')) return;
      if (el.hasAttribute('style') && !el.style.cssText.trim()) el.removeAttribute('style');
      if (el.hasAttribute('class') && !el.className.trim()) el.removeAttribute('class');
      if (el.tagName !== 'BLOCKQUOTE' && el.classList.contains('cite')) el.classList.remove('cite');
      if (el.tagName !== 'P' && el.classList.contains('poem')) el.classList.remove('poem');
      if (el.classList.contains('poem') && el.classList.contains('sbreak')) el.classList.remove('poem');
    });
  }
  function setBlock(kind) {
    if (reading) return;
    editor.focus();
    commitHistory();
    if (/^h[34]$/.test(kind) && +kind[1] > headingDepth()) return;
    const tag = /^h[1-4]$/.test(kind) ? kind.toUpperCase() : 'BLOCKQUOTE';
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
  const inPoem = () => { const b = currentBlock(); return !!(b && b.tagName === 'P' && b.classList.contains('poem')); };
  // Poem on or off for the paragraph (or paragraphs) the caret is in.
  function togglePoem() {
    if (reading) return;
    editor.focus(); commitHistory();
    const on = !inPoem();
    if (inQuote()) { document.execCommand('formatBlock', false, 'p'); if (inQuote()) document.execCommand('outdent'); }
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const blocks = [...editor.querySelectorAll('p,h1,h2,h3,h4,blockquote')].filter((el) => sel.containsNode(el, true));
    const targets = blocks.length ? blocks : [currentBlock()].filter(Boolean);
    const caretBlock = currentBlock();
    if (on && targets.length > 1) {
      // several paragraphs become one stanza: their lines are joined, a blank paragraph (or a heading) starts the next stanza
      let group = [];
      const flush = () => {
        if (group.length) {
          const first = group[0];
          group.slice(1).forEach((el) => { first.appendChild(document.createElement('br')); while (el.firstChild) first.appendChild(el.firstChild); el.remove(); });
          first.querySelectorAll('br + br').forEach((x) => { if (!x.nextSibling) x.remove(); });
          first.classList.remove('sbreak', 'cite'); first.classList.add('poem');
        }
        group = [];
      };
      targets.forEach((el) => {
        const blank = !el.textContent.trim();
        if (blank || /^H[1-6]$/.test(el.tagName)) { flush(); if (blank && el !== caretBlock) el.remove(); return; }
        if (el.tagName !== 'P') { const p = document.createElement('p'); p.innerHTML = el.innerHTML; el.replaceWith(p); el = p; }
        group.push(el);
      });
      flush();
    } else targets.forEach((el) => {
      if (on && el.tagName !== 'P') { const p = document.createElement('p'); p.innerHTML = el.innerHTML; el.replaceWith(p); el = p; }
      if (el.tagName === 'P') { el.classList.remove('sbreak', 'cite'); el.classList.toggle('poem', on); }
    });
    cleanBlocks();
    afterEdit();
  }
  function command(cmd) {
    if (cmd === 'note') return addNote();
    if (reading) return;
    if (cmd === 'break') return insertBreak();
    if (cmd === 'poem') return togglePoem();
    editor.focus();
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') { document.execCommand(cmd); afterEdit(); }
    else setBlock(cmd);
  }
  // A scene break: a centered * * * between two parts of a chapter. The caret lands in a fresh paragraph after it.
  function insertBreak() {
    if (reading || !doc) return;
    editor.focus(); commitHistory();
    const b = currentBlock();
    const brk = document.createElement('p'); brk.className = 'sbreak'; brk.textContent = '* * *';
    const next = document.createElement('p'); next.innerHTML = '<br>';
    if (!b) editor.append(brk, next);
    else if (!b.textContent.trim()) { b.replaceWith(brk); brk.after(next); }
    else { b.after(brk); brk.after(next); }
    const r = document.createRange(); r.setStart(next, 0); r.collapse(true);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    afterEdit();
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
    set('h3', b && b.tagName === 'H3');
    set('h4', b && b.tagName === 'H4');
    set('quote', inQuote());
    set('poem', inPoem());
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
  const NOTE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z"/></svg>';
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
    renderFindList();
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
    refreshFind(false); renderFindList();
    fIn.focus();
    toast(total ? 'Replaced ' + total + (total === 1 ? ' match' : ' matches') : 'No matches to replace');
  }
  // every match in a list: the chapter, and a bit of the sentence around it. A click goes there.
  function renderFindList() {
    const ul = $('#findResults');
    if (ul.hidden) return;
    ul.innerHTML = '';
    const re = findRegex();
    if (!re) return;
    syncFromDom();
    const chapters = find.all ? doc.chapters.map((c, i) => i) : [cur];
    let shown = 0, total = 0;
    for (const i of chapters) {
      let k = 0;
      for (const b of doc.chapters[i].blocks) {
        const text = D.blockText(b);
        const r2 = new RegExp(re.source, re.flags);
        let m;
        while ((m = r2.exec(text))) {
          if (m[0] === '') { r2.lastIndex++; continue; }
          total++;
          if (shown < 200) {
            shown++;
            const li = document.createElement('li'); li.tabIndex = 0;
            const a = Math.max(0, m.index - 34), z = Math.min(text.length, m.index + m[0].length + 34);
            const small = document.createElement('small'); small.textContent = doc.chapters.length > 1 ? (chapterName(doc.chapters[i]) || unitWord() + ' ' + (i + 1)) : '';
            const mark = document.createElement('mark'); mark.textContent = m[0];
            if (small.textContent) li.appendChild(small);
            li.append((a > 0 ? '\u2026' : '') + text.slice(a, m.index), mark, text.slice(m.index + m[0].length, z) + (z < text.length ? '\u2026' : ''));
            const ci = i, kk = k;
            const go = () => { if (ci !== cur) { selectChapter(ci); find.anchor = null; } refreshFind(false); goToMatch(kk); if (!reading) fIn.focus(); };
            li.addEventListener('click', go);
            li.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
            ul.appendChild(li);
          }
          k++;
        }
      }
    }
    if (total > shown) { const li = document.createElement('li'); li.className = 'more'; li.textContent = (total - shown) + ' more not listed'; ul.appendChild(li); }
    if (!total) { const li = document.createElement('li'); li.className = 'more'; li.textContent = 'No matches'; ul.appendChild(li); }
  }
  $('#findList').addEventListener('click', () => {
    const ul = $('#findResults');
    ul.hidden = !ul.hidden;
    $('#findList').setAttribute('aria-pressed', String(!ul.hidden));
    renderFindList();
  });
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
  fIn.addEventListener('input', () => { find.anchor = null; refreshFind(false); renderFindList(); });
  fIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); } });
  rIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } });
  $('#findNext').addEventListener('click', () => stepFind(1));
  $('#findPrev').addEventListener('click', () => stepFind(-1));
  $('#findClose').addEventListener('click', closeFind);
  $('#replaceOne').addEventListener('click', replaceOne);
  $('#replaceAll').addEventListener('click', replaceAll);
  $('#findCase').addEventListener('click', () => { find.matchCase = !find.matchCase; $('#findCase').setAttribute('aria-pressed', String(find.matchCase)); refreshFind(false); renderFindList(); });
  $('#findAllChapters').addEventListener('change', (e) => { find.all = e.target.checked; updateFindCount(); renderFindList(); });

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
    speakStop();
    if (on && review) setReview(false);
    if (on) syncFromDom();
    reading = on;
    syncTitleLine();
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


  /* ============================ read aloud (reading mode) ============================ */
  let speaking = null; // { items, i }
  function speakStop() {
    if (speaking) { speaking = null; try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    const b = $('#readListen');
    if (b) b.textContent = 'Listen';
  }
  function speakStart() {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') { toast('This computer has no speech voices to read with.', 3600); return; }
    const items = Array.prototype.filter.call(editor.children, (el) => el.textContent.trim());
    if (!items.length) return;
    // start where you are reading: the first paragraph that is still on screen
    let i = items.findIndex((el) => el.getBoundingClientRect().bottom > 90);
    if (i < 0) i = 0;
    const s = { items, i };
    speaking = s;
    $('#readListen').textContent = 'Stop';
    const step = () => {
      if (speaking !== s) return;
      if (s.i >= s.items.length) { speakStop(); return; }
      const el = s.items[s.i++];
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ }
      const u = new SpeechSynthesisUtterance(el.textContent.trim());
      u.onend = step;
      u.onerror = (ev) => {
        if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return;
        speakStop();
        toast('Could not read aloud. Check that Windows has a speech voice installed.', 4200);
      };
      window.speechSynthesis.speak(u);
    };
    step();
  }
  $('#readListen').addEventListener('click', () => { if (speaking) speakStop(); else speakStart(); });

  /* ============================ chapters ============================ */
  function selectChapter(i) {
    if (i < 0 || i >= doc.chapters.length || (i === cur && !readingBook())) return;
    speakStop();
    commitHistory();
    syncFromDom();
    cur = i;
    nameCache.t = 0;
    renderChapter();
    renderOutline();
    updateStatus();
    if (!reading) { editor.focus(); placeCaretAtEnd(); kick(true); }
  }
  let memoOpen = null; // the chapter whose note is open in the menu
  function renderOutline() {
    const ol = $('#chapterList');
    ol.innerHTML = '';
    const order = doc.chapters.map((c, i) => i);
    if (kindOf() === 'journal') order.reverse(); // newest entry first
    order.forEach((i) => {
      const c = doc.chapters[i];
      const li = document.createElement('li');
      if (i === cur) li.className = 'current';
      const num = document.createElement('span'); num.className = 'num'; num.textContent = i + 1;
      const inp = document.createElement('input');
      inp.value = c.title; inp.placeholder = kindOf() === 'journal' ? 'Title (optional)' : chapterHeading(c) || 'Untitled ' + unitWord().toLowerCase(); inp.setAttribute('aria-label', unitWord() + ' ' + (i + 1) + ' title');
      inp.addEventListener('focus', () => { if (i !== cur) selectChapter(i); });
      inp.addEventListener('input', () => { c.title = inp.value; markDirty(); updateStatus(); if (i === cur) syncTitleLine(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); closeOutline(); } });
      // the word count doubles as the chapter's target: click it to set one (empty or 0 removes it)
      const goal = c.goal > 0 ? c.goal : 0, count = wordCounts[i] || 0;
      const wc = document.createElement('button'); wc.type = 'button'; wc.className = 'wc';
      wc.textContent = count.toLocaleString() + (goal ? ' / ' + goal.toLocaleString() : '') + ' words';
      wc.title = goal ? 'Chapter target. Click to change it.' : 'Click to set a word target for this chapter.';
      wc.addEventListener('click', (e) => {
        e.stopPropagation();
        const g = document.createElement('input'); g.type = 'number'; g.min = 0; g.max = 2000000; g.step = 100; g.className = 'ch-goal';
        g.value = goal || ''; g.placeholder = 'Target words'; g.setAttribute('aria-label', 'Word target for chapter ' + (i + 1) + ', empty removes it');
        wc.replaceWith(g); g.focus(); g.select();
        let done = false;
        const commit = () => { if (done) return; done = true; const v = Math.max(0, Math.min(2000000, Math.floor(+g.value || 0))); if (v) c.goal = v; else delete c.goal; markDirty(); renderOutline(); };
        g.addEventListener('blur', commit);
        g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done = true; renderOutline(); } });
      });
      // Drawn icons instead of text characters: the glyphs of #, arrows and the cross differ in size and baseline between fonts, which made the row look uneven.
      const ICON = (d, slash) => '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="' + d + '"/>' + (slash ? '<path class="slash" d="M2.5 13.5L13.5 2.5"/>' : '') + '</svg>';
      const mk = (label, title, fn, dis) => { const b = document.createElement('button'); b.type = 'button'; if (label.charAt(0) === '<') b.innerHTML = label; else b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.disabled = !!dis; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
      const hasMemo = !!(c.memo && c.memo.trim());
      const cn = mk(ICON('M3.5 2.5h9v11h-9zM5.8 6h4.4M5.8 8.6h4.4M5.8 11h2.6'), hasMemo ? 'Notes for this chapter (there is a note). Never exported or counted.' : 'Add a note to this chapter. Never exported or counted.', () => { memoOpen = memoOpen === c.id ? null : c.id; renderOutline(); if (memoOpen) { const t = $$('#chapterList .ch-memo textarea')[0]; if (t) t.focus(); } });
      cn.className = 'cn' + (hasMemo ? ' has' : ''); cn.setAttribute('aria-expanded', String(memoOpen === c.id));
      const nb = mk(ICON('M6.2 2.5L5 13.5M11 2.5L9.8 13.5M2.8 6h10.6M2.6 10h10.6', true), c.nonum ? 'Page numbers are hidden on this chapter. Click to show them.' : 'Page numbers are shown on this chapter. Click to hide them (the pages are still counted).', () => { c.nonum = !c.nonum; if (!c.nonum) delete c.nonum; markDirty(); renderOutline(); });
      nb.className = 'pn' + (c.nonum ? ' off' : ''); nb.setAttribute('aria-pressed', String(!c.nonum));
      // two lines: the title has the whole width, the word count and the tools sit under it
      const top = document.createElement('div'); top.className = 'ch-top'; top.append(num, inp);
      const tools = document.createElement('div'); tools.className = 'ch-tools';
      tools.append(wc, cn, nb,
        mk(ICON('M8 13V3M3.6 7.4L8 3l4.4 4.4'), 'Move chapter up', () => moveChapter(i, -1), i === 0),
        mk(ICON('M8 3v10M3.6 8.6L8 13l4.4-4.4'), 'Move chapter down', () => moveChapter(i, 1), i === doc.chapters.length - 1),
        mk(ICON('M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6'), 'Delete chapter', () => deleteChapter(i), doc.chapters.length < 2));
      if (kindOf() === 'journal') {
        nb.remove();
        tools.querySelectorAll('button[title^="Move"]').forEach((b) => b.remove()); // entries stay in the order they were written
        num.textContent = '';
        const when = document.createElement('button'); when.type = 'button'; when.className = 'when'; when.textContent = c.at ? D.stampFor(doc, c.at) : 'Set date';
        when.title = 'Change the date and time of this entry'; when.setAttribute('aria-label', 'Entry date ' + when.textContent + '. Change it.');
        when.addEventListener('click', (ev) => { ev.stopPropagation(); editEntryDate(i, when); });
        top.insertBefore(when, inp);
      }
      const uw = unitWord().toLowerCase();
      tools.querySelectorAll('button').forEach((b) => { b.title = b.title.replace('chapter', uw); if (b.getAttribute('aria-label')) b.setAttribute('aria-label', b.getAttribute('aria-label').replace('chapter', uw)); });
      li.append(top, tools);
      if (memoOpen === c.id) {
        const box = document.createElement('div'); box.className = 'ch-memo';
        const ta = document.createElement('textarea'); ta.maxLength = 100000; ta.value = c.memo || ''; ta.rows = 4;
        ta.placeholder = 'Notes for this ' + uw + '. They are never exported or counted.'; ta.setAttribute('aria-label', 'Notes for ' + uw + ' ' + (i + 1));
        ta.addEventListener('input', () => {
          if (ta.value.trim()) c.memo = ta.value; else delete c.memo;
          cn.classList.toggle('has', !!ta.value.trim()); markDirty();
        });
        box.appendChild(ta); li.appendChild(box);
      }
      // books and texts: drag the number to move a chapter (the arrow buttons stay for the keyboard)
      if (kindOf() !== 'journal' && doc.chapters.length > 1) {
        num.draggable = true; num.classList.add('grab'); num.title = 'Drag to move';
        num.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'quire-chapter'); e.dataTransfer.setDragImage(li, 12, 12); li.classList.add('dragging'); });
        const clearMarks = () => ol.querySelectorAll('.dragging,.drop-before,.drop-after').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after'));
        // where the dragged chapter would land: before or after this one, by which half the pointer is in; a line shows the gap
        const gapAt = (e) => { const r = li.getBoundingClientRect(); return e.clientY > r.top + r.height / 2 ? i + 1 : i; };
        num.addEventListener('dragend', () => { dragFrom = null; clearMarks(); });
        li.addEventListener('dragover', (e) => {
          if (dragFrom === null) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          ol.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
          const gap = gapAt(e);
          if (gap !== dragFrom && gap !== dragFrom + 1) li.classList.add(gap === i ? 'drop-before' : 'drop-after'); // no line where the chapter already is
        });
        li.addEventListener('dragleave', (e) => { if (!li.contains(e.relatedTarget)) li.classList.remove('drop-before', 'drop-after'); });
        li.addEventListener('drop', (e) => {
          if (dragFrom === null) return;
          e.preventDefault();
          const from = dragFrom, gap = gapAt(e); dragFrom = null; clearMarks();
          moveChapterTo(from, gap > from ? gap - 1 : gap);
        });
      }
      if (goal) {
        const pct = Math.min(100, Math.round((count / goal) * 100));
        const bar = document.createElement('div'); bar.className = 'ch-bar' + (count >= goal ? ' done' : '');
        bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(goal)); bar.setAttribute('aria-valuenow', String(Math.min(count, goal)));
        bar.setAttribute('aria-label', 'Chapter ' + (i + 1) + ' progress: ' + pct + ' percent of its target');
        const fill = document.createElement('i'); fill.style.width = pct + '%'; bar.appendChild(fill); li.appendChild(bar);
      }
      li.addEventListener('click', (e) => { if (e.target === li || e.target === num || e.target === wc || e.target === top || e.target === tools) selectChapter(i); });
      // a table of contents of the chapter: its headings, a click goes there
      const heads = [];
      let first = true;
      for (const b of c.blocks) {
        const t = D.blockText(b).trim();
        if (!t) continue;
        const nameLine = first && !c.title.trim() && b.t === 'h1'; // this heading already is the chapter's name
        first = false;
        if (/^h[1-4]$/.test(b.t) && !nameLine) heads.push({ t, level: b.t });
      }
      if (heads.length) {
        const toc = document.createElement('ul'); toc.className = 'toc';
        heads.forEach((h, k) => {
          const hi = document.createElement('li');
          const hb = document.createElement('button'); hb.type = 'button'; hb.className = 'lv-' + h.level; hb.textContent = h.t; hb.title = h.t;
          hb.addEventListener('click', (e) => { e.stopPropagation(); goToHeading(i, c, k); });
          hi.appendChild(hb); toc.appendChild(hi);
        });
        li.appendChild(toc);
      }
      ol.appendChild(li);
    });
    updateBookTotal();
    syncTitleLine();
    applyKind();
  }
  // Change when an entry was written. The entries stay in date order, so the entry moves to where its new date belongs.
  function editEntryDate(i, btn) {
    const c = doc.chapters[i];
    const p2 = (n) => String(n).padStart(2, '0');
    const t = c.at ? new Date(c.at) : new Date();
    const inp = document.createElement('input'); inp.type = 'datetime-local'; inp.className = 'when-edit';
    inp.value = t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate()) + 'T' + p2(t.getHours()) + ':' + p2(t.getMinutes());
    inp.setAttribute('aria-label', 'Date and time of this entry');
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      const v = new Date(inp.value);
      if (save && inp.value && !isNaN(v.getTime())) redateEntry(i, v.toISOString()); else renderOutline();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
    inp.addEventListener('blur', () => finish(true));
    const title = btn.parentNode.querySelector('input'); if (title) title.style.display = 'none'; // the date gets the whole row while it is edited
    btn.replaceWith(inp); inp.focus();
  }
  function redateEntry(i, iso) {
    syncFromDom();
    const keepId = doc.chapters[cur].id;
    doc.chapters[i].at = iso;
    const idx = doc.chapters.map((c, k) => k).sort((x, y) => (doc.chapters[x].at || '').localeCompare(doc.chapters[y].at || '') || x - y);
    const chs = idx.map((k) => doc.chapters[k]), wcs = idx.map((k) => wordCounts[k]);
    doc.chapters = chs; wordCounts = wcs;
    cur = doc.chapters.findIndex((c) => c.id === keepId);
    renderOutline(); updateStatus(); markDirty();
  }
  // Open a chapter and put the caret in the heading that is the k-th one listed in its table of contents
  function goToHeading(i, c, k) {
    if (i !== cur) selectChapter(i);
    let kids = [...editor.children];
    if (readingBook()) { // the whole book is on the page: only this chapter's part
      const seps = kids.map((e, ix) => (e.classList.contains('chapsep') ? ix : -1)).filter((x) => x >= 0);
      kids = kids.slice(seps[i] !== undefined ? seps[i] : 0, seps[i + 1] !== undefined ? seps[i + 1] : kids.length);
    }
    kids = kids.filter((e) => e.textContent.trim() && !e.classList.contains('chapsep'));
    // the chapter's own name line is not listed, so skip it when counting
    if (!c.title.trim() && kids[0] && kids[0].tagName === 'H1') kids.shift();
    const h = kids.filter((e) => /^H[12]$/.test(e.tagName))[k];
    closeOutline();
    if (!h) return;
    if (!reading) {
      const r = document.createRange(); r.selectNodeContents(h); r.collapse(false);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    const rect = h.getBoundingClientRect();
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + rect.top - innerHeight * (prefs.anchor || 68) / 100 * 0.6), behavior: 'smooth' });
    kick(true);
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
  let dragFrom = null;
  function moveChapter(i, d) { moveChapterTo(i, i + d); }
  // Moves chapter i to position j, the others shift along. The chapter being edited stays the current one.
  function moveChapterTo(i, j) {
    if (i === j || i < 0 || j < 0 || i >= doc.chapters.length || j >= doc.chapters.length) return;
    syncFromDom();
    const curCh = doc.chapters[cur];
    doc.chapters.splice(j, 0, doc.chapters.splice(i, 1)[0]);
    wordCounts.splice(j, 0, wordCounts.splice(i, 1)[0]);
    cur = doc.chapters.indexOf(curCh);
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
  // Labels and controls that depend on the kind of document: book, single text or journal.
  function applyKind() {
    if (!doc) return;
    const k = kindOf(), many = doc.chapters.length > 1;
    document.body.classList.toggle('kind-journal', k === 'journal');
    document.body.classList.toggle('kind-text', k === 'text');
    const name = k === 'journal' ? 'Entries' : k === 'text' ? (many ? 'Sections' : 'Details') : 'Chapters';
    const b = $('#btnChapters'); b.textContent = name; b.title = name + ' (Ctrl+Shift+O)';
    $('#outlineHead').textContent = name; $('#outline').setAttribute('aria-label', name);
    $('#btnEntry').hidden = k !== 'journal';
    $('#nbOpen').hidden = k !== 'book';
    if (k !== 'book' && !$('#notebook').hidden) $('#notebook').hidden = true;
    nbCount();
    if (!$('#notebook').hidden) nbRender(); // a different book was opened: show its pages, not the last one's
    $('#navJournal').hidden = k !== 'journal';
    if (k !== 'journal' && $('#navJournal').classList.contains('on')) { const first = $('.st-nav button'); if (first) first.click(); }
    if (k === 'journal') { $('#jDate').value = D.DATE_FMTS.includes(doc.dateFmt) ? doc.dateFmt : 'long'; $('#jTime').value = D.TIME_FMTS.includes(doc.timeFmt) ? doc.timeFmt : '24'; }
    $('#addChapter').textContent = k === 'journal' ? 'New entry' : k === 'text' ? 'Add section' : 'Add chapter';
    $('#chapterList').hidden = k === 'text' && !many;
    $('#docTitle').placeholder = k === 'journal' ? 'Title of the journal' : k === 'text' ? 'Title of the text' : 'Title of the book or document';
    $('#outlineHelp').textContent = k === 'journal' ? 'Click an entry to open it. Entries are stamped with the day and time they were started; the title is optional. In exports each entry begins with its date.'
      : k === 'text' ? 'Sections are optional. They become new pages in Word and PDF exports. The title page is never numbered or counted.'
      : $('#outlineHelp').dataset.book || $('#outlineHelp').textContent;
  }
  $('#outlineHelp').dataset.book = $('#outlineHelp').textContent;
  function addChapter() {
    syncFromDom();
    if (kindOf() === 'journal') {
      // an empty entry at the end is reused instead of stacking blank ones
      const last = doc.chapters.length - 1;
      if (!doc.chapters[last].blocks.some((x) => D.blockText(x).trim()) && !doc.chapters[last].title.trim()) {
        doc.chapters[last].at = new Date().toISOString(); cur = last; renderChapter(); renderOutline(); updateStatus(); markDirty(); editor.focus(); placeCaretAtEnd(); return;
      }
    }
    doc.chapters.push(kindOf() === 'journal' ? D.newEntry() : D.newChapter());
    wordCounts.push(0);
    cur = doc.chapters.length - 1;
    renderChapter(); renderOutline(); updateStatus(); markDirty();
    // start writing right away, in plain text (the name can be typed in the Chapters panel)
    editor.focus(); placeCaretAtEnd();
  }
  function openOutline() { syncFromDom(); closePanels(); $('#outline').hidden = false; renderOutline(); }
  function closeOutline() { $('#outline').hidden = true; if (!reading) { editor.focus(); } }

  /* ============================ export / history ============================ */
  // Which chapters go into an export: all of them unless the person unticks some (null = all)
  let exportSel = null;
  // ticked unless the person has switched it off once (it only appears when the book has a title)
  const wantTitlePage = () => (prefs.titlePage == null ? true : !!prefs.titlePage);
  // Letter in Canada and the US, A4 elsewhere, until the person picks one
  const autoPage = () => (/-(US|CA)$/i.test(navigator.language || '') ? 'letter' : 'a4');
  const PAGE_NAMES = { letter: 'US Letter', a4: 'A4', a5: 'A5', trade: 'Trade paperback 6 x 9 in', digest: 'Digest 5.5 x 8.5 in' };
  const MARGIN_NAMES = { narrow: 'Narrow (1.5 cm)', normal: 'Normal (2.5 cm)', wide: 'Wide (3.2 cm)' };
  const pageNow = () => (PAGE_NAMES[prefs.pageSize] ? prefs.pageSize : autoPage());
  function fillExportSelects() {
    const fill = (id, names) => { const el = $(id); if (!el.options.length) for (const k of Object.keys(names)) el.add(new Option(names[k], k)); };
    fill('#exportPage', PAGE_NAMES); fill('#exportMargins', MARGIN_NAMES);
    $('#exportPage').value = pageNow();
    $('#exportMargins').value = MARGIN_NAMES[prefs.margins] ? prefs.margins : 'normal';
    $('#exportNotes').value = ['off', 'comments', 'footnotes'].includes(prefs.notesMode) ? prefs.notesMode : 'comments';
    $('#pdfHint').textContent = PAGE_NAMES[pageNow()].split(' ')[pageNow() === 'letter' ? 1 : 0] + ' \u00b7 .pdf';
  }
  function renderExportChapters() {
    fillExportSelects();
    $('#exportTitlePage').checked = wantTitlePage();
    const box = $('#exportChapters'), list = $('#exportChapterList'), btn = $('#exportChaptersBtn');
    if (!doc || doc.chapters.length < 2) { box.hidden = true; return; }
    syncFromDom();
    box.hidden = false;
    const sel = exportSel || new Set(doc.chapters.map((c) => c.id));
    list.innerHTML = '';
    doc.chapters.forEach((c, i) => {
      const l = document.createElement('label');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = sel.has(c.id); cb.dataset.id = c.id;
      cb.addEventListener('change', () => {
        const ids = $$('#exportChapterList input').filter((x) => x.checked).map((x) => x.dataset.id);
        exportSel = ids.length === doc.chapters.length ? null : new Set(ids);
        updateExportBtn();
      });
      l.append(cb, document.createTextNode(' ' + (chapterName(c) || unitWord() + ' ' + (i + 1))));
      list.appendChild(l);
    });
    updateExportBtn();
  }
  function updateExportBtn() {
    const n = exportSel ? exportSel.size : doc.chapters.length;
    $('#exportChaptersBtn').textContent = 'Chapters: ' + (n === doc.chapters.length ? 'all' : n + ' of ' + doc.chapters.length);
  }
  $('#exportChaptersBtn').addEventListener('click', () => {
    const l = $('#exportChapterList'); l.hidden = !l.hidden;
    $('#exportChaptersBtn').setAttribute('aria-expanded', String(!l.hidden));
    placePopover($('#exportMenu'), $('#btnExport'));
  });
  async function doExport(format) {
    $('#exportMenu').hidden = true;
    snapshotDoc();
    const ext = { docx: '.docx', pdf: '.pdf', md: '.md', txt: '.txt', epub: '.epub' }[format];
    const label = { docx: 'Word document', pdf: 'PDF', md: 'Markdown', txt: 'Plain text', epub: 'e-book' }[format];
    const chosen = await pickFile({ mode: 'save', kind: 'export', title: 'Export as ' + label, name: D.slugify(docTitle()) === 'untitled' ? 'Untitled' : docTitle(), exts: [ext], ok: 'Export' });
    if (chosen === null) { if (!reading) editor.focus(); return; }
    toast('Preparing ' + format.toUpperCase() + '…');
    const r = await window.api.exportDoc({
      format, doc, suggested: docTitle(), path: chosen === 'system' ? undefined : chosen,
      opts: { notes: $('#exportNotes').value !== 'off', notesMode: $('#exportNotes').value, pageSize: $('#exportPage').value, margins: $('#exportMargins').value, lang: (prefs.spellLangs && prefs.spellLangs[0]) || navigator.language || 'en', font: prefs.font, justify: prefs.justify !== false, author: doc.author || undefined, titlePage: wantTitlePage(), pageNumbers: prefs.pageNumbers !== false, chapterIds: exportSel ? [...exportSel] : undefined },
    });
    if (r && r.error) await window.api.error('Export failed: ' + r.error);
    else if (r && r.path) { const ph = placeholderCount(); toast('Exported to ' + baseName(r.path) + (ph ? '. Heads up: ' + ph + ' to fill still in the text.' : ''), ph ? 5200 : undefined); }
    if (!reading) editor.focus();
  }
  async function saveNamedVersion() {
    const name = $('#versionName').value.trim();
    if (!name || !filePath) { $('#versionName').focus(); return; }
    await autosave();
    const ok = await window.api.versionsSave({ id: doc.id, text: D.serializeDraft(snapshotDoc()), name });
    if (!ok) { await window.api.error('Could not save the version.'); return; }
    $('#versionName').value = '';
    toast('Version saved: ' + name);
    openVersions();
  }
  $('#versionSaveBtn').addEventListener('click', saveNamedVersion);
  $('#versionName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNamedVersion(); } });
  async function openVersions() {
    closePanels();
    const list = $('#versionList');
    list.innerHTML = '';
    if (!filePath) { list.innerHTML = '<li class="small">Save the document first. History is kept for saved documents.</li>'; }
    else {
      await autosave();
      const items = await window.api.versionsList(doc.id);
      if (!items.length) list.innerHTML = '<li class="small">No earlier versions yet. A snapshot is taken every few minutes while you write, and before a save that removes a lot of text. Name one above to keep it for good.</li>';
      for (const it of items) {
        const li = document.createElement('li');
        if (it.name) li.className = 'named';
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<span><span class="vname"></span></span><span class="hint">Open as new document</span>';
        b.firstChild.firstChild.textContent = it.name ? it.name + '  ' : '';
        b.firstChild.append(document.createTextNode(new Date(it.time).toLocaleString()));
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
        const cmp = document.createElement('button');
        cmp.type = 'button'; cmp.className = 'vdel'; cmp.textContent = 'Compare';
        cmp.setAttribute('aria-label', 'Compare ' + (it.name || new Date(it.time).toLocaleString()) + ' with the current text');
        cmp.addEventListener('click', () => openCompare(it));
        li.appendChild(cmp);
        if (it.name) {
          const x = document.createElement('button');
          x.type = 'button'; x.className = 'vdel'; x.textContent = 'Delete'; x.setAttribute('aria-label', 'Delete the version ' + it.name);
          x.addEventListener('click', async () => {
            const c = await window.api.confirm({ message: 'Delete the version "' + it.name + '"?', detail: 'This cannot be undone.', buttons: ['Delete', 'Cancel'] });
            if (c === 0) { await window.api.versionsDelete(it.file); openVersions(); }
          });
          li.appendChild(x);
        }
        list.appendChild(li);
      }
    }
    $('#versionSave').hidden = !filePath;
    $('#modal').hidden = false;
  }

  // Compare an earlier version with what is on the page now: red struck text was there then, green text is new.
  let cmpState = null;
  async function openCompare(it) {
    let old;
    try { old = D.parseDraft(await window.api.versionsRead(it.file)); } catch (e) { window.api.error(e.message); return; }
    const res = DocDiff.compare(old, snapshotDoc());
    cmpState = { it, res };
    $('#cmpOpen').hidden = false; $('#cmpImport').hidden = true; $('#cmpKeep').hidden = true;
    $('#cmpTitle').textContent = 'Compare: ' + (it.name ? it.name + ', ' : '') + new Date(it.time).toLocaleString() + ' and now';
    $('#cmpSummary').textContent = (res.added + res.removed + res.changed) === 0 ? 'No differences. The text is the same as that version.'
      : res.changed + ' paragraph' + (res.changed === 1 ? '' : 's') + ' edited, ' + res.added + ' added, ' + res.removed + ' removed (about ' + res.words + ' words). Struck red text was in that version, green text is new.';
    renderCompare();
    $('#cmpDlg').hidden = false;
    $('#cmpBody').focus();
  }
  function renderCompare() {
    const body = $('#cmpBody'), only = $('#cmpOnly').checked;
    body.innerHTML = '';
    const rows = cmpState.res.rows, show = rows.map((r) => r.kind !== 'same');
    // With "only what changed", keep one paragraph of context on each side so edits can be located.
    const keep = rows.map((r, i) => !only || show[i] || show[i - 1] || show[i + 1] || (r.chapter && (show[i + 1] || show[i + 2])));
    let gap = false;
    rows.forEach((r, i) => {
      if (!keep[i]) { gap = true; return; }
      if (gap) { const g = document.createElement('p'); g.className = 'cmp-gap'; g.textContent = '\u00b7 \u00b7 \u00b7'; g.setAttribute('aria-hidden', 'true'); body.appendChild(g); gap = false; }
      const p = document.createElement('p');
      p.className = 'cmp-' + r.kind + (r.chapter ? ' cmp-ch' : '');
      if (r.kind === 'chg') {
        for (const part of r.parts) {
          if (part.op === 'eq') p.append(document.createTextNode(part.text));
          else { const e = document.createElement(part.op === 'add' ? 'ins' : 'del'); e.textContent = part.text; p.append(e); }
        }
      } else if (r.kind === 'add' || r.kind === 'del') {
        const e = document.createElement(r.kind === 'add' ? 'ins' : 'del'); e.textContent = r.text; p.append(e);
      } else p.textContent = r.text;
      body.appendChild(p);
    });
  }
  $('#cmpOnly').addEventListener('change', () => cmpState && renderCompare());
  // The same dialog also shows the changes found in the Word copy, with buttons to import them.
  let cmpResolve = null;
  function closeCompare(result) {
    $('#cmpDlg').hidden = true;
    const r = cmpResolve; cmpResolve = null;
    if (r) r(result || 'later');
  }
  $('#cmpClose').addEventListener('click', () => closeCompare('later'));
  $('#cmpImport').addEventListener('click', () => closeCompare('import'));
  $('#cmpKeep').addEventListener('click', () => closeCompare('keep'));
  $('#cmpOpen').addEventListener('click', async () => {
    if (!cmpState || !cmpState.it) return;
    try {
      const d = D.parseDraft(await window.api.versionsRead(cmpState.it.file));
      $('#cmpDlg').hidden = true; $('#modal').hidden = true;
      window.api.recoveryClear(); loadDoc(d, null, { dirty: true });
      toast('Opened an earlier version. Save it under a new name to keep it.');
    } catch (e) { window.api.error(e.message); }
  });
  $('#diagBtn').addEventListener('click', async () => { try { await window.api.diagnostics(); toast('Diagnostics copied. Paste them into your message.'); } catch (e) { toast('Could not copy diagnostics.'); } });

  /* ---- (i) hints: a sentence about what a setting does, on hover or keyboard focus ---- */
  {
    const tip = $('#infoTip');
    const place = (btn) => {
      const r = btn.getBoundingClientRect();
      tip.style.left = '0px'; tip.style.top = '0px';
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
      const top = r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    };
    const show = (btn) => { tip.textContent = btn.dataset.text; tip.hidden = false; place(btn); };
    const hide = () => { tip.hidden = true; };
    $$('[data-info]').forEach((host, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'info'; b.textContent = 'i';
      b.dataset.text = host.dataset.info;
      b.setAttribute('aria-label', 'What does this do? ' + host.dataset.info);
      b.addEventListener('mouseenter', () => show(b));
      b.addEventListener('mouseleave', hide);
      b.addEventListener('focus', () => show(b));
      b.addEventListener('blur', hide);
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); tip.hidden ? show(b) : hide(); });
      // inside a label a click on the icon must not toggle the checkbox
      b.addEventListener('mousedown', (e) => e.preventDefault());
      if (host.tagName === 'LABEL' && host.classList.contains('check')) host.append(b); else if (host.classList.contains('row') || host.classList.contains('xrow')) { const first = host.firstElementChild; first.append(b); } else host.append(b);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  }

  /* ============================ Word copy next to the book ============================ */
  const companionOn = () => !!prefs.companion && /\.draft$/i.test(filePath || '');
  const companionOpts = () => ({ lang: (prefs.spellLangs && prefs.spellLangs[0]) || navigator.language || 'en', font: prefs.font, justify: prefs.justify !== false, author: doc.author || undefined, pageNumbers: prefs.pageNumbers !== false, pageSize: pageNow(), margins: prefs.margins || 'normal' });
  // After a save: write Book.docx beside Book.draft. Never replaces a Word copy that was changed elsewhere without asking.
  async function syncCompanion() {
    if (!companionOn()) return null;
    const write = (force) => window.api.companionWrite({ path: filePath, doc: snapshotDoc(), opts: companionOpts(), force: !!force });
    let r = await write(false);
    if (r.status === 'conflict') {
      const c = await window.api.confirm({ message: 'Your Word copy has changes that are not in the book yet.', detail: 'It was edited outside Quire, for example on your phone. Review the changes before they are replaced.', buttons: ['Review the changes', 'Replace the Word copy with my version', 'Skip the Word copy this time'] });
      if (c === 0) { await reviewCompanion(); return 'review'; }
      if (c !== 1) { const st = await window.api.companionCheck(filePath); if (st.hash) companionSnooze.set(filePath, st.hash); return 'skipped'; } // do not ask again right away
      r = await write(true);
    } else if (r.status === 'exists') {
      const c = await window.api.confirm({ message: r.name + ' already exists next to the book.', detail: 'Quire did not write that file. Replace it with the Word copy of this book?', buttons: ['Replace it', 'Skip the Word copy this time'] });
      if (c !== 0) return 'skipped';
      r = await write(true);
    }
    if (r.status === 'error') { toast('Saved, but the Word copy was not updated: ' + r.message, 4500); return 'error'; }
    return r.status === 'ok' ? 'ok' : null;
  }
  // Show what changed in the Word copy and let the person bring it in. Returns 'same', 'import', 'keep' or 'later'.
  const companionSnooze = new Map();
  async function reviewCompanion() {
    const read = await window.api.companionRead(filePath);
    if (!read || read.error) { toast('Could not read the Word copy: ' + ((read && read.error) || 'unknown error'), 4500); return 'later'; }
    const book = snapshotDoc();
    const exportDoc = D.forExport(book, {});
    const imported = DocMerge.chaptersFromRaw(read.raw, D.headingPlan(exportDoc).chapterHeadings);
    const { doc: merged, stats } = DocMerge.merge(book, imported, new Set(exportDoc.chapters.map((c) => c.id)));
    const res = DocDiff.compare(book, merged);
    if (res.added + res.removed + res.changed + stats.chaptersAdded + stats.chaptersRemoved === 0) { await window.api.companionAccept(filePath); return 'same'; }
    cmpState = { it: null, res };
    $('#cmpTitle').textContent = 'Your Word copy changed';
    const parts = [];
    if (res.changed) parts.push(res.changed + ' paragraph' + (res.changed === 1 ? '' : 's') + ' edited');
    if (res.added) parts.push(res.added + ' added');
    if (res.removed) parts.push(res.removed + ' removed');
    $('#cmpSummary').textContent = parts.join(', ') + '. Struck red text is in the book now, green text comes from the Word copy. Your notes, chapter targets and page-number settings stay. A snapshot is saved to History before anything is replaced.';
    $('#cmpOpen').hidden = true; $('#cmpImport').hidden = false; $('#cmpKeep').hidden = false;
    renderCompare();
    $('#cmpDlg').hidden = false;
    $('#cmpBody').focus();
    const choice = await new Promise((resolve) => { cmpResolve = resolve; });
    if (choice === 'import') {
      const was = cur;
      await window.api.snapshotDoc({ text: D.serializeDraft(book) });
      loadDoc(merged, filePath, { dirty: true });
      selectChapter(Math.max(0, Math.min(was, doc.chapters.length - 1)));
      await window.api.companionAccept(filePath);
      markDirty();
      toast('Imported the changes from the Word copy. The earlier text is in History.', 4200);
    } else if (choice === 'keep') {
      const w = await window.api.companionWrite({ path: filePath, doc: snapshotDoc(), opts: companionOpts(), force: true });
      toast(w.status === 'ok' ? 'Kept your version. The Word copy was replaced.' : 'Could not replace the Word copy.', 3600);
    } else companionSnooze.set(filePath, read.hash);
    if (!reading) editor.focus();
    return choice;
  }
  let companionBusy = false;
  const gdocAsked = new Set();
  // On opening a book and whenever the window comes back to the front: has the Word copy changed, or is there a Google Docs pointer?
  async function checkCompanion() {
    if (companionBusy || !companionOn() || !doc || conflictOpen || !$('#cmpDlg').hidden || !$('#fileDlg').hidden) return;
    companionBusy = true;
    try {
      const st = await window.api.companionCheck(filePath);
      if (st.state === 'changed' && companionSnooze.get(filePath) !== st.hash) await reviewCompanion();
      else if (st.state === 'gdoc' && !gdocAsked.has(st.gdoc)) {
        gdocAsked.add(st.gdoc);
        const c = await window.api.confirm({
          message: 'There is a Google Docs file next to this book.',
          detail: 'Quire cannot read Google Docs files, only the Word copy (.docx). If you edited the book in Google Docs, download it from there as a Word file (.docx) and save it in this folder over the old Word copy. Quire will then show the changes for review. Editing the .docx in Google Drive directly, without converting it, avoids this.',
          buttons: ['Open it in Google Docs', 'Not now'],
        });
        if (c === 0) await window.api.openGdoc(st.gdoc);
      }
    } catch (e) { /* the Word copy is a convenience: never get in the way */ } finally { companionBusy = false; }
  }
  window.addEventListener('focus', () => setTimeout(checkCompanion, 400));


  /* ============================ notebook ============================ */
  // Pages about the world of a book (places, people, customs, calendars). They live in the book's file, are never exported or counted,
  // and sit in a panel on the right so a look-up does not take you out of the chapter.
  const nbEl = $('#notebook');
  const nbNorm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nbPages = () => (doc.notebook || (doc.notebook = []));
  const NB_CATS = ['Places', 'People', 'Cultures and religions', 'Calendar and time', 'Timeline', 'Creatures', 'Objects'];
  function nbCount() { const n = doc && doc.notebook ? doc.notebook.length : 0; $('#nbOpen').textContent = n ? 'Notebook (' + n + ')' : 'Notebook'; }
  function nbShow() {
    if (!doc || kindOf() !== 'book') return;
    nbEl.hidden = false; nbRender();
    (nbPage ? $('#nbText') : $('#nbSearch')).focus();
  }
  function nbHide() { nbEl.hidden = true; if (!reading) editor.focus(); }
  function nbToggle() { if (nbEl.hidden) nbShow(); else nbHide(); }
  function nbSnippet(p, terms) {
    const t = (p.text || '').replace(/\s+/g, ' ').trim();
    if (!terms.length) return t.slice(0, 90);
    const n = nbNorm(t); let at = -1;
    for (const w of terms) { at = n.indexOf(w); if (at >= 0) break; }
    if (at < 0) return t.slice(0, 90);
    const from = Math.max(0, at - 30);
    return (from ? '...' : '') + t.slice(from, from + 100);
  }
  function nbRender() {
    $('#nbList').hidden = !!nbPage; $('#nbPage').hidden = !nbPage;
    nbCount();
    if (nbPage) return;
    const q = $('#nbSearch').value.trim(), terms = nbNorm(q).split(/\s+/).filter(Boolean);
    const box = $('#nbItems'); box.innerHTML = '';
    const pages = nbPages().filter((p) => { const hay = nbNorm(p.title + ' ' + p.cat + ' ' + p.text); return terms.every((w) => hay.includes(w)); });
    const byTitle = (x, y) => (x.title || 'Untitled page').localeCompare(y.title || 'Untitled page', undefined, { sensitivity: 'base' });
    const row = (p) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'nb-row';
      const t = document.createElement('span'); t.className = 'nb-t'; t.textContent = p.title || 'Untitled page';
      const s = document.createElement('span'); s.className = 'nb-s'; s.textContent = (terms.length && p.cat ? p.cat + ': ' : '') + nbSnippet(p, terms);
      b.append(t, s); b.addEventListener('click', () => nbOpenPage(p)); box.appendChild(b);
    };
    if (!pages.length) {
      const e = document.createElement('div'); e.className = 'nb-empty';
      e.textContent = q ? 'Nothing matches. Press Enter to start a page called “' + q + '”.' : 'Nothing here yet. Places, people, customs, dates: anything you want to keep track of goes on a page.';
      box.appendChild(e); return;
    }
    if (terms.length) { pages.sort(byTitle).forEach(row); return; }
    const groups = new Map();
    pages.forEach((p) => { const k = p.cat.trim() || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
    const keys = [...groups.keys()].sort((x, y) => (x === '' ? 1 : y === '' ? -1 : x.localeCompare(y, undefined, { sensitivity: 'base' })));
    keys.forEach((k) => {
      if (keys.length > 1 || k) { const h = document.createElement('h3'); h.textContent = k || 'Other'; box.appendChild(h); }
      groups.get(k).sort(byTitle).forEach(row);
    });
  }
  function nbOpenPage(p) {
    nbPage = p;
    $('#nbTitle').value = p.title; $('#nbCat').value = p.cat; $('#nbText').value = p.text;
    const cats = new Set(NB_CATS); nbPages().forEach((x) => { if (x.cat.trim()) cats.add(x.cat.trim()); });
    $('#nbCats').innerHTML = ''; [...cats].sort().forEach((c) => { const o = document.createElement('option'); o.value = c; $('#nbCats').appendChild(o); });
    nbRender();
    $('#nbText').focus();
  }
  function nbBack() {
    if (nbPage && !nbPage.title.trim() && !nbPage.text.trim()) { const i = nbPages().indexOf(nbPage); if (i >= 0) nbPages().splice(i, 1); markDirty(); } // an empty page is not kept
    nbPage = null; nbRender(); $('#nbSearch').focus();
  }
  function nbAdd(title) {
    const p = D.newPage(); if (title) p.title = title;
    nbPages().push(p); markDirty(); $('#nbSearch').value = ''; nbOpenPage(p);
    (title ? $('#nbText') : $('#nbTitle')).focus();
  }
  async function nbDelete() {
    if (!nbPage) return;
    const c = await window.api.confirm({ message: 'Delete “' + (nbPage.title.trim() || 'Untitled page') + '”?', detail: 'It is removed from the notebook. Earlier versions in History still contain it.', buttons: ['Delete', 'Cancel'] });
    if (c !== 0) return;
    const i = nbPages().indexOf(nbPage); if (i >= 0) nbPages().splice(i, 1);
    markDirty(); nbPage = null; nbRender(); $('#nbSearch').focus();
  }
  $('#nbOpen').addEventListener('click', () => { closePanels(); nbShow(); });
  $('#nbClose').addEventListener('click', nbHide);
  $('#nbBack').addEventListener('click', nbBack);
  $('#nbAdd').addEventListener('click', () => nbAdd(''));
  $('#nbDelete').addEventListener('click', nbDelete);
  $('#nbSearch').addEventListener('input', nbRender);
  $('#nbSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = $('#nbSearch').value.trim(), first = $('#nbItems .nb-row');
    if (first) first.click(); else if (q) nbAdd(q);
  });
  $('#nbTitle').addEventListener('input', () => { if (nbPage) { nbPage.title = $('#nbTitle').value; markDirty(); } });
  $('#nbCat').addEventListener('input', () => { if (nbPage) { nbPage.cat = $('#nbCat').value; markDirty(); } });
  $('#nbText').addEventListener('input', () => { if (nbPage) { nbPage.text = $('#nbText').value; markDirty(); } });
  $('#nbTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#nbText').focus(); } });

  /* ============================ panels ============================ */
  function closePanels() {
    if (activeNote && !$('#notePop').hidden) closeNotePop(true);
    ['#exportMenu', '#settings'].forEach((s) => ($(s).hidden = true));
    $('#outline').hidden = true;
  }
  const anyPanelOpen = () => ['#exportMenu', '#settings', '#outline', '#notePop', '#modal', '#cmpDlg', '#fileDlg', '#tplDlg'].some((s) => !$(s).hidden);
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
      if (sel === '#settings') { renderDayGrid(); updatePace(); const f = $('#settings .st-nav button.on'); if (f) f.focus({ preventScroll: true }); }
      else if (sel === '#exportMenu') { renderExportChapters(); const f = $(sel).querySelector('button,input,select'); if (f) f.focus({ preventScroll: true }); }
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
  // The pointer hides while you type and comes back when you move it.
  let ptrX = -1, ptrY = -1;
  document.addEventListener('mousemove', (e) => {
    if (Math.abs(e.clientX - ptrX) + Math.abs(e.clientY - ptrY) >= 4) document.body.classList.remove('ptrhide');
    ptrX = e.clientX; ptrY = e.clientY;
    showChrome();
  });
  document.addEventListener('mousedown', () => document.body.classList.remove('ptrhide'));
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (!ctrl && !e.altKey && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) {
      hideChrome();
      document.body.classList.add('typing');
      if (document.activeElement === editor) document.body.classList.add('ptrhide');
    }
    if (e.key === 'F11') { e.preventDefault(); window.api.toggleFullscreen(); return; }
    if (e.key === 'F10') { e.preventDefault(); showChrome(); $('#btnChapters').focus(); return; } // the menu bar by keyboard
    if (e.key === 'Escape' && e.target.closest && e.target.closest('.ch-memo')) { e.preventDefault(); memoOpen = null; renderOutline(); return; }
    if (e.key === 'Escape' && !$('#notebook').hidden && $('#notebook').contains(document.activeElement)) { e.preventDefault(); nbHide(); return; }
    if (e.key === 'F3' && !fb.hidden) { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Escape') {
      if (activeNote && !$('#notePop').hidden) { e.preventDefault(); closeNotePop(false); return; }
      if (!fb.hidden) { e.preventDefault(); closeFind(); return; }
      if (!$('#fileDlg').hidden) return;
      if (!$('#tplDlg').hidden) { if (tplDone) tplDone(null); return; }
      if (!$('#cmpDlg').hidden) { closeCompare('later'); return; }
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
      // by physical key: on a Spanish layout Ctrl+Alt is AltGr and the letter may come out changed
      if (e.code === 'KeyM') { e.preventDefault(); addNote(); }
      else if (e.code === 'KeyS') { e.preventDefault(); save('as'); }
      return;
    }
    if (e.target.closest && e.target.closest('#notebook, .ch-memo, #chapTitle') && k !== 'k' && k !== 's') return; // typing in the notebook is plain typing
    const shift = e.shiftKey;
    switch (k) {
      case 'k': if (!shift) { e.preventDefault(); nbToggle(); } break;
      case 'b': e.preventDefault(); command('bold'); break;
      case 'i': e.preventDefault(); command('italic'); break;
      case 'u': e.preventDefault(); command('underline'); break;
      case '1': e.preventDefault(); command('h1'); break;
      case '2': e.preventDefault(); command('h2'); break;
      case '3': e.preventDefault(); command('h3'); break;
      case '4': e.preventDefault(); command('h4'); break;
      case '0': e.preventDefault(); if (!reading) { document.execCommand('formatBlock', false, 'p'); if (inQuote()) document.execCommand('outdent'); afterEdit(); } break;
      case 'q': if (shift) { e.preventDefault(); command('quote'); } break;
      case 'p': if (shift) { e.preventDefault(); command('poem'); } break;
      case 's': e.preventDefault(); save(shift ? 'as' : 'save'); break;
      case 'o': e.preventDefault(); if (shift) toggle('#outline'); else doOpen(); break;
      case 'n': e.preventDefault(); doNew(); break;
      case 'e': e.preventDefault(); if (shift && kindOf() === 'journal') addChapter(); else toggle('#exportMenu', '#btnExport'); break;
      case 'r': e.preventDefault(); break; // swallowed: Ctrl+R must not reload the window
      case 'f': e.preventDefault(); openFind(false); break;
      case 'h': e.preventDefault(); openFind(true); break;
      case ',': e.preventDefault(); toggle('#settings', '#btnSettings', 'right'); break;
      case '/': e.preventDefault(); savePrefs({ fmtbar: prefs.fmtbar === false }); break;
      case 'enter': if (shift) { e.preventDefault(); insertBreak(); } break;
      case 'j': e.preventDefault(); jumpPlaceholder(shift ? -1 : 1); break;
      case 't': if (shift) { e.preventDefault(); startSprint(); } break;
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
    else { b.classList.remove('cite'); b.classList.toggle('sbreak', b.tagName === 'P' && /^\s*(\*\s*){3}$/.test(b.textContent)); }
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
  // In a poem Tab indents the line (spaces are kept in the text and in every export) and Shift+Tab takes the indent back.
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || reading || !inPoem() || !getSelection().isCollapsed) return;
    if (nameTip || e.defaultPrevented) return;
    e.preventDefault();
    if (!e.shiftKey) { document.execCommand('insertText', false, '    '); afterEdit(); return; }
    const b = currentBlock(), r = getSelection().getRangeAt(0);
    const pre = document.createRange(); pre.selectNodeContents(b); pre.setEnd(r.startContainer, r.startOffset);
    const m = /( {1,4})$/.exec(pre.toString());
    if (!m) return;
    for (let k = 0; k < m[1].length; k++) document.execCommand('delete');
    afterEdit();
  });
  // In a poem Enter ends a line. Enter on an empty line starts a new stanza, and Enter in an empty stanza leaves the poem.
  function onEmptyPoemLine(b) {
    const r = getSelection().getRangeAt(0);
    const text = (frag) => { let s = ''; const walk = (n) => { if (n.nodeType === 3) s += n.nodeValue; else if (n.nodeName === 'BR') s += '\n'; else n.childNodes.forEach(walk); }; walk(frag); return s; };
    const before = document.createRange(); before.selectNodeContents(b); before.setEnd(r.startContainer, r.startOffset);
    const after = document.createRange(); after.selectNodeContents(b); after.setStart(r.endContainer, r.endOffset);
    // the caret sits on a line with nothing on it: right after a line break, with nothing but line breaks after it
    return /\n$/.test(text(before.cloneContents())) && text(after.cloneContents()).replace(/\n/g, '') === '';
  }
  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || reading) return;
    const b = currentBlock();
    if (!b || b.tagName !== 'P' || !b.classList.contains('poem') || !getSelection().isCollapsed) return;
    e.preventDefault();
    if (!b.textContent.trim()) { b.classList.remove('poem'); afterEdit(); return; }
    if (onEmptyPoemLine(b)) {
      document.execCommand('delete'); // takes back the empty line, then a new block starts the next stanza
      document.execCommand('insertParagraph');
      const nb = currentBlock();
      if (nb) nb.classList.add('poem');
    } else document.execCommand('insertLineBreak');
    afterEdit();
  });
  /* ---- Markdown shortcuts while typing ---- */
  // '# ' / '## ' / '> ' at the start of a line make a heading / sub-heading / quote.
  function markdownBlock() {
    const b = currentBlock();
    if (!b || b.tagName !== 'P') return false;
    const m = new RegExp('^(#{1,' + headingDepth() + '}|>)[ \\u00a0]$').exec(b.textContent);
    if (!m) return false;
    const rg = document.createRange();
    rg.selectNodeContents(b);
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(rg);
    document.execCommand('delete');
    setBlock(m[1] === '>' ? 'quote' : 'h' + m[1].length);
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
  // Smart typography (off by default): curly quotes in the chosen style, and three dots become one ellipsis character.
  const QUOTES = {
    en: { dOpen: '\u201c', dClose: '\u201d', sOpen: '\u2018' },
    es: { dOpen: '\u00ab', dClose: '\u00bb', sOpen: '\u201c' }, // Spanish and Catalan: guillemets, then curly quotes inside
    de: { dOpen: '\u201e', dClose: '\u201c', sOpen: '\u201a' },
  };
  function textBeforeCaret() {
    const sel = getSelection();
    const b = currentBlock();
    if (!sel.rangeCount || !b) return '';
    const r = sel.getRangeAt(0), rr = document.createRange();
    rr.selectNodeContents(b); rr.setEnd(r.startContainer, r.startOffset);
    return rr.toString();
  }
  function smartInsert(e) {
    const q = QUOTES[prefs.smartQuotes];
    if (!q || reading || e.isComposing || e.inputType !== 'insertText') return false;
    // '90s, '24: a single quote followed by a digit is an apostrophe, not the start of a quotation.
    if (/^[0-9]$/.test(e.data) && getSelection().isCollapsed) {
      const b = textBeforeCaret();
      if (b.endsWith(q.sOpen) && (b.length === 1 || /[\s([{\u2014\u2013\-\/]/.test(b.charAt(b.length - 2)))) {
        e.preventDefault();
        getSelection().modify('extend', 'backward', 'character');
        document.execCommand('insertText', false, '\u2019' + e.data);
        return true;
      }
    }
    if (e.data === '"' || e.data === "'") {
      const before = textBeforeCaret();
      const opening = before === '' || /[\s([{*_\u2014\u2013\-\/\u00ab\u201c\u2018\u201e\u201a\u00bf\u00a1]$/.test(before);
      const ch = e.data === '"' ? (opening ? q.dOpen : q.dClose) : (opening ? q.sOpen : '\u2019'); // after a letter a single quote is an apostrophe
      e.preventDefault(); document.execCommand('insertText', false, ch);
      return true;
    }
    if (e.data === '.' && /\.\.$/.test(textBeforeCaret()) && getSelection().isCollapsed) {
      e.preventDefault();
      const sel = getSelection(); sel.modify('extend', 'backward', 'character'); sel.modify('extend', 'backward', 'character');
      document.execCommand('insertText', false, '\u2026');
      return true;
    }
    return false;
  }
  editor.addEventListener('beforeinput', (e) => {
    if (smartInsert(e)) return;
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
    if (e.inputType === 'insertText' && !e.isComposing) nameHintUpdate(); else nameHide();
  });
  editor.addEventListener('keyup', (e) => {
    if (/^(Arrow|Page|Home|End)/.test(e.key)) kick(true);
  });
  document.addEventListener('selectionchange', () => {
    if (liveEl && (!editor.contains(liveEl) || currentBlock() !== liveEl)) setLive(null);
    updateActive(); kick(false); applyFocus(); resumeSoon(); nameHintCheckMoved(); selSoon();
  });
  // Pasted formatted text keeps only what the page itself has: bold, italic, underline, headings and quotes.
  // Returns HTML to insert, or '' when the clipboard holds nothing but plain text (then the plain path is used).
  let plainPaste = false; // Ctrl+Shift+V
  function cleanPasteHtml(html) {
    const dom = new DOMParser().parseFromString(html, 'text/html');
    const SKIP = new Set(['script', 'style', 'head', 'meta', 'title', 'img', 'svg', 'noscript', 'link', 'object', 'iframe', 'button', 'input', 'select', 'textarea']);
    const BLOCK = { p: 'p', div: 'p', li: 'p', tr: 'p', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h4', h6: 'h4', blockquote: 'quote' };
    const blocks = [];
    let cur = null, fancy = false;
    const start = (t) => { cur = { t, html: '', text: '' }; blocks.push(cur); };
    const wrapRun = (text, f) => { let h = esc(text); if (f.u) h = '<u>' + h + '</u>'; if (f.i) h = '<i>' + h + '</i>'; if (f.b) h = '<b>' + h + '</b>'; return h; };
    const walk = (node, f) => {
      if (node.nodeType === 3) {
        let text = node.nodeValue.replace(/[\s\u00a0]+/g, ' ');
        if (!cur) { text = text.replace(/^ /, ''); if (!text) return; start('p'); }
        if (!cur.text && !cur.html) text = text.replace(/^ /, '');
        if (!text) return;
        if (f.b || f.i || f.u) fancy = true;
        cur.html += wrapRun(text, f); cur.text += text;
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (SKIP.has(tag) || node.hasAttribute('hidden')) return;
      if (tag === 'br') { cur = null; return; }
      const st = node.style || {};
      const nf = Object.assign({}, f);
      const fw = st.fontWeight;
      if (tag === 'b' || tag === 'strong') nf.b = !(fw === 'normal' || fw === '400'); // Google Docs wraps everything in <b style="font-weight:normal">
      else if (fw === 'bold' || fw === 'bolder' || +fw >= 600) nf.b = true;
      else if (fw === 'normal' || +fw === 400) nf.b = false;
      if (tag === 'i' || tag === 'em' || tag === 'cite') nf.i = st.fontStyle !== 'normal';
      else if (st.fontStyle === 'italic') nf.i = true;
      else if (st.fontStyle === 'normal') nf.i = false;
      if (tag === 'u' || /underline/.test(st.textDecoration || st.textDecorationLine || '')) nf.u = tag !== 'a'; // links are not underlined text
      const bt = BLOCK[tag];
      if (bt) {
        cur = null;
        if (bt !== 'p') { start(bt); fancy = true; }
        for (const ch of node.childNodes) walk(ch, nf);
        cur = null;
        return;
      }
      for (const ch of node.childNodes) walk(ch, nf);
    };
    walk(dom.body, {});
    const real = blocks.filter((b) => b.text.trim());
    if (!real.length) return '';
    if (real.length === 1 && !fancy) return ''; // plain: the normal paste path handles it
    if (real.length === 1 && real[0].t === 'p') return real[0].html.replace(/ +$/, '');
    return real.map((b) => { const tg = b.t === 'quote' ? 'blockquote' : b.t; return '<' + tg + '>' + b.html.replace(/^ +| +$/g, '') + '</' + tg + '>'; }).join('');
  }
  let plainTimer = 0;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') { plainPaste = true; clearTimeout(plainTimer); plainTimer = setTimeout(() => { plainPaste = false; }, 800); } // only for this paste
  }, true);
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    if (reading) return;
    commitHistory(); // the paste is its own undo step
    const html = e.clipboardData.getData('text/html');
    if (html && prefs.richPaste !== false && !plainPaste) {
      const rich = cleanPasteHtml(html);
      if (rich) { document.execCommand('insertHTML', false, rich); cleanBlocks(); return; }
    }
    plainPaste = false;
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
  // drop a .draft, .md or .txt file on the window to open it
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    if (!(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) && e.target.closest && e.target.closest('input, textarea')) return; // moving text inside a text box is the box's own business
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    const p = f && window.api.pathForFile(f);
    if (!p || !/\.(draft|md|markdown|txt|docx)$/i.test(p)) return;
    if (!(await confirmDiscard())) return;
    if (filePath && dirty) await autosave();
    openResult(await window.api.openPath(p));
  });
  editor.addEventListener('click', (e) => {
    const span = e.target.closest && e.target.closest('.note');
    if (span && (e.ctrlKey || reading)) openNotePop(span.dataset.note, span);
  });
  editor.addEventListener('blur', () => { if (!anyPanelOpen()) autosaveSoon(); });
  let blurTimer; function autosaveSoon() { clearTimeout(blurTimer); if (dirty) blurTimer = setTimeout(autosave, 400); }
  window.addEventListener('resize', () => { kick(true); layoutMarks(); if (reading) layoutGutter(); });

  // Buttons
  $('#btnChapters').addEventListener('click', () => toggle('#outline'));
  $('#btnEntry').addEventListener('click', () => { addChapter(); });
  // the date and time format belong to the open journal (kept in its file) and are the default for the next new journal
  const setJournalFormat = () => {
    if (kindOf() !== 'journal') return;
    const dv = $('#jDate').value, tv = $('#jTime').value;
    if (dv === 'long') delete doc.dateFmt; else doc.dateFmt = dv;
    if (tv === '24') delete doc.timeFmt; else doc.timeFmt = tv;
    savePrefs({ journalDate: dv, journalTime: tv });
    renderOutline(); updateStatus(); markDirty();
  };
  $('#jDate').addEventListener('change', setJournalFormat);
  $('#jTime').addEventListener('change', setJournalFormat);
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
  // Settings, About: the version, whether this copy updates itself, and a button to check now
  const KIND_TEXT = { installed: 'installed version', portable: 'portable version', dev: 'development run' };
  function showUpdate(st, kind) {
    const el = $('#updateStatus'), chk = $('#updateCheck'), inst = $('#updateInstall');
    if (!el) return;
    const k = kind || aboutKind;
    let t = '';
    if (k === 'portable') t = 'The portable version does not update itself. Download a newer one from the link below.';
    else if (k === 'dev') t = 'Updates are off while running from source.';
    else if (st.status === 'checking') t = 'Checking for updates\u2026';
    else if (st.status === 'downloading') t = 'Downloading version ' + (st.version || '') + (st.percent ? ' (' + st.percent + '%)' : '') + '\u2026';
    else if (st.status === 'ready') t = 'Version ' + (st.version || '') + ' is ready. It installs when you close Quire, or restart now.';
    else if (st.status === 'current') t = 'You are up to date' + (st.checked ? ' (checked ' + new Date(st.checked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : '') + '.';
    else if (st.status === 'error') t = 'Could not check for updates' + (st.message ? ' (' + st.message + ')' : '') + '. Quire works offline and tries again later. You can also get the newest version from the link below.';
    else t = 'Quire checks when it starts and every few hours while it is open.';
    el.textContent = t;
    const canCheck = k === 'installed';
    chk.hidden = !canCheck; chk.disabled = st.status === 'checking' || st.status === 'downloading' || st.status === 'ready';
    inst.hidden = !(canCheck && st.status === 'ready');
  }
  let aboutKind = 'installed';
  window.api.appInfo().then((i) => {
    aboutKind = i.kind;
    $('#aboutVersion').textContent = 'version ' + i.version;
    $('#aboutKind').textContent = KIND_TEXT[i.kind] || '';
    const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    $('#reportLink').href = 'https://github.com/JaumePuig98/quire/issues/new?body=' + encodeURIComponent('Quire ' + i.version + (KIND_TEXT[i.kind] ? ' (' + KIND_TEXT[i.kind] + ')' : '') + ', ' + plat + '\n\nWhat happened:\n\n\nWhat I expected:\n');
    showUpdate(i.update || { status: 'idle' }, i.kind);
  }).catch(() => {});
  window.api.onUpdateState((st) => showUpdate(st));
  // The button shows whether full screen is on: highlighted, and it offers the way out.
  function showFull(on) {
    const b = $('#btnFull');
    b.textContent = on ? 'Exit full screen' : 'Full screen';
    b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', String(!!on));
    b.title = (on ? 'Leave full screen' : 'Full screen') + ' (F11)';
  }
  window.api.onFullscreen(showFull);
  setTimeout(welcome, 1800);
  // A small secret: click the name in About five times.
  { let n = 0, t0 = 0; const el = document.querySelector('.aboutline strong'); if (el) el.addEventListener('click', () => { const now = Date.now(); n = now - t0 < 3000 ? n + 1 : 1; t0 = now; if (n >= 5) { n = 0; cheer('egg', 4500); } }); }
  showFull(!!(init && init.fullscreen));
  $('#updateCheck').addEventListener('click', async () => { showUpdate({ status: 'checking' }); showUpdate(await window.api.updateCheck()); });
  $('#updateInstall').addEventListener('click', () => window.api.updateInstall());
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
  $('#docAuthor').addEventListener('input', (e) => { doc.author = e.target.value; markDirty(); });
  $('#docSubtitle').addEventListener('input', (e) => { doc.subtitle = e.target.value; markDirty(); });
  $('#docExtra').addEventListener('input', (e) => { doc.extra = e.target.value; markDirty(); });
  $('#docTitle').addEventListener('input', (e) => { doc.title = e.target.value; markDirty(); updateFileHint(); });
  $('#outlineClose').addEventListener('click', closeOutline);
  $('#addChapter').addEventListener('click', addChapter);
  $('#modalClose').addEventListener('click', () => { $('#modal').hidden = true; });
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });
  $$('#fmtbar button').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
    b.addEventListener('click', () => command(b.dataset.cmd));
  });
  $('#exportNotes').addEventListener('change', (e) => savePrefs({ notesMode: e.target.value }));
  $('#exportPage').addEventListener('change', (e) => { savePrefs({ pageSize: e.target.value }); fillExportSelects(); });
  $('#exportMargins').addEventListener('change', (e) => savePrefs({ margins: e.target.value }));
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
    // the Chapters (or Entries) panel closes when you click out on the page
    if (!$('#outline').hidden && !e.target.closest('#outline, #notebook, #topbar, .popover, dialog, #modal, #cmpDlg, #fileDlg, #tplDlg, #settings, #notePop, #toast')) closeOutline();
  });

  // Settings controls
  FMT_ITEMS.forEach(([id, label, keys]) => {
    const l = document.createElement('label'); l.className = 'check';
    const i = document.createElement('input'); i.type = 'checkbox'; i.dataset.fmt = id; i.checked = true;
    const k = document.createElement('span'); k.className = 'hint'; k.textContent = keys;
    l.append(i, ' ' + label + ' ', k);
    i.addEventListener('change', () => {
      const hide = (Array.isArray(prefs.fmtHide) ? prefs.fmtHide : []).filter((x) => x !== id);
      if (!i.checked) hide.push(id);
      savePrefs({ fmtHide: hide });
    });
    $('#fmtItems').appendChild(l);
  });
  $$('[data-pref]').forEach((el) => {
    const k = el.dataset.pref;
    if (el.classList.contains('seg') || el.classList.contains('swatches')) el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) savePrefs({ [k]: b.dataset.v }); });
    else if (el.type === 'checkbox') el.addEventListener('change', () => savePrefs({ [k]: el.checked }));
    else if (el.tagName === 'SELECT') el.addEventListener('change', () => savePrefs({ [k]: el.value }));
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
    else if (el.type === 'date') el.addEventListener('change', () => savePrefs({ [k]: el.value || '' }));
    else if (el.type === 'number') el.addEventListener('change', () => savePrefs({ [k]: Math.max(0, +el.value || 0) }));
  });
  $$('[data-num]').forEach((el) => {
    const k = el.dataset.num;
    const commit = () => {
      const mn = +el.min, mx = +el.max;
      const st = +el.step || 1;
      let v = +el.value;
      if (!isFinite(v) || el.value === '') v = prefs[k];
      v = Math.round(v / st) * st;
      v = Math.min(mx, Math.max(mn, +v.toFixed(2)));
      el.value = v;
      savePrefs({ [k]: v });
    };
    el.addEventListener('change', commit);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); el.select(); } });
    el.addEventListener('focus', () => el.select());
  });
  $$('[data-reset]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.reset; savePrefs({ [k]: DEFAULTS[k] }); }));
  const RESETTABLE = ['theme', 'accent', 'font', 'justify', 'richPaste', 'weight', 'size', 'measure', 'lineHeight', 'paraGap', 'indent', 'headBefore', 'headAfter', 'quoteGap', 'anchor', 'typewriter', 'centerMode', 'focus', 'fmtbar', 'fade', 'glow', 'goal', 'bookGoal', 'showSession', 'autoUpdate', 'smartQuotes', 'friendly', 'companion', 'glowStrength', 'glowColor', 'caret', 'caretBlink', 'fadeReach', 'names', 'sprintMin'];
  $('#resetAll').addEventListener('click', () => {
    const patch = {};
    RESETTABLE.forEach((k) => { if (DEFAULTS[k] !== undefined) patch[k] = DEFAULTS[k]; });
    savePrefs(patch);
    toast('Settings back to their defaults');
  });

  // From the main process
  window.api.onSystemTheme((dark) => { systemDark = dark; applyPrefs(); });
  setInterval(() => { if (prefs.theme === 'evening') applyPrefs(); }, 60000); // the evening theme follows the clock
  window.api.onOpenFile(async (r) => { if (await confirmDiscard()) { if (filePath && dirty) await autosave(); openResult(r); } });
  window.api.onFlush(async () => {
    resumeSave();
    try { await autosave(); } finally { window.api.closeNow(); }
  });

  /* ============================ start ============================ */
  applyPrefs();
  updateModeUI();
  // Asked once at start: when nothing is open, or when the setting says to ask every time.
  function askStart(resumed) {
    setTimeout(async () => {
      const t = await pickTemplate({ start: true, resumed });
      if (!t) { if (!reading) editor.focus(); return; }
      if (resumed && dirty && !(await confirmDiscard())) return; // an unsaved draft that was restored is not thrown away silently
      if (t === 'open') await doOpen(true);
      else loadDoc(newFromTemplate(t), null);
    }, 250);
  }
  (function start() {
    const ask = init.chooser && prefs.startWith === 'new';
    if (init.open && !init.open.error) {
      try {
        const p = parseByExtension(init.open.path, init.open.text);
        loadDoc(p.doc, p.path, { dirty: !!p.imported, resume: true });
        if (ask) askStart(true);
        return;
      } catch (e) { /* fall through to a blank page */ }
    } else if (init.recovery) {
      try { loadDoc(D.parseDraft(init.recovery), null, { dirty: true }); toast('Restored your unsaved draft'); if (ask) askStart(true); return; } catch (e) { /* ignore */ }
    }
    loadDoc(D.newDoc(), null);
    if (init.open && init.open.error) window.api.error(init.open.error);
    else if (init.chooser) askStart(false); // nothing to pick up where it was left: ask what to start, once, with no tour
  })();
  showChrome();
  kick(true);

  // exposed for tests
  window.__app = { paceInfo, renderDayGrid, logDay, whatsNew: window.WhatsNew, appVersion, welcome, jumpPlaceholder, placeholderCount, startSprint, get sprint() { return sprint; }, loadDoc, resumeSave, nameHintUpdate, get nameTip() { return nameTip; }, checkCompanion, cheer, openCompare, openResult, savePrefs, get doc() { return doc; }, syncFromDom, snapshotDoc, domToBlocks, blocksToHtml, setReading, setMode, addChapter, selectChapter, loadDoc, get cur() { return cur; } };
})();
