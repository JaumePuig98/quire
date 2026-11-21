// Quire's own file browser (Save, Open, Export). Needs window.api from the preload script.
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  /* ============================ own file browser (save / open / export) ============================ */
  // QuireFiles.pick({mode:'save'|'open', kind:'doc'|'export', title, name, exts:['.draft'], ok}) -> path | null (cancelled) | 'system'
  function pick(o, hooks) {
    return new Promise((resolve) => {
      const dlg = $('#fileDlg'), list = $('#fdList'), nameIn = $('#fdName'), msg = $('#fdMsg'), okBtn = $('#fdOk');
      const save = o.mode === 'save';
      const ext = o.exts[0];
      let dir = '', sep = '\\', sel = null, overwrite = null, last = null, done = false;
      $('#fdTitle').textContent = o.title;
      okBtn.textContent = o.ok || (save ? 'Save' : 'Open');
      $('#fdNameRow').hidden = !save;
      $('#fdExt').textContent = save ? ext : '';
      nameIn.value = o.name || '';
      msg.textContent = '';
      hooks.before();
      dlg.hidden = false;
      const join = (d, n) => d.replace(/[\\/]+$/, '') + sep + n;
      const finish = (v) => {
        if (done) return; done = true;
        closeNew(); dlg.hidden = true; dlg.removeEventListener('keydown', onKey, true);
        resolve(v); hooks.after();
      };
      const say = (t) => { msg.textContent = t || ''; };
      const lower = (s) => s.toLowerCase();
      const matches = (n) => !save || o.exts.some((x) => lower(n).endsWith(x)) ;
      async function go(d) {
        const r = await window.api.fsList({ dir: d, kind: o.kind });
        last = r; dir = r.dir; sep = r.sep; sel = null; overwrite = null;
        okBtn.textContent = o.ok || (save ? 'Save' : 'Open');
        say(r.error || '');
        $('#fdUp').disabled = !r.parent;
        $('#fdUp').onclick = () => r.parent && go(r.parent);
        const pl = $('#fdPlaces'); pl.innerHTML = '';
        const inside = (d, p) => { const a = lower(d).replace(/[\\/]+$/, ''), b = lower(p).replace(/[\\/]+$/, ''); return a === b || a.startsWith(b + '/') || a.startsWith(b + '\\'); };
        let best = null;
        for (const p of r.places) if (inside(r.dir, p.path) && (!best || p.path.length > best.path.length)) best = p;
        for (const p of r.places) {
          const b = document.createElement('button'); b.type = 'button'; b.textContent = p.name; b.title = p.path;
          if (p === best) b.classList.add('on');
          b.addEventListener('click', () => go(p.path)); pl.appendChild(b);
        }
        const cr = $('#fdCrumbs'); cr.innerHTML = '';
        const unc = r.dir.match(/^\\\\[^\\]+\\[^\\]+/); // \\server\share
        let acc, parts;
        if (unc) { acc = unc[0]; parts = r.dir.slice(acc.length).split(/[\\/]/).filter(Boolean); parts.unshift(null); }
        else { parts = r.dir.split(/[\\/]/).filter(Boolean); acc = r.dir.startsWith('/') ? '' : null; }
        parts.forEach((seg, i) => {
          if (seg === null) { /* the share itself */ }
          else acc = acc === null ? seg + sep : acc.replace(/[\\/]+$/, '') + sep + seg;
          const target = acc, label = seg === null ? unc[0] : seg;
          const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => go(target)); cr.appendChild(b);
          if (i < parts.length - 1) { const s = document.createElement('span'); s.textContent = '\u203a'; cr.appendChild(s); }
        });
        cr.scrollLeft = cr.scrollWidth;
        list.innerHTML = '';
        for (const en of r.entries) {
          const li = document.createElement('li'); li.setAttribute('role', 'option');
          li.className = en.dir ? 'dir' : (matches(en.name) ? 'file' : 'file dim');
          li.innerHTML = '<i aria-hidden="true"></i><span></span>'; li.lastChild.textContent = en.name;
          if (!en.dir && !matches(en.name) && save) li.classList.add('dim');
          if (!save && !en.dir && !o.exts.some((x) => lower(en.name).endsWith(x))) li.classList.add('dim');
          li.addEventListener('click', () => {
            if (en.dir) { list.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); li.classList.add('on'); sel = null; return; }
            list.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); li.classList.add('on'); sel = en.name;
            if (save) nameIn.value = en.name.replace(new RegExp(ext.replace('.', '\\.') + '$', 'i'), '');
            overwrite = null; okBtn.textContent = o.ok || (save ? 'Save' : 'Open'); say('');
          });
          li.addEventListener('dblclick', () => { if (en.dir) go(join(dir, en.name)); else { sel = en.name; accept(); } });
          list.appendChild(li);
        }
        if (!r.entries.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Empty folder'; list.appendChild(li); }
        list.scrollTop = 0;
      }
      async function accept() {
        if (save) {
          let n = nameIn.value.trim().replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (lower(n).endsWith(lower(ext))) n = n.slice(0, -ext.length).trim();
          n = n.replace(/[. ]+$/, '');
          if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n)) n += '_'; // names Windows refuses
          if (!n) { say('Type a name for the file.'); nameIn.focus(); return; }
          const p = join(dir, n + ext);
          if (overwrite !== p && await window.api.fsExists(p)) { overwrite = p; okBtn.textContent = 'Replace'; say(n + ext + ' already exists. Press Replace to overwrite it, or change the name.'); return; }
          window.api.fsRemember({ kind: o.kind, dir });
          finish(p);
        } else {
          if (!sel) { say('Choose a file.'); return; }
          window.api.fsRemember({ kind: o.kind, dir });
          finish(join(dir, sel));
        }
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if ($('#fdNew').dataset.open) closeNew(); else finish(null); }
        else if (e.key === 'Enter' && !e.target.closest('#fdNewRow') && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); accept(); }
        else if (e.key === 'Tab') { // keep focus inside the dialog
          const f = [...dlg.querySelectorAll('button:not(:disabled),input,ul[tabindex]')].filter((x) => x.offsetParent);
          if (!f.length) return;
          const i = f.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      }
      function closeNew() { const r = $('#fdNewRow'); if (r) r.remove(); delete $('#fdNew').dataset.open; }
      $('#fdNew').onclick = () => {
        if ($('#fdNew').dataset.open) { closeNew(); return; }
        $('#fdNew').dataset.open = '1';
        const li = document.createElement('li'); li.id = 'fdNewRow'; li.className = 'dir';
        li.innerHTML = '<i aria-hidden="true"></i><input type="text" aria-label="New folder name" placeholder="New folder name" autocomplete="off" spellcheck="false">';
        list.prepend(li);
        const inp = li.querySelector('input'); inp.focus();
        inp.addEventListener('keydown', async (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault(); e.stopPropagation();
          const r = await window.api.fsMkdir({ parent: dir, name: inp.value });
          if (r.error) say(r.error); else { closeNew(); go(r.path); }
        });
      };
      $('#fdCancel').onclick = () => finish(null);
      $('#fdSystem').onclick = () => finish('system');
      okBtn.onclick = accept;
      dlg.addEventListener('keydown', onKey, true);
      go(o.startDir || '').then(() => { (save ? nameIn : list).focus(); if (save) nameIn.select(); });
    });
  }

  window.QuireFiles = { pick };
})();
