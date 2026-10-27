/* =====================================================================
   Family Tree viewer — tree / table rendering, filters, pan & zoom, export.

   The tree is READ FROM SUPABASE ONLY, and only for a signed-in active user
   (Phase 1). There is no offline Excel fallback any more: the spreadsheet is
   imported into the database instead (database/04_seed_from_excel.sql, or the
   Admin screen's "Import from Excel").

   The detail panel and the edit dialog live here and in js/personform.js; the
   admin area is js/admin.js and the Phase 6 extras are js/extras.js. They reach
   the model through the window.FT surface defined at the bottom of this file.
   ===================================================================== */
(function () {
  'use strict';

  const SHEET_NAME = 'Family_Data';

  // Layout constants (px)
  const NW = 180, NH = 72, GX = 16, GY = 66, PAD = 90, SG = 26;
  const unitW = p => p.spouse ? NW * 2 + SG : NW;   // person card (+ spouse card)

  // Columns shown in the table view.
  // [internal field, i18n key]. The key is resolved at render time so the header row
  // follows the language like everything else.
  const TABLE_COLS = [
    ['id', 'table.col.id'], ['legacy_id', 'table.col.legacyId'], ['name', 'table.col.name'],
    ['nick', 'table.col.nick'], ['gen', 'table.col.gen'], ['gender', 'table.col.gender'],
    ['father', 'table.col.father'], ['mother', 'table.col.mother'], ['spouse', 'table.col.spouse'],
    ['spouseFather', 'table.col.spouseFather'], ['dob', 'table.col.dob'],
    ['dob_text', 'table.col.dobText'], ['pob', 'table.col.pob'], ['qual', 'table.col.qual'],
    ['dod', 'table.col.dod'], ['dod_text', 'table.col.dodText'], ['burial', 'table.col.burial'],
    ['name_ur', 'table.col.nameUr'], ['name_hi', 'table.col.nameHi'], ['notes', 'table.col.notes'],
    ['photo_path', 'table.col.photo'], ['source', 'table.col.source'], ['is_deleted', 'table.col.deleted']
  ];

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Auth is provided by js/auth.js (Supabase). app.js uses it for data source
  // selection and edit permissions; the tree still works statically without it.
  const Auth = (typeof window.Auth === 'object' && window.Auth) ? window.Auth : null;

  /* ------------------------------ State ------------------------------ */
  const S = {
    people: [], byId: new Map(), kids: new Map(), roots: [],
    collapsed: new Set(),
    f: { q: '', gens: new Set(), genders: new Set(), status: '', branch: '', pob: '', qual: '', has: '' },
    view: 'tree', selected: null, sourceLabel: '',
    showDeleted: false, _allRows: [], loadError: null,
    sort: { key: 'gen', dir: 1 },
    scale: 1, tx: 0, ty: 0, bbox: { w: 0, h: 0 }, pos: new Map(),
    editing: false, editForm: null, auditRows: []
  };

  /* ---------------------------- Data loading ---------------------------- */

  function fmtDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) {
      const d = new Date(v.getTime() + 12 * 3600 * 1000); // absorb timezone drift
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    }
    return String(v).trim() || null;
  }

  // Format a JS Date / Supabase date string as DD/MM/YYYY for display.
  function fmtSupabaseDate(v) {
    if (v == null || v === '') return null;
    let d = v instanceof Date ? v : parseDate(String(v));
    if (!d || isNaN(d.getTime())) return null;
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }

  // Phase 1: the tree comes from Supabase only, and only for an active signed-in user.
  async function loadData() {
    if (!(Auth && Auth.client && Auth.isAdminOrActive())) return [];
    const rows = await loadFromSupabase();
    return rows || [];
  }

  // Supabase caps a single response at 1000 rows, so page through. The sort order must
  // be unique (dob + id is) or rows can repeat or vanish between pages.
  const PAGE = 1000;

  // Supabase caps a single response at 1000 rows, so page through. The sort order must
  // be unique (dob + id is) or rows can repeat or vanish between pages.
    // Supabase caps a single response at 1000 rows, so page through.
  async function fetchAllPeople(admin) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      let q = Auth.client
        .from('people')
        .select('*')
        .order('dob', { ascending: true, nullsFirst: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      // The RLS policy already hides soft-deleted rows from non-admins; say it again so
      // this stays true if that policy is ever relaxed.
      if (!admin) q = q.eq('is_deleted', false);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out;
  }

  // Load the live tree from Supabase. Returns rows in the internal format, or null on
  // failure. Only ever called for an active signed-in user.
  async function loadFromSupabase() {
    if (!Auth || !Auth.client) return null;
    // Kept as an i18n KEY, not a finished string: the subtitle has to say the same
    // thing in every language, and the language can change after the data loaded.
    S.sourceLabel = 'source.supabase';
    try {
      // RLS already limits rows: active users only, soft-deleted hidden for non-admin.
      // We also filter client-side for clarity.
      const admin = Auth.isAdmin();
      const data = await fetchAllPeople(admin);
      if (!data.length) {
        // An empty database is not an error, but it still needs to be said out loud on
        // the page — otherwise the screen is blank and looks broken.
        showLoadError('generic.emptyTree');
        toast(I18n.t('generic.emptyTree'));
        return [];
      }
      const rows = data.map(r => {
        const p = {};
        p.id = r.id || null;
        p.legacy_id = r.legacy_id || null;
        p.parentId = r.parent_id || null;            // uuid — build() matches by id
        p.gender = r.gender || null;
        p.name = r.full_name || null;
        p.nick = r.nick_name || null;
        p.father = r.fathers_name || null;
        p.mother = r.mothers_name || null;
        p.spouse = r.spouse_name || null;
        p.spouseFather = r.spouse_father_name || null;
        p.dob = fmtSupabaseDate(r.dob);          // the real date — Age and sorting need this
        // The untouched ISO date as well: the edit dialog's <input type=date> only
        // accepts YYYY-MM-DD, and it must never rewrite a date just because the display
        // format is DD/MM/YYYY.
        p.dob_iso = r.dob ? String(r.dob).slice(0, 10) : null;
        p.dob_text = r.dob_text || null;
        // What the UI shows prefers the original text ("1965 (approx)", "12/3/1940") and only
        // falls back to the tidied date. Both stay available.
        p.dob_display = p.dob_text || p.dob;
        p.pob = r.place_of_birth || null;
        p.qual = r.qualification || null;
        p.dod = fmtSupabaseDate(r.dod);
        p.dod_iso = r.dod ? String(r.dod).slice(0, 10) : null;
        p.dod_text = r.dod_text || null;
        p.dod_display = p.dod_text || p.dod;
        p.burial = r.place_of_burial || null;
        p.name_ur = r.name_ur || null;
        p.name_hi = r.name_hi || null;
        p.notes = r.notes || null;
        p.photo_path = r.photo_path || null;
        p.source = r.source || null;
        p.is_deleted = !!(r.is_deleted);
        p.created_by = r.created_by || null;
        p.updated_by = r.updated_by || null;
        p.created_at = r.created_at ? new Date(r.created_at).toISOString() : null;
        p.updated_at = r.updated_at ? new Date(r.updated_at).toISOString() : null;
        // path (uuid[]) maintained by DB trigger — used by canEditPerson only
        p.path = (r.path && Array.isArray(r.path)) ? r.path.slice() : [];
        return p;
      }).filter(o => o.id && o.name);

      // Admin sees soft-deleted people too; non-admin never receive them (the RLS
      // people_select policy already excludes is_deleted rows for non-admin). As a
      // belt-and-suspenders guard, drop any deleted row a non-admin somehow received.
      const out = [];
      for (const p of rows) {
        if (p.is_deleted && !admin) continue;
        Auth.setPersonPath(p.id, p.path);
        out.push(p);
      }

      // Build model — same as the static path. parentId is a uuid; build() matches by id,
      // so spouses (stored as text) do not create parent links, which is correct.
      build(out);
      S.sourceLabel = 'source.supabase';
      clearLoadError();
      return out;
    } catch (err) {
      console.warn('loadFromSupabase failed:', err);
      const msg = err?.message || String(err);
      // Friendly mapping for common RLS / network errors. The key is stored so the
      // banner follows a language change instead of freezing in one language.
      const key = (msg.includes('invalid_token') || msg.includes('JWT'))
        ? 'generic.sessionExpired'
        : (msg.includes('not found') && msg.includes('table'))
          ? 'generic.noTable'
          : 'generic.loadFailed';
      showLoadError(key, { msg });
      toast(I18n.fmt(key, { msg }));
      return null;
    }
  }

  /* ----------------------------- Build model ----------------------------- */
  function build(rows) {
    // Keep every fetched row so the "Show deleted" toggle can rebuild without re-fetching.
    S._allRows = rows;
    // Soft-deleted people only join the model when the toggle is on (admins only).
    rows = rows.filter(p => !(p.is_deleted && !S.showDeleted));
    S.people = rows;
    S.byId = new Map(rows.map(p => [p.id, p]));
    S.kids = new Map(rows.map(p => [p.id, []]));
    S.roots = [];
    for (const p of rows) {
      if (p.parentId && S.byId.has(p.parentId) && p.parentId !== p.id) S.kids.get(p.parentId).push(p);
      else S.roots.push(p);
    }
    // depth from the tree structure (more reliable than the Generation column)
    const walk = (p, d, seen) => {
      if (seen.has(p.id)) return; seen.add(p.id);
      p.gen = d; p.parent = p.parentId && S.byId.get(p.parentId) || null;
      S.kids.get(p.id).forEach(c => walk(c, d + 1, seen));
    };
    const seen = new Set();
    S.roots.forEach(r => walk(r, 0, seen));
    // anything stuck in a parent loop becomes a root
    rows.forEach(p => { if (!seen.has(p.id)) { S.roots.push(p); walk(p, 0, seen); } });
    // Spouse linkage: spouse_name is TEXT in the database, but when the married-in
    // person also has their own record (anywhere in the tree), resolve it so that
    // clicking the spouse card opens THAT person's own record — not the partner's.
    const norm = s => String(s || '').trim().toLowerCase().replace(/s+/g, ' ');
    const byName = new Map(rows.map(p => [norm(p.name), p]));
    S.spouseLink = new Map();   // ownerId -> canonical spouse person id (when one exists)
    rows.forEach(p => {
      const hit = p.spouse && byName.get(norm(p.spouse));
      if (hit && hit.id !== p.id) p.spousePid = hit.id;
      else p.spousePid = null;
    });

    // text for searching
    rows.forEach(p => {
      // The search box matches the English name, the Urdu spelling and the Hindi
      // spelling, so a relative can search in whichever script they think in.
      p._hay = [p.id, p.name, p.name_ur, p.name_hi, p.nick, p.spouse, p.dob, p.dob_text, p.pob, p.qual, p.dod, p.dod_text, p.burial]
        .filter(Boolean).join(' ').toLowerCase();
      p._initials = initials(p.name);
    });
  }

  function initials(name) {
    const w = name.replace(/^(syed|syeda|mohammed|md|mohd)\s+/i, '').split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
  }
  const gcls = p => /^m/i.test(p.gender || '') ? 'male' : /^f/i.test(p.gender || '') ? 'female' : 'unknown';

  // The name shown on screen. When Urdu or Hindi is the active language and the family
  // has supplied a spelling, that one is used; otherwise the English name.
  function dispName(p) {
    if (!p) return '';
    const lang = I18n.currentLang();
    if (lang === 'ur' && p.name_ur) return p.name_ur;
    if (lang === 'hi' && p.name_hi) return p.name_hi;
    return p.name || '';
  }
  // Gender is STORED as Male/Female; only the label is translated.
  function genderLabel(g) {
    if (/^m/i.test(g || '')) return I18n.t('chip.male');
    if (/^f/i.test(g || '')) return I18n.t('chip.female');
    return I18n.t('panel.genderUnknown');
  }
  const fieldLabel = col => I18n.t(FIELD_LABELS[col] || col);

  /* ----------------------------- Date helpers ----------------------------- */
  function parseDate(s) {
    if (!s) return null;
    let m = String(s).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    m = String(s).match(/^(\d{4})$/);
    if (m) return new Date(Date.UTC(+m[1], 0, 1));
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function yearsBetween(a, b) {
    let y = b.getUTCFullYear() - a.getUTCFullYear();
    const m = b.getUTCMonth() - a.getUTCMonth();
    if (m < 0 || (m === 0 && b.getUTCDate() < a.getUTCDate())) y--;
    return y;
  }
  function ageText(p) {
    const b = parseDate(p.dob); if (!b) return null;
    const d = parseDate(p.dod);
    if (p.dod && !d) return null;
    const y = yearsBetween(b, d || new Date());
    if (y < 0) return null;
    return d ? I18n.fmt('panel.ageAtDeath', { n: y }) : I18n.fmt('panel.ageValue', { n: y });
  }
  // Timestamps (created_at/updated_at/changed_at) as a local, human-readable string.
  function fmtWhen(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  /* ------------------------------- Filters ------------------------------- */
  const isDescendant = (p, branchId) => { for (let c = p; c; c = c.parent) if (c.id === branchId) return true; return false; };

  function filterActive() {
    const f = S.f;
    return !!(f.q || f.gens.size || f.genders.size || f.status || f.branch || f.pob || f.qual || f.has);
  }
  function matches(p) {
    const f = S.f;
    if (f.q && !f.q.split(/\s+/).every(t => p._hay.includes(t))) return false;
    if (f.gens.size && !f.gens.has(p.gen)) return false;
    if (f.genders.size && !f.genders.has(gcls(p))) return false;
    if (f.status === 'deceased' && !p.dod) return false;
    if (f.status === 'living' && p.dod) return false;
    if (f.branch && !isDescendant(p, f.branch)) return false;
    if (f.pob && p.pob !== f.pob) return false;
    if (f.qual && p.qual !== f.qual) return false;
    if (f.has === 'dob' && !p.dob) return false;
    if (f.has === 'spouse' && !p.spouse) return false;
    if (f.has === 'children' && !S.kids.get(p.id).length) return false;
    if (f.has === 'nochildren' && S.kids.get(p.id).length) return false;
    return true;
  }

  /* --------------------------- Sidebar controls --------------------------- */
  function uniq(key) { return [...new Set(S.people.map(p => p[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }

  function buildControls() {
    // generation chips
    const gens = [...new Set(S.people.map(p => p.gen))].sort((a, b) => a - b);
    const gc = $('#genChips'); gc.innerHTML = '';
    gens.forEach(g => gc.append(chip(I18n.fmt('chip.gen', { g }), () => toggle(S.f.gens, g), () => S.f.gens.has(g))));
    // gender chips — the stored value stays 'Male'/'Female', only the label is translated
    const gd = $('#genderChips'); gd.innerHTML = '';
    [['male', 'chip.male'], ['female', 'chip.female']].forEach(([k, key]) =>
      gd.append(chip(I18n.t(key), () => toggle(S.f.genders, k), () => S.f.genders.has(k))));

    fillSelect($('#fBranch'), [['', I18n.t('filter.allBranches')]].concat(
      S.people.filter(p => S.kids.get(p.id).length).sort((a, b) => a.gen - b.gen || a.name.localeCompare(b.name))
        .map(p => [p.id, `${'· '.repeat(p.gen)}${dispName(p)}`])));
    fillSelect($('#fPob'), [['', I18n.t('filter.anyPlace')]].concat(uniq('pob').map(v => [v, v])));
    fillSelect($('#fQual'), [['', I18n.t('filter.anyQual')]].concat(uniq('qual').map(v => [v, v])));
  }
  function fillSelect(sel, opts) { sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''); }
  function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
  function chip(label, onToggle, isOn) {
    const b = el('button', 'chip' + (isOn() ? ' on' : ''), esc(label));
    b.onclick = () => { onToggle(); b.classList.toggle('on', isOn()); refresh(); };
    return b;
  }

  function bindControls() {
    let t;
    $('#search').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { S.f.q = e.target.value.trim().toLowerCase(); refresh(); }, 120); });
    [['#fStatus', 'status'], ['#fBranch', 'branch'], ['#fPob', 'pob'], ['#fQual', 'qual'], ['#fHas', 'has']]
      .forEach(([sel, key]) => $(sel).addEventListener('change', e => { S.f[key] = e.target.value; if (key === 'branch' && e.target.value) S.collapsed.delete(e.target.value); refresh(true); }));

    $('#viewSwitch').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      S.view = b.dataset.view;
      // Leaving tree/table while the branch workspace is open closes it cleanly so
      // the two entry points can never fight over what is on screen.
      if (window.Branch && Branch.isOpen()) Branch.goBackToTree();
      [...$('#viewSwitch').children].forEach(x => x.classList.toggle('on', x === b));
      $('#treeView').hidden = S.view !== 'tree';
      $('#tableView').hidden = S.view !== 'table';
      refresh(true);
    });
    $('#btnReset').onclick = resetFilters;
    // The empty-state 'Clear all filters' button shares resetFilters with the sidebar.
    const clearBtn = $('#btnClearFilters'); if (clearBtn) clearBtn.onclick = resetFilters;
    // Mobile filter drawer - ONE source of truth.
    // Root cause of the old unreliable toggling: three independent listeners each
    // poked the same class, Escape never closed the drawer, and the backdrop's
    // hidden state could drift out of sync with the class. Now every path goes
    // through one controller, which also keeps aria-expanded + the backdrop honest.
    let drawerOn = false;   // ONE source of truth - never sniffed back off the DOM
    const drawer = {
      set(on) {
        drawerOn = !!on;
        $('#sidebar').classList.toggle('open', drawerOn);
        const b = $('#drawerBackdrop'); if (b) b.hidden = !drawerOn;
        const btn = $('#btnFilters');
        if (btn) {
          btn.setAttribute('aria-expanded', String(drawerOn));
          btn.textContent = drawerOn ? '×' : '☰';   // state shown, not just implied
        }
      },
      open() { if (!drawerOn) this.set(true); },
      close() { if (drawerOn) this.set(false); },
      toggle() { this.set(!drawerOn); },
      isOpen() { return drawerOn; }
    };
    // One source of truth for every closer (button, backdrop, Escape, branch.js):
    // exposed here where `drawer` is in scope - a top-level export would throw.
    window.drawer = drawer;
    const drawerOpenBtn = $('#btnFilters');
    if (drawerOpenBtn) {
      drawerOpenBtn.setAttribute('aria-expanded', 'false');
      drawerOpenBtn.setAttribute('aria-controls', 'sidebar');
      // ONE click path: the button always toggles, whatever state it is in.
      drawerOpenBtn.onclick = () => drawer.toggle();
    }
    // Escape closes the open drawer (mobile), before any other Escape handler runs.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !drawer.isOpen()) return;
      e.stopPropagation();
      drawer.close();
    });
    const backdrop = $('#drawerBackdrop');
    if (backdrop) backdrop.onclick = () => drawer.close();
    const drawerClose = $('#btnDrawerClose');
    if (drawerClose) drawerClose.onclick = () => drawer.close();
    ['#fStatus', '#fBranch', '#fPob', '#fQual', '#fHas'].forEach(sel => {
      $(sel).addEventListener('change', () => { if (drawer.isOpen()) drawer.close(); });
    });
    $('#btnTheme').onclick = () => {
      const r = document.documentElement;
      const next = r.dataset.theme === 'dark' ? 'light' : 'dark';
      r.dataset.theme = next;
      try { localStorage.setItem('ft-theme', next); } catch (e) { /* ignore */ }
    };
    $('#btnAdmin').onclick = () => { if (Auth && Auth.isAdmin()) openAdminPanel(); };
    $('#btnRefresh').onclick = () => syncFromServer(false);
    $('#btnExport').onclick = exportToExcel;
    // Phase 6 tools: relationship lookup, upcoming dates, statistics, print / PNG.
    const toolsBtn = $('#btnTools');
    if (toolsBtn) toolsBtn.onclick = () => { if (window.Extras) Extras.open(); };
    // "Show deleted" rebuilds the model from rows already fetched — no second round trip.
    $('#showDeleted').addEventListener('change', e => {
      S.showDeleted = !!e.target.checked;
      if (S._allRows.length) init(S._allRows);
    });
    // Refresh the admin button, close the admin panel on sign-out, and re-load the tree
    // whenever the signed-in state or profile settles. The very first load happens
    // before the session/profile is known, so without this a signed-in active user
    // would keep seeing the static tree instead of the live Supabase one.
    const onAuthStateSettled = () => {
      const admin = !!(Auth && Auth.isAdmin());
      $('#btnAdmin').hidden = !admin;
      $('#btnExport').hidden = !admin;     // exporting the whole tree is admin-only
      $('#deletedField').hidden = !admin;  // so is looking at soft-deleted people
      if (window.Branch) Branch.updateNav();
      if (admin) startLiveUpdates(); else stopLiveUpdates();
      if (adminPanelOpen() && !admin) closeAdminPanel();
      reloadData();
      // Re-draw the open panel: it may have been rendered before branch_access arrived,
      // which is what decides whether an editor sees the edit buttons.
      if (S.selected) renderPanel();
    };
    if (Auth) Auth._callbacks.onAuthChange = onAuthStateSettled;
    if (Auth && Auth.isAdmin()) $('#btnAdmin').hidden = false;

    // Language toggle: opens a small picker; chosen language is persisted on the
    // user's profile (if signed in) and in localStorage. The I18n module handles
    // re-applying [data-i18n] attributes across the page.
    $('#btnLang').onclick = () => toggleLangPicker();
    window.addEventListener('click', e => { if (!e.target.closest('.lang-picker') && !e.target.closest('#btnLang')) closeLangPicker(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape') closeLangPicker(); });
    // When the user's profile language changes (profile edit / admin panel), push it
    // to the i18n module.
    if (Auth) Auth._callbacks.onProfileChange = (prof) => {
      if (prof && prof.language) I18n.setLanguage(prof.language);
      onAuthStateSettled();
      // The guided "My Family Branch" workspace (js/branch.js) picks its destination
      // from the trusted profile + branch_access here — never from the URL.
      if (window.Branch) Branch.onProfileReady(prof);
    };
    // Initialise i18n from the profile if known, else from localStorage.
    if (Auth && Auth.profile && Auth.profile.language) I18n.setLanguage(Auth.profile.language);
    else if (localStorage.getItem('ft-lang')) I18n.setLanguage(localStorage.getItem('ft-lang'));
    I18n.apply();

    $('#zoomIn').onclick = () => zoomBy(1.25);
    $('#zoomOut').onclick = () => zoomBy(1 / 1.25);
    $('#zoomFit').onclick = fit;
    $('#expandAll').onclick = () => { S.collapsed.clear(); refresh(true); };
    $('#collapseAll').onclick = () => { S.people.forEach(p => { if (S.kids.get(p.id).length) S.collapsed.add(p.id); }); refresh(true); };
    window.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
    window.addEventListener('resize', () => { if (S.view === 'tree') fit(); });
  }

  function resetFilters() {
    Object.assign(S.f, { q: '', status: '', branch: '', pob: '', qual: '', has: '' });
    S.f.gens.clear(); S.f.genders.clear();
    $('#search').value = '';
    ['#fStatus', '#fBranch', '#fPob', '#fQual', '#fHas'].forEach(s => $(s).value = '');
    document.querySelectorAll('.chip.on').forEach(c => c.classList.remove('on'));
    refresh(true);
  }

  /* ------------------------------- Rendering ------------------------------- */
  // Filters REMOVE everyone who doesn't match. Matching people whose parents were removed are re-attached to their
  // nearest remaining ancestor; with a Branch filter the chosen person becomes the starting point.
  let visible = null;   // Set of ids shown, or null for "everyone"
  let matchSet = new Set();
  let vKids = new Map(), vRoots = [];

  function computeVisibility() {
    matchSet = new Set(S.people.filter(matches).map(p => p.id));
    if (!filterActive()) { visible = null; vKids = S.kids; vRoots = S.roots; return; }
    visible = new Set(matchSet);
    if (S.f.branch) visible.add(S.f.branch);
    vKids = new Map(S.people.map(p => [p.id, []])); vRoots = [];
    S.people.forEach(p => {
      if (!visible.has(p.id)) return;
      let a = p.parent; while (a && !visible.has(a.id)) a = a.parent;
      (a ? vKids.get(a.id) : vRoots).push(p);
    });
  }
  const shownKids = p => vKids.get(p.id) || [];

  function refresh(refit) {
    computeVisibility();
    renderStats();
    renderLoadError();
    if (S.view === 'tree') renderTree(refit); else renderTable();
    renderPanel();
    // Dynamic markup (stats, panel, table) carries data-i18n attributes, so re-apply
    // translations after every render.
    I18n.apply();
  }

  function renderStats() {
    const n = S.people.length, gens = new Set(S.people.map(p => p.gen)).size;
    const dec = S.people.filter(p => p.dod).length;
    $('#stats').innerHTML =
      `<div class="stat"><b>${n}</b><span data-i18n>stats.people</span></div>` +
      `<div class="stat"><b>${gens}</b><span data-i18n>stats.generations</span></div>` +
      `<div class="stat"><b>${dec}</b><span data-i18n>stats.deceased</span></div>`;
    $('#subtitle').textContent = I18n.fmt('brand.subtitle', {
      n, g: gens, source: S.sourceLabel ? I18n.t(S.sourceLabel) : ''
    });
    const rc = $('#resultCount');
    rc.textContent = filterActive()
      ? I18n.fmt('table.resultCount.filtered', { shown: S.view === 'tree' && visible ? visible.size : matchSet.size, n })
      : I18n.fmt('table.resultCount.all', { n });
  }

  /* ---- Tree layout (top-down, subtree-width based) ---- */
  function layout() {
    const pos = new Map();
    const roots = vRoots;
    S.minGen = roots.length ? Math.min(...roots.map(r => r.gen)) : 0;
    const width = p => {
      const k = S.collapsed.has(p.id) ? [] : shownKids(p);
      const w = k.length ? Math.max(unitW(p), k.reduce((s, c) => s + width(c), 0) + GX * (k.length - 1)) : unitW(p);
      p._w = w; return w;
    };
    const place = (p, left) => {
      pos.set(p.id, { x: left + p._w / 2 - unitW(p) / 2, y: (p.gen - S.minGen) * (NH + GY), w: unitW(p) });
      const k = S.collapsed.has(p.id) ? [] : shownKids(p);
      if (!k.length) return;
      const total = k.reduce((s, c) => s + c._w, 0) + GX * (k.length - 1);
      let x = left + (p._w - total) / 2;
      k.forEach(c => { place(c, x); x += c._w + GX; });
    };
    let x = 0;
    roots.forEach(r => { width(r); place(r, x); x += r._w + GX * 2; });
    return { pos, roots };
  }

  function renderTree(refit) {
    const world = $('#world');
    const { pos, roots } = layout();
    S.pos = pos;
    $('#emptyMsg').hidden = !(filterActive() && !matchSet.size);
    if (!pos.size) { world.innerHTML = ''; return; }

    let maxX = 0, maxY = 0;
    pos.forEach((v, id) => { maxX = Math.max(maxX, v.x + v.w); maxY = Math.max(maxY, v.y + NH); });
    const W = maxX + PAD * 2, H = maxY + PAD * 2;
    S.bbox = { w: W, h: H };
    const ox = PAD, oy = PAD;   // content offset inside the world

    let html = '';
    // generation bands
    const gensUsed = new Set([...pos.keys()].map(id => S.byId.get(id).gen));
    gensUsed.forEach(g => {
      if (g % 2) return;
      html += `<div class="band" style="top:${oy + (g - S.minGen) * (NH + GY) - GY / 2}px;height:${NH + GY}px;width:${W}px"><span>${esc(I18n.fmt('panel.generation', { n: g }))}</span></div>`;
    });
    // edges
    let edges = '';
    pos.forEach((v, id) => {
      const p = S.byId.get(id);
      if (S.collapsed.has(id)) return;
      shownKids(p).forEach(c => {
        const q = pos.get(c.id); if (!q) return;
        const x1 = ox + v.x + v.w / 2, y1 = oy + v.y + NH, x2 = ox + q.x + q.w / 2, y2 = oy + q.y, my = y1 + (y2 - y1) / 2;
        edges += `<path class="edge" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
      });
    });
    html += `<svg width="${W}" height="${H}">${edges}</svg>`;
    // nodes
    const canEditAny = !!(Auth && Auth.isActiveEditor && (Auth.isAdmin() || Auth.isActiveEditor()));
    pos.forEach((v, id) => {
      const p = S.byId.get(id);
      const nk = shownKids(p).length;
      const cls = ['node', gcls(p)];
      // Re-renders must reproduce exactly what the user clicked: a main card is
      // marked selected only when S.selected is THIS person and the selection was
      // not made from a spouse card; the spouse card block below owns that case.
      if (S.selected === id && !S.selectedFromSpouseCard) cls.push('selected');
      if (p.is_deleted) cls.push('deleted');
      const canAdd = canEditAny && Auth.canEditPerson(id);
      const tg = nk ? `<button class="tg" data-tg="${esc(id)}" style="left:${ox + v.x + v.w / 2}px;top:${oy + v.y + NH - 11}px" title="${esc(S.collapsed.has(id) ? I18n.t('tg.expand') : I18n.t('tg.collapse'))}">${S.collapsed.has(id) ? '+ ' + nk : '−'}</button>` : '';
      html += `<div class="${cls.join(' ')}" data-id="${esc(id)}" style="left:${ox + v.x}px;top:${oy + v.y}px;width:${NW}px;height:${NH}px">
        <div class="avatar">${esc(p._initials)}${p.photo_path ? `<img class="node-photo" data-card-photo="${esc(p.photo_path)}" alt="" hidden>` : ''}</div>
        <div class="meta"><div class="nm">${esc(dispName(p))}</div>${p.nick ? `<div class="nk">“${esc(p.nick)}”</div>` : ''}</div>
        ${(p.dod || p.is_deleted) ? `<span class="dag" title="${esc([p.dod ? I18n.t('panel.deceased') : '', p.is_deleted ? I18n.t('panel.deleted') : ''].filter(Boolean).join(' · '))}">${p.dod ? '†' : ''}${p.is_deleted ? '✕' : ''}</span>` : ''}
        ${canAdd ? `<button type="button" class="add-kid" data-addkid="${esc(id)}" title="${esc(I18n.t('panel.addChild'))}" aria-label="${esc(I18n.t('panel.addChild'))}">＋</button>` : ''}</div>`;
      if (p.spouse) {
        const sg = gcls(p) === 'male' ? 'female' : gcls(p) === 'female' ? 'male' : 'unknown';
        const sx = ox + v.x + NW;
        html += `<div class="spouse-link" style="left:${sx}px;top:${oy + v.y + NH / 2}px;width:${SG}px"><i>♥</i></div>
          <div class="node spouse ${sg}${(p.spousePid && S.selected === p.spousePid && S.selectedFromSpouseCard) || (!p.spousePid && S.virtualSpouseOf && S.virtualSpouseOf === id) ? ' selected' : ''}" data-id="${esc(id)}" data-spouse="1"${p.spousePid ? ` data-spouse-pid="${esc(p.spousePid)}"` : ''} style="left:${sx + SG}px;top:${oy + v.y}px;width:${NW}px;height:${NH}px">
          <div class="avatar">${esc(initials(p.spouse))}</div>
          <div class="meta"><div class="nm">${esc(p.spouse)}</div><div class="nk">${esc(I18n.fmt('panel.spouseOf', { name: p.nick || dispName(p) }))}</div></div>
          ${canAdd ? `<button type="button" class="add-kid" data-addkid="${esc(id)}" title="${esc(I18n.t('panel.addChild'))}" aria-label="${esc(I18n.t('panel.addChild'))}">＋</button>` : ''}</div>`;
      }
      html += tg;
    });
    world.innerHTML = html;
    world.style.width = W + 'px'; world.style.height = H + 'px';
    hydrateCardPhotos();
    if (refit) fit(); else applyTransform();
  }
  // Cards show the person's photo instead of their initials. All the URLs for the whole
  // tree are fetched in ONE signed-URL request (hundreds of cards would otherwise mean
  // hundreds of round trips); each image stays hidden until it actually loads, so a
  // missing or broken photo silently falls back to the initials.
  async function hydrateCardPhotos() {
    if (!(Auth && Auth.client && window.Photos && Photos.signedUrls)) return;
    const imgs = [...document.querySelectorAll('#world img[data-card-photo]')];
    if (!imgs.length) return;
    const paths = [...new Set(imgs.map(i => i.getAttribute('data-card-photo')))].filter(Boolean);
    let urls = null;
    try {
      urls = await Photos.signedUrls(paths);
    } catch (e) {
      console.warn('Could not sign the card photos:', e);
      return;
    }
    if (!urls) return;
    imgs.forEach(img => {
      const path = img.getAttribute('data-card-photo');
      const url = urls.get(Photos.toKey ? Photos.toKey(path) : path);
      if (!url) return;
      img.addEventListener('load', () => { img.hidden = false; }, { once: true });
      img.addEventListener('error', () => { img.hidden = true; }, { once: true });
      img.src = url;
    });
  }

  /* ---- Pan / zoom ---- */
  function applyTransform() { $('#world').style.transform = `translate(${S.tx}px,${S.ty}px) scale(${S.scale})`; }
  function fit() {
    const st = $('#treeView'); if (!st || !S.bbox.w) return;
    const vw = st.clientWidth, vh = st.clientHeight;
    // Never shrink below a readable size; if the tree is wider than the screen, start centred on the first root and pan.
    const s = Math.min(1, Math.min(vw / S.bbox.w, (vh - 40) / S.bbox.h));
    S.scale = Math.max(.55, s);
    if (S.bbox.w * S.scale <= vw) S.tx = (vw - S.bbox.w * S.scale) / 2;
    else {
      const first = [...S.pos.values()].sort((a, b) => a.y - b.y || a.x - b.x)[0];
      if (vRoots.length > 1) S.tx = 30 - PAD * S.scale;   // several starting points: begin at the left edge
      else S.tx = vw / 2 - (PAD + (first ? first.x + first.w / 2 : 0)) * S.scale;
    }
    S.ty = Math.max(20, (vh - S.bbox.h * S.scale) / 2 - 10);
    if (S.bbox.h * S.scale > vh) S.ty = 20 - PAD * S.scale + 40;
    applyTransform();
  }
  function zoomAt(f, cx, cy) {
    const ns = Math.min(2.2, Math.max(.2, S.scale * f)), r = ns / S.scale;
    S.tx = cx - (cx - S.tx) * r; S.ty = cy - (cy - S.ty) * r; S.scale = ns; applyTransform();
  }
  function zoomBy(f) { const st = $('#treeView'); zoomAt(f, st.clientWidth / 2, st.clientHeight / 2); }

  function bindStage() {
    const st = $('#treeView'), world = $('#world');
    st.addEventListener('wheel', e => {
      e.preventDefault();
      const r = st.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    let drag = null, moved = false;
    // Track whether the pointer started on a person node
    let dragStartedOnNode = false;
    // Touch: two-finger pinch zoom, one-finger pan, double-tap zoom.
    const active = new Map();            // pointerId -> {x, y}
    let pinch = null;                     // {dist, cx, cy} while two fingers are down
    const pt = e => ({ x: e.clientX, y: e.clientY });

    st.addEventListener('pointerdown', e => {
      // Record every finger first; the multi-touch decision below uses `active`.
      active.set(e.pointerId, pt(e));
      // Capture on the CONTAINER, never on a card: the tree body is re-rendered
      // whenever a person is selected, so a card is not a stable event target.
      // With the container holding the capture, pointerup/cancel always come back
      // here and the gesture state can never be orphaned.
      try { st.setPointerCapture(e.pointerId); } catch (err) { /* already lost */ }
      // Allow dragging to start from any node (person, spouse) or empty space.
      // If we start on a node, mark it so we can distinguish tap from drag later.
      dragStartedOnNode = !!e.target.closest('.node, .tg, .spouse-link');
      if (active.size >= 2) {
        // A second finger down turns the drag into a pinch. Position it mid-gesture
        // so the tree does not jump when the fingers move apart.
        drag = null;
        moved = true;                       // a pinch must never open a card on release
        if (active.size === 2) {
          const [a, b] = [...active.values()];
          pinch = {
            dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2
          };
        }
        st.classList.add('dragging');
        return;
      }
      // Single finger: pan from anywhere on the stage. The drag threshold decides
      // tap vs drag when the finger lifts.
      drag = { x: e.clientX, y: e.clientY, tx: S.tx, ty: S.ty }; moved = false;
      st.classList.add('dragging');
    });

    st.addEventListener('pointermove', e => {
      if (active.has(e.pointerId) && pinch && active.size >= 2) {
        active.set(e.pointerId, pt(e));
        const [a, b] = [...active.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const r = st.getBoundingClientRect();
        zoomAt(dist / pinch.dist, pinch.cx - r.left, pinch.cy - r.top);
        pinch.dist = dist;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 10) moved = true;
      S.tx = drag.tx + dx; S.ty = drag.ty + dy; applyTransform();
    });
    const end = (e) => {
      if (e && e.pointerId != null && st.hasPointerCapture && st.hasPointerCapture(e.pointerId)) {
        try { st.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      }
      active.delete(e && e.pointerId);
      if (active.size < 2) pinch = null;
      if (!active.size) { drag = null; st.classList.remove('dragging'); }
    };
    // If the browser drops the capture (DOM churn, gesture interruptions), clean
    // (pointer) session for that pointer the same way as a real release would.
    st.addEventListener('lostpointercapture', e => { if (active.has(e.pointerId)) end(e); });
    // Drag: if movement exceeds threshold, it's a drag (don't click).
    // If movement is below threshold, treat as tap (open person details).
    st.addEventListener('pointerup', e => {
      // CLEANUP FIRST, ALWAYS. The old version returned early inside the tap
      // branches without calling end(e), so a successful spouse-card tap orphaned
      // the whole pointer session: `active` kept the id, `drag` stayed set, the
      // `dragging` class stayed on the container, and the next stray pointermove
      // panned the tree as if the finger were still down.
      const tapHit = dragStartedOnNode && !moved && active.has(e.pointerId);
      let tapNode = null;
      if (tapHit) {
        const n = e.target.closest('.node');
        if (n && !e.target.closest('[data-act]') && n.dataset.id) tapNode = n;
      }
      end(e);
      // Selection runs AFTER the session is fully cleared. The re-render that
      // select()/focusPerson() trigger can never then compete with the gesture.
      if (!tapNode) return;
      const n = tapNode;
      const id = n.dataset.id, spid = n.dataset.spousePid || null;
      const openIt = () => {
        // A spouse card is its own identity: the spouse's own record when it
        // exists (data-spouse-pid), otherwise the virtual profile of that spouse.
        if (n.dataset.spouse === '1') {
          if (spid) select(spid, { focus: true, card: 'spouse' });
          else select(id, { virtualSpouseOf: id, focus: true, card: 'spouse' });
        } else {
          select(id);
        }
      };
      setTimeout(openIt, 0);   // defer past the click that completes this tap
    });
    st.addEventListener('pointercancel', end);
    // Double-click / double-tap zooms in at the tap point.
    st.addEventListener('dblclick', e => {
      if (e.target.closest('.node, .tg, .stage-ctrls, .legend')) return;
      const r = st.getBoundingClientRect();
      zoomAt(1.3, e.clientX - r.left, e.clientY - r.top);
    });

    // Cards: click (details), toggle button (collapse), hover (tooltip)
    world.addEventListener('click', e => {
      // The small + on a card adds a child to that person without selecting them.
      const addKid = e.target.closest('[data-addkid]');
      if (addKid) { const p = S.byId.get(addKid.dataset.addkid); if (p) startAddChild(p); return; }
      const tg = e.target.closest('.tg');
      if (tg) {
        const id = tg.dataset.tg, before = S.pos.get(id);
        S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id); hideTip(); refresh(false);
        // keep the clicked person where it was on screen while the layout re-centres around the new branch
        const after = S.pos.get(id);
        if (before && after) { S.tx -= (after.x + after.w / 2 - before.x - before.w / 2) * S.scale; S.ty -= (after.y - before.y) * S.scale; applyTransform(); }
        return;
      }
      // Select the person whose card was clicked.
      // A spouse card is its OWN identity, not an alias of the owner's card:
      //   * linked spouse (married-in person has an own record) -> open that record;
      //   * text-only spouse -> virtual profile built from the owner's record.
      if (moved) return;   // a drag that ends over a card must not open it
      const n = e.target.closest('.node');
      if (n) {
        if (n.dataset.spouse === '1') {
          const spid = n.dataset.spousePid || null;
          if (spid) { select(spid, { focus: true, card: 'spouse' }); return; }
          select(n.dataset.id, { virtualSpouseOf: n.dataset.id, focus: true, card: 'spouse' });
          return;
        }
        select(n.dataset.id);
      }
    });
    world.addEventListener('mouseover', e => {
      const n = e.target.closest('.node'); if (!n || e.target.closest('.tg')) return;
      if (n === tipNode) return; tipNode = n;
      // A linked spouse card shows the spouse's OWN record in its tooltip.
      if (n.dataset.spouse) {
        const spid = n.dataset.spousePid || null;
        spid ? showTip(S.byId.get(spid), n) : showSpouseTip(S.byId.get(n.dataset.id), n);
      } else showTip(S.byId.get(n.dataset.id), n);
    });
    world.addEventListener('mouseout', e => {
      const n = e.target.closest('.node'); if (!n) return;
      if (e.relatedTarget && n.contains(e.relatedTarget)) return; hideTip();
    });
    world.addEventListener('mousemove', e => { if (tipNode) moveTip(e); });
  }

  /* ------------------------------ Tooltip ------------------------------ */
  let tipNode = null;
  function showTip(p, node) {
    const kids = (S.kids.get(p.id) || []).length;
    const rows = [
      [I18n.t('tooltip.generation'), I18n.fmt('tooltip.genShort', { n: p.gen })],
      [I18n.t('edit.spouse'), p.spouse],
      [I18n.t('tooltip.born'), [p.dob_display || p.dob, p.pob].filter(Boolean).join(' · ')],
      [I18n.t('edit.qual'), p.qual],
      [I18n.t('tooltip.died'), p.dod_display || p.dod],
      [I18n.t('tooltip.children'), kids || null]
    ].filter(r => r[1] != null && r[1] !== '');
    const tip = $('#tooltip');
    tip.innerHTML = `<h4>${esc(dispName(p))}</h4><div class="sub">${p.nick ? esc(I18n.fmt('panel.nick', { nick: p.nick })) + ' · ' : ''}${esc(genderLabel(p.gender))}</div>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="more">${esc(I18n.t('tooltip.more'))}</div>`;
    tip.hidden = false;
    const r = node.getBoundingClientRect();
    placeTip(r.right + 12, r.top);
    tip._anchor = r;
  }
  function showSpouseTip(p, node) {
    const tip = $('#tooltip');
    const rows = [
      [I18n.t('edit.spouse'), p.spouse],
      [I18n.t('edit.spouseFather'), p.spouseFather],
      [I18n.t('panel.spouseOf'), p.nick || dispName(p)]
    ].filter(r => r[1] != null && r[1] !== '');
    tip.innerHTML = `<h4>${esc(p.spouse)}</h4><div class="sub">${esc(I18n.fmt('panel.spouseOf', { name: dispName(p) }))}</div>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="more">${esc(I18n.t('tooltip.more'))}</div>`;
    tip.hidden = false;
    const r = node.getBoundingClientRect();
    placeTip(r.right + 12, r.top);
    tip._anchor = r;
  }
  function placeTip(x, y) {
    const tip = $('#tooltip'), w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > innerWidth - 10) x = Math.max(10, x - w - ($('#tooltip')._anchor ? $('#tooltip')._anchor.width : 0) - 24);
    if (y + h > innerHeight - 10) y = innerHeight - h - 10;
    tip.style.left = x + 'px'; tip.style.top = Math.max(10, y) + 'px';
  }
  function moveTip() { /* anchored to the card, nothing to do */ }
  function hideTip() { tipNode = null; $('#tooltip').hidden = true; }

  /* ----------------------------- Detail panel ----------------------------- */
  // Selecting a person, a LINKED spouse card, or a VIRTUAL spouse card:
  //   * a normal person card passes the record id straight through;
  //   * a spouse card whose married-in person has an OWN record opens that record
  //     (data-spouse-pid) — the spouse genuinely has their own profile;
  //   * a spouse card with only spouse_name text opens a virtual profile built
  //     from the owner's record (select({ virtualSpouseOf })). No database row is
  //     invented, and the owner is correctly shown as the spouse's partner.
  function select(id, opts = {}) {
    S.selected = id; S.virtualSpouseOf = opts.virtualSpouseOf || null; S.selectedFromSpouseCard = opts.card === 'spouse' ? ownerIdLookup() : false; hideTip();
    document.querySelectorAll('.node.selected').forEach(n => n.classList.remove('selected'));
    // Highlight the card that was ACTUALLY clicked, not any other card that
    // references the same person: a linked spouse card carries data-id = OWNER
    // plus data-spouse-pid, and a text-only spouse card carries data-id = OWNER
    // without a spouse-pid. card === 'spouse' marks the clicked spouse card;
    // everything else (plain card, table row, relationship link) marks the
    // plain card whose data-id is the person.
    const sel = opts.card === 'spouse'
      ? (opts.virtualSpouseOf
        ? `.node.spouse[data-id="${CSS.escape(opts.virtualSpouseOf)}"]:not([data-spouse-pid])`
        : `.node[data-spouse-pid="${CSS.escape(id)}"]`)
      : `.node[data-id="${CSS.escape(id)}"]:not(.spouse)`;
    const highlighted = $(sel);
    if (highlighted) highlighted.classList.add('selected');
    renderPanel();
    if (opts.focus) focusPerson(opts.virtualSpouseOf || id, opts);
    if (S.view === 'table') document.querySelectorAll('#table tbody tr').forEach(r => r.classList.toggle('sel', r.dataset.id === id));
  }
  // For a linked spouse card the OWNER is the person whose spousePid == the spouse id;
  // markup rebuilds use it to keep the selected class on the same card the user tapped.
  function ownerIdLookup() {
    if (S.virtualSpouseOf) return S.virtualSpouseOf;
    return (S.people.find(p => p.spousePid === S.selected) || {}).id || null;
  }

  function closePanel() {
    S.selected = null; S.virtualSpouseOf = null; S.selectedFromSpouseCard = false; $('#panel').hidden = true;
    document.querySelectorAll('.node.selected, tr.sel').forEach(n => n.classList.remove('selected', 'sel'));
  }

  function row(k, v) { return v != null && v !== '' ? `<div class="p-row"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>` : ''; }
  // Birth/death rows also carry their Umm al-Qura Hijri equivalent (js/hijri.js)
  // under the Gregorian value. Only confident conversions are shown: a real
  // calendar date converts; an approximate text date ("1965 (approx)") or a
  // date outside the official Umm al-Qura table silently gets no second line.
  function rowHijri(k, v, iso) {
    if (v == null || v === '') return '';
    let h = null;
    if (window.Hijri && iso) { try { h = window.Hijri.format(iso); } catch (e) { h = null; } }
    return `<div class="p-row"><div class="k">${k}</div><div class="v">${esc(v)}${h ? `<div class="v-hijri">${esc(I18n.t('hijri.label'))}: ${esc(h)}</div>` : ''}</div></div>`;
  }
  function sec(title, rows) { const r = rows.join(''); return r ? `<div class="p-sec"><h5>${title}</h5>${r}</div>` : ''; }
  function relBtns(list) { return list.map(p => `<button data-goto="${esc(p.id)}">${esc(p.nick ? p.nick + ' – ' : '')}${esc(dispName(p))}</button>`).join(''); }

  // Column -> translation key. The panel, the edit dialog, the table and the change
  // history all label their rows from here, so a column is named in exactly one place.
  const FIELD_LABELS = {
    full_name: 'edit.fullName', nick_name: 'edit.nickname', name_ur: 'edit.nameUr',
    name_hi: 'edit.nameHi', gender: 'edit.gender', fathers_name: 'edit.father',
    mothers_name: 'edit.mother', spouse_name: 'edit.spouse',
    spouse_father_name: 'edit.spouseFather', dob: 'edit.dob', dob_text: 'edit.dobText',
    place_of_birth: 'edit.pob', qualification: 'edit.qual', dod: 'edit.dod',
    dod_text: 'edit.dodText', place_of_burial: 'edit.burial', notes: 'edit.notes',
    photo_path: 'table.col.photo', is_deleted: 'table.col.deleted',
    parent_id: 'edit.parentField', legacy_id: 'table.col.legacyId', source: 'table.col.source'
  };

  // The form's own field list (with sections, validation and the gender choices) lives in
  // js/personform.js; FIELD_LABELS above is what the panel, the table and the history share.
  // A married-in person who has no own record: build their profile from the owner's
  // row. Every value shown was already in the database (spouse_name,
  // spouse_father_name, the owner's children); nothing is invented, nothing is saved.
  // Not editable by design — there is no record to edit.
  function renderVirtualSpousePanel(pn, owner) {
    S.editing = false;
    if (!owner) { pn.hidden = true; return; }
    const kids = S.kids.get(owner.id) || [];
    const g = /^m/i.test(owner.gender || '') ? 'female' : /^f/i.test(owner.gender || '') ? 'male' : 'unknown';
    const canEdit = !!(Auth && Auth.canEditPerson(owner.id) && Auth.canEditPerson);
    const body = [
      row(I18n.t('edit.spouse'), owner.name),                       // married to
      row(I18n.t('edit.spouseFather'), owner.spouseFather),
      row(I18n.t('panel.children'), kids.length ? kids.map(k => dispName(k)).join(', ') : null)
    ].join('');
    let actions = '';
    if (canEdit) {
      actions = '<div class="p-actions">';
      // Give the spouse a real record: pre-fills the owner as Spouse on the INSERT.
      actions += '<button type="button" class="btn" id="btnVirtCreatePerson" data-i18n>panel.virtCreatePerson</button>';
      if (kids.length) actions += '<button type="button" class="btn" id="btnVirtAddChild" data-i18n>panel.addChild</button>';
      actions += '</div>';
    }
    pn.innerHTML =
      '<div class="p-head">' +
      '<button class="icon-btn p-close" id="pClose" aria-label="' + esc(I18n.t('panel.close')) + '">✕</button>' +
      '<div class="avatar p-avatar" style="background:var(--' + g + '-soft);color:var(--' + g + ')">' + esc(initials(owner.spouse || '')) + '</div>' +
      '<h3>' + esc(owner.spouse) + '</h3>' +
      '<div class="p-nick">' + esc(I18n.fmt('panel.spouseOf', { name: owner.nick || dispName(owner) })) + '</div>' +
      '<div class="p-tags"><span class="tag ' + g + '">' + esc(genderLabel(g === 'female' ? 'Female' : g === 'male' ? 'Male' : null)) + '</span>' +
      '<span class="tag gray">' + esc(I18n.t('panel.virtTag')) + '</span></div>' +
      '</div>' +
      '<div class="p-sec"><h5>' + esc(I18n.t('panel.family')) + '</h5>' + body + '</div>' +
      (kids.length ? '<div class="p-sec"><h5>' + esc(I18n.fmt('panel.children', { n: kids.length })) + '</h5><div class="rel">' + relBtns(kids) + '</div></div>' : '') +
      (owner.photo_path ? '' : '') +
      actions +
      '<div class="p-none">' + esc(I18n.t('panel.virtNote')) + '</div>' +
      '<div style="height:16px"></div>';
    pn.className = 'panel ' + g;
    pn.hidden = false;
    pn.scrollTop = 0;
    $('#pClose', pn).onclick = () => closePanel();
    pn.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => select(b.dataset.goto, { focus: true }));
    const bCreate = $('#btnVirtCreatePerson', pn);
    if (bCreate) bCreate.onclick = () => startAddSpousePerson(owner);
    const bChild = $('#btnVirtAddChild', pn);
    if (bChild) bChild.onclick = () => startAddChild(owner);
    I18n.apply();                     // the panel is built in JS — apply the translations
  }

  function renderPanel() {
    const pn = $('#panel');
    // Virtual spouse: the profile of a married-in person who has no own record.
    // Derived from the OWNER's row so every fact is one the database already has;
    // nothing here is editable (no record exists to edit) and nothing is invented.
    if (S.virtualSpouseOf && S.selected) return renderVirtualSpousePanel(pn, S.byId.get(S.virtualSpouseOf), S.selected);
    const p = S.selected && S.byId.get(S.selected);
    if (!p) { pn.hidden = true; S.editing = false; return; }
    S.editing = false;

    const kids = S.kids.get(p.id) || [];
    const sibs = p.parent ? (S.kids.get(p.parent.id) || []).filter(x => x.id !== p.id) : [];
    const age = ageText(p);
    const personal = [
      rowHijri(I18n.t('edit.dob'), p.dob_display || p.dob, p.dob_iso || p.dob),
      row(I18n.t('panel.age'), age),
      row(I18n.t('edit.pob'), p.pob),
      row(I18n.t('edit.qual'), p.qual)
    ];
    const family = [
      row(I18n.t('edit.father'), p.father),
      row(I18n.t('edit.mother'), p.mother),
      row(I18n.t('edit.spouse'), p.spouse),
      row(I18n.t('edit.spouseFather'), p.spouseFather)
    ];
    const passing = [
      rowHijri(I18n.t('edit.dod'), p.dod_display || p.dod, p.dod_iso || p.dod),
      row(I18n.t('edit.burial'), p.burial)
    ];
    const record = [
      row(I18n.t('table.col.id'), p.id),
      row(I18n.t('table.col.legacyId'), p.legacy_id),
      row(I18n.t('edit.parentField'), p.parentId),
      row(I18n.t('table.col.source'), p.source)
    ];
    // "Last edited" is written by hand rather than via row() so the admin-only audit
    // lookup below can swap the text in through textContent (which escapes it for us).
    if (p.updated_at) {
      record.push('<div class="p-row"><div class="k">' + esc(I18n.t('panel.lastEdited')) + '</div>' +
        '<div class="v" data-last-edited>' + esc(fmtWhen(p.updated_at) || '') + '</div></div>');
    }
    const body = sec(I18n.t('panel.personal'), personal) + sec(I18n.t('panel.family'), family) + sec(I18n.t('panel.passing'), passing);

    let rel = '';
    // The spouse link: when this person's spouse has their own record, the
    // panel offers a direct jump to it (both directions of the marriage).
    const spouseRec = p.spousePid ? S.byId.get(p.spousePid) : null;
    if (spouseRec) rel += '<div class="rel-label">' + esc(I18n.t('edit.spouse')) + '</div><div class="rel">' + relBtns([spouseRec]) + '</div>';
    if (p.parent) rel += '<div class="rel-label">' + esc(I18n.t('panel.parent')) + '</div><div class="rel">' + relBtns([p.parent]) + '</div>';
    if (sibs.length) rel += '<div class="rel-label">' + esc(I18n.fmt('panel.siblings', { n: sibs.length })) + '</div><div class="rel">' + relBtns(sibs) + '</div>';
    if (kids.length) rel += '<div class="rel-label">' + esc(I18n.fmt('panel.children', { n: kids.length })) + '</div><div class="rel">' + relBtns(kids) + '</div>';

    // Action bar: Edit + Add child (when the user may edit this person), the admin-only
    // "add a new branch", soft delete / restore, and the change history.
    const canEdit = !!(Auth && Auth.canEditPerson(p.id));
    const isAdmin = !!(Auth && Auth.isAdmin());
    const isEditor = !!(Auth && Auth.isActiveEditor());
    const canRequestDeletion = isEditor && canEdit && !p.is_deleted;
    const showHistory = !!(Auth && Auth.client) && (canEdit || isAdmin);
    const actionBar = (canEdit || isAdmin) ? `
      <div class="p-actions">
        ${canEdit ? `<button class="btn" id="btnAddChild" data-i18n>panel.addChild</button>` : ''}
        ${canEdit ? `<button class="btn" id="btnEdit" data-i18n>panel.edit</button>` : ''}
        ${isAdmin ? `<button class="btn ghost" id="btnAddRoot" data-i18n>panel.addRoot</button>` : ''}
        ${canRequestDeletion ? `<button class="btn" id="btnRequestDeletion" data-i18n>panel.requestDeletion</button>` : ''}
        ${isAdmin ? (p.is_deleted
          ? `<button class="btn" id="btnRestore" data-i18n>panel.restore</button>`
          : `<button class="btn danger" id="btnSoftDelete" data-i18n>panel.softDelete</button>`) : ''}
        ${showHistory ? `<button class="btn ghost" id="btnAudit" data-i18n>panel.showHistory</button>` : ''}
      </div>` : '';

    // Photo (Supabase Storage). The bucket is private, so the image is shown through a
    // short-lived signed URL. Everyone signed in can see it; only people who may edit
    // this person get upload/replace/remove — and the database enforces that too.
    const canManagePhoto = !!(Auth && Auth.client && canEdit);
    const showPhotoSec = !!(Auth && Auth.client);
    const photoSec = showPhotoSec ? `
      <div class="p-sec" id="photoSec">
        <h5 data-i18n>panel.photo</h5>
        <div class="photo-wrap">
          ${p.photo_path
            ? `<button type="button" class="photo-frame has-photo" id="btnPhotoZoom" data-i18n="photos.viewLarger" data-i18n-attr="aria-label">
                 <span class="photo-empty" data-i18n>photos.loading</span>
                 <img class="photo-img" data-photo-img alt="${esc(I18n.fmt('photos.alt', { name: dispName(p) }))}" hidden>
               </button>`
            : `<div class="photo-frame"><span class="photo-empty" data-i18n>photos.none</span></div>`}
          ${canManagePhoto ? `<div class="photo-actions">
            <button type="button" class="btn sm" id="btnPhotoPick" data-i18n="${p.photo_path ? 'photos.replace' : 'photos.upload'}">${p.photo_path ? 'Replace photo' : 'Upload photo'}</button>
            ${p.photo_path ? `<button type="button" class="btn sm danger" id="btnPhotoRemove" data-i18n>photos.remove</button>` : ''}
            <input type="file" id="photoInput" accept="image/jpeg,image/png,image/webp" hidden>
          </div>` : ''}
        </div>
      </div>` : '';

    pn.innerHTML = `
      <div class="p-head">
        <button class="icon-btn p-close" id="pClose" aria-label="${esc(I18n.t('panel.close'))}">✕</button>
        <div class="avatar p-avatar" data-photo-avatar>${esc(p._initials)}<img class="p-avatar-img" data-photo-avatar-img alt="" hidden></div>
        <h3>${esc(dispName(p))}</h3>
        ${p.nick ? `<div class="p-nick">${esc(I18n.fmt('panel.nick', { nick: p.nick }))}</div>` : ''}
        <div class="p-tags"><span class="tag ${gcls(p)}">${esc(genderLabel(p.gender))}</span><span class="tag">${esc(I18n.fmt('panel.generation', { n: p.gen }))}</span>
          ${p.dod ? '<span class="tag gray">' + esc(I18n.t('panel.deceased')) + '</span>' : ''}${kids.length ? `<span class="tag gray">${esc(I18n.fmt('panel.children', { n: kids.length }))}</span>` : ''}
          ${p.is_deleted ? '<span class="tag gray">' + esc(I18n.t('panel.deleted')) + '</span>' : ''}${p.legacy_id ? `<span class="tag gray">${esc(I18n.fmt('panel.legacy', { id: p.legacy_id }))}</span>` : ''}</div>
      </div>
      ${photoSec}
      ${body.trim() ? body : '<div class="p-none">' + esc(I18n.t('panel.noDetails')) + '</div>'}
      ${rel ? `<div class="p-sec"><h5>${esc(I18n.t('panel.relatives'))}</h5>${rel}</div>` : ''}
      ${sec(I18n.t('panel.record'), record)}
      ${actionBar}
      ${showHistory ? `<div class="p-sec" id="auditBox"></div>` : ''}
      ${p.name_ur ? `<div class="p-sec"><h5>${esc(I18n.t('panel.nameUr'))}</h5><div class="p-row"><div class="v" style="grid-column:1/-1;font-size:15px" dir="rtl">${esc(p.name_ur)}</div></div></div>` : ''}
      ${p.name_hi ? `<div class="p-sec"><h5>${esc(I18n.t('panel.nameHi'))}</h5><div class="p-row"><div class="v" style="grid-column:1/-1;font-size:15px">${esc(p.name_hi)}</div></div></div>` : ''}
      <div style="height:16px"></div>`;
    pn.className = 'panel ' + gcls(p);
    pn.hidden = false;
    pn.scrollTop = 0;
    $('#pClose').onclick = () => { S.editing = false; closePanel(); };
    // colour the avatar in the panel header
    const av = $('.p-avatar', pn); const g = gcls(p);
    av.style.background = `var(--${g}-soft)`; av.style.color = `var(--${g})`;
    pn.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => select(b.dataset.goto, { focus: true }));
    if (canEdit) $('#btnAddChild', pn).onclick = () => startAddChild(p);
    if (canEdit) $('#btnEdit', pn).onclick = () => startEditing(p);
    if (isAdmin) $('#btnAddRoot', pn).onclick = () => startAddRoot();
    if (canRequestDeletion) $('#btnRequestDeletion', pn).onclick = () => startDeletionRequest(p);
    if (isAdmin) {
      // Soft-delete and restore are mutually exclusive: only one of the two is rendered.
      const bDel = $('#btnSoftDelete', pn);
      const bRes = $('#btnRestore', pn);
      if (bDel) bDel.onclick = () => toggleSoftDelete(p);
      if (bRes) bRes.onclick = () => toggleSoftDelete(p);
    }
    if (showHistory) $('#btnAudit', pn).onclick = () => toggleHistory(p);
    bindPhotoActions(pn, p);
    hydratePhoto(pn, p);
    hydrateLastEdited(pn, p);
    I18n.apply();
  }
  // "Last edited" already shows updated_at. Admins get the extra detail of WHO made the
  // change, read from audit_log (RLS allows admins to read it). Failing to read it is
  // not worth an error message — the timestamp is already on screen.
  async function hydrateLastEdited(pn, p) {
    if (!p.updated_at) return;
    if (!(Auth && Auth.client && Auth.isAdmin())) return;
    const slot = pn.querySelector('[data-last-edited]');
    if (!slot) return;
    try {
      const { data, error } = await Auth.client
        .from('audit_log')
        .select('changed_by_name, changed_at')
        .eq('person_id', p.id)
        .order('changed_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const hit = data && data[0];
      if (!hit || S.selected !== p.id) return;
      // The panel may have been replaced while this was in flight.
      const live = $('#panel').querySelector('[data-last-edited]');
      if (!live) return;
      const when = fmtWhen(hit.changed_at) || fmtWhen(p.updated_at) || '';
      live.textContent = hit.changed_by_name
        ? I18n.fmt('panel.lastEditedBy', { name: hit.changed_by_name, date: when })
        : I18n.fmt('panel.lastEditedOn', { date: when });
    } catch (e) {
      console.warn('Could not read the audit log for last-edited:', e);
    }
  }

  /* --------------------- Photos (Supabase Storage) --------------------- */
  // Wire the upload / replace / remove / zoom controls for the selected person.
  function bindPhotoActions(pn, p) {
    const input = $('#photoInput', pn);
    const pick = $('#btnPhotoPick', pn);
    if (pick && input) {
      pick.onclick = () => input.click();
      input.onchange = () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (file) uploadPhoto(p, file);
      };
    }
    const rm = $('#btnPhotoRemove', pn);
    if (rm) rm.onclick = () => removePhoto(p);
    const zoom = $('#btnPhotoZoom', pn);
    if (zoom) zoom.onclick = () => {
      const img = zoom.querySelector('img[data-photo-img]');
      if (img && img.src) openLightbox(p, img.src);
    };
  }

  // Resolve the signed URL and swap it into the header avatar and the photo preview.
  async function hydratePhoto(pn, p) {
    if (!p || !p.photo_path || !Auth || !Auth.client || !window.Photos) return;
    const wantId = p.id;
    let url;
    try {
      url = await Photos.signedUrl(p.photo_path);
    } catch (err) {
      console.warn('Could not sign the photo URL:', err);
      showPhotoError(pn);
      return;
    }
    // The panel may have moved on to another person while we waited.
    if (!url || S.selected !== wantId) return;
    showImage(pn.querySelector('img[data-photo-img]'), url);
    showImage(pn.querySelector('img[data-photo-avatar-img]'), url);
  }

  function showImage(img, url) {
    if (!img) return;
    const frame = img.closest('.photo-frame');
    const hint = frame ? frame.querySelector('.photo-empty') : null;
    img.addEventListener('load', () => {
      img.hidden = false;
      if (hint) hint.hidden = true;
    }, { once: true });
    img.addEventListener('error', () => {
      img.hidden = true;
      if (hint) { hint.hidden = false; hint.removeAttribute('data-i18n'); hint.textContent = I18n.t('photos.errLoad'); }
    }, { once: true });
    img.src = url;
  }

  function showPhotoError(scope) {
    const hint = scope && scope.querySelector ? scope.querySelector('.photo-empty') : null;
    if (hint) { hint.hidden = false; hint.removeAttribute('data-i18n'); hint.textContent = I18n.t('photos.errLoad'); }
  }

  async function uploadPhoto(p, file) {
    if (!Auth || !Auth.client || !window.Photos) { toast(I18n.t('photos.notConnected')); return; }
    const v = Photos.validate(file);
    if (!v.ok) {
      toast(v.error === 'photos.errSize' ? I18n.fmt('photos.errSize', { max: v.max }) : I18n.t(v.error));
      return;
    }
    const btn = $('#btnPhotoPick', $('#panel'));
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = I18n.t('photos.uploading'); }
    try {
      const key = await Photos.upload(p.id, file, p.photo_path || null);
      p.photo_path = key;
      renderPanel();
      toast(I18n.t('photos.uploaded'));
    } catch (err) {
      toast(photoError(err));
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  async function removePhoto(p) {
    if (!Auth || !Auth.client || !window.Photos) { toast(I18n.t('photos.notConnected')); return; }
    if (!window.confirm(I18n.t('photos.removeConfirm'))) return;
    const btn = $('#btnPhotoRemove', $('#panel'));
    if (btn) { btn.disabled = true; btn.textContent = I18n.t('photos.removing'); }
    try {
      await Photos.remove(p.id, p.photo_path);
      p.photo_path = null;
      renderPanel();
      toast(I18n.t('photos.removed'));
    } catch (err) {
      toast(photoError(err));
      renderPanel();
    }
  }

  // Map a storage/RLS failure to a friendly, translated message.
  function photoError(err) {
    if (err && err.code && String(err.code).indexOf('photos.') === 0) {
      return err.code === 'photos.errSize' ? I18n.fmt('photos.errSize', { max: err.max }) : I18n.t(err.code);
    }
    const msg = (err && (err.message || err.error_description)) || String(err);
    if (/row-level security|permission|not allowed|forbids|violates|unauthoriz|403/i.test(msg)) return I18n.t('photos.errPerm');
    if (/invalid api key|jwt|invalid_token|expired/i.test(msg)) return I18n.t('photos.errAuth');
    return I18n.fmt('photos.errFailed', { msg: msg });
  }

  // ---------- Photo lightbox ----------
  let lightboxEl = null;
  function lightboxKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLightbox(); }
  }
  function openLightbox(p, src) {
    if (!src) return;
    closeLightbox();
    const alt = I18n.fmt('photos.alt', { name: p.name });
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', alt);
    box.innerHTML = `<button class="icon-btn lightbox-close" aria-label="${esc(I18n.t('panel.close'))}">✕</button><img alt="${esc(alt)}">`;
    box.querySelector('img').src = src;
    box.addEventListener('click', e => {
      if (e.target === box || e.target.closest('.lightbox-close')) closeLightbox();
    });
    document.body.appendChild(box);
    lightboxEl = box;
    // Capture phase, so Escape closes the lightbox instead of the detail panel behind it.
    window.addEventListener('keydown', lightboxKey, true);
  }
  function closeLightbox() {
    window.removeEventListener('keydown', lightboxKey, true);
    if (lightboxEl) { lightboxEl.remove(); lightboxEl = null; }
  }

  // ---------- Add / edit (one shared dialog — js/personform.js) ----------
  function startEditing(p) {
    if (!window.PersonForm) { toast(I18n.t('save.notConnected')); return; }
    PersonForm.open({ mode: 'edit', person: p });
  }
  // "Give the spouse a real record": open the person form pre-filled so the INSERT
  // carries the owner as spouse_name. One dialog, one new row, the link is right.
  function startAddSpousePerson(owner) {
    if (!window.PersonForm) { toast(I18n.t('save.notConnected')); return; }
    PersonForm.open({ mode: 'addspouse', person: owner });
  }
  function startAddChild(p) {
    if (!window.PersonForm) { toast(I18n.t('save.notConnected')); return; }
    PersonForm.open({ mode: 'addchild', parent: p });
  }
  // Admin only: a person with no parent, i.e. a brand new branch.
  function startAddRoot() {
    if (!(Auth && Auth.isAdmin())) return;
    if (!window.PersonForm) { toast(I18n.t('save.notConnected')); return; }
    PersonForm.open({ mode: 'addroot' });
  }

  // ---------- Deletion request (editor) ----------
  // Editors cannot delete anything; they ask an admin. The request lands in
  // deletion_requests and the admin resolves it from the Admin screen.
  function startDeletionRequest(p) {
    if (!(Auth && Auth.client)) { toast(I18n.t('save.notConnected')); return; }
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><div>' +
      '<h3>' + esc(I18n.fmt('panel.requestDeletionTitle', { name: dispName(p) })) + '</h3>' +
      '<p class="modal-sub">' + esc(I18n.t('panel.requestDeletionSub')) + '</p></div>' +
      '<button type="button" class="icon-btn" data-close aria-label="' + esc(I18n.t('panel.close')) + '">✕</button></div>' +
      '<form class="edit-form modal-body" id="drForm">' +
      '<div class="edit-field"><label class="edit-label" for="drReason">' + esc(I18n.t('panel.deletionReason')) +
      ' <span class="edit-req">*</span></label>' +
      '<textarea class="edit-input" id="drReason" rows="4" placeholder="' + esc(I18n.t('panel.deletionReasonPlaceholder')) + '"></textarea>' +
      '<div class="edit-error" data-err hidden></div></div>' +
      '<p class="admin-hint">' + esc(I18n.t('panel.requestDeletionNote')) + '</p>' +
      '</form>' +
      '<div class="modal-foot">' +
      '<button type="button" class="btn" data-close>' + esc(I18n.t('panel.cancel')) + '</button>' +
      '<button type="submit" form="drForm" class="btn primary" data-ok>' + esc(I18n.t('panel.submitRequest')) + '</button>' +
      '</div></div>';
    document.body.appendChild(box);
    document.documentElement.classList.add('modal-open');
    const shut = () => { box.remove(); document.documentElement.classList.remove('modal-open'); };
    box.querySelectorAll('[data-close]').forEach(b => b.onclick = shut);
    box.addEventListener('mousedown', e => { if (e.target === box) shut(); });
    box.querySelector('#drForm').onsubmit = async e => {
      e.preventDefault();
      const reason = box.querySelector('#drReason').value.trim();
      const errBox = box.querySelector('[data-err]');
      const ta = box.querySelector('#drReason');
      if (!reason) {
        errBox.hidden = false;
        errBox.textContent = I18n.t('edit.fullNameRequired');
        ta.setAttribute('aria-invalid', 'true');
        ta.focus();
        return;
      }
      const ok = box.querySelector('[data-ok]');
      ok.disabled = true;
      try {
        const { error } = await Auth.client.from('deletion_requests').insert({ person_id: p.id, reason: reason });
        if (error) throw error;
        shut();
        toast(I18n.t('save.requestSubmitted'));
        renderPanel();
      } catch (err) {
        const msg = (err && err.message) || String(err);
        toast(/permission|forbids|not allowed|policy/i.test(msg)
          ? I18n.t('save.permError')
          : I18n.fmt('save.deleteRequestFailed', { msg: msg }));
        ok.disabled = false;
      }
    };
    setTimeout(() => box.querySelector('#drReason').focus(), 0);
  }

  // ---------- Soft delete / restore (admin only) ----------
  // The database keeps the person (is_deleted = true) and the audit log records it,
  // so this is always reversible from the Admin screen.
  function descendantsOf(id) {
    const out = [];
    const self = S.byId.get(id);
    if (!self) return out;
    const walk = x => (S.kids.get(x.id) || []).forEach(c => { out.push(c); walk(c); });
    walk(self);
    return out;
  }

  async function adminSoftDelete(p) {
    if (!(Auth && Auth.client)) { toast(I18n.t('save.notConnected')); return; }
    const below = descendantsOf(p.id);
    const notDeleted = below.filter(d => !d.is_deleted);
    const living = notDeleted.filter(d => !d.dod);
    if (living.length) {
      // Refuse: a living descendant would be orphaned by this. The rule is the same
      // one the family data needs — deal with the children first.
      window.alert(I18n.fmt('panel.deleteBlockedTitle', { name: dispName(p) }) + '\n\n' +
        I18n.fmt('panel.deleteBlocked', { n: notDeleted.length, alive: living.length }));
      return;
    }
    const msg = I18n.fmt('panel.deleteTitle', { name: dispName(p) }) + '\n\n' +
      I18n.t('panel.deleteConfirm') + '\n' +
      I18n.fmt('panel.deleteDescendants', { n: below.length });
    if (!window.confirm(msg)) return;
    const btn = $('#btnSoftDelete', $('#panel'));
    if (btn) btn.disabled = true;
    try {
      const { error } = await Auth.client.from('people').update({ is_deleted: true }).eq('id', p.id);
      if (error) throw error;
      p.is_deleted = true;
      closePanel();
      toast(I18n.fmt('panel.deleteDone', { name: dispName(p) }));
      if (S._allRows.length) init(S._allRows.filter(x => x.id !== p.id || S.showDeleted));
    } catch (err) {
      const m = (err && err.message) || String(err);
      toast(I18n.fmt('panel.deleteFailed', { msg: /Only an admin/.test(m) ? I18n.t('save.deleteRestoreError') : m }));
      renderPanel();
    }
  }

  async function restorePerson(p) {
    if (!(Auth && Auth.client)) { toast(I18n.t('save.notConnected')); return; }
    const btn = $('#btnRestore', $('#panel'));
    if (btn) btn.disabled = true;
    try {
      const { error } = await Auth.client.from('people').update({ is_deleted: false }).eq('id', p.id);
      if (error) throw error;
      p.is_deleted = false;
      toast(I18n.t('save.restored'));
      renderPanel();
    } catch (err) {
      toast(I18n.fmt('panel.deleteFailed', { msg: (err && err.message) || String(err) }));
      renderPanel();
    }
  }

  function toggleSoftDelete(p) { return p.is_deleted ? restorePerson(p) : adminSoftDelete(p); }

  // ---------- Change history (audit_log) ----------
  // Who changed what, when, with the old value next to the new one. Any update row can
  // be put back ("Restore this version") through a normal UPDATE, so it is recorded in
  // the history like any other change.
  let historyOpenFor = null;

  function toggleHistory(p) {
    const box = $('#auditBox', $('#panel'));
    if (!box) return;
    if (historyOpenFor === p.id) {
      historyOpenFor = null;
      box.innerHTML = '';
      const b = $('#btnAudit', $('#panel'));
      if (b) b.textContent = I18n.t('panel.showHistory');
      return;
    }
    historyOpenFor = p.id;
    const b = $('#btnAudit', $('#panel'));
    if (b) b.textContent = I18n.t('panel.hideHistory');
    loadHistory(p, box);
  }

  async function loadHistory(p, box) {
    box.innerHTML = '<div class="p-none">' + esc(I18n.t('panel.historyLoading')) + '</div>';
    try {
      const { data, error } = await Auth.client
        .from('audit_log')
        .select('id, action, changed_by, changed_by_name, old_data, new_data, changed_at')
        .eq('person_id', p.id)
        .order('changed_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      if (historyOpenFor !== p.id) return;
      const rows = data || [];
      S.auditRows = rows;   // "Restore this version" needs the old_data snapshot
      box.innerHTML = '<h5 class="hist-title">' + esc(I18n.t('panel.history')) + '</h5>' +
        (rows.length ? rows.map(r => historyRowHtml(r, p)).join('')
          : '<div class="p-none">' + esc(I18n.t('panel.historyNone')) + '</div>');
      box.querySelectorAll('[data-restore-version]').forEach(btn => {
        btn.onclick = () => restoreVersion(p, btn.dataset.restoreVersion, btn);
      });
    } catch (err) {
      box.innerHTML = '<div class="p-none">' +
        esc(I18n.fmt('panel.historyFailed', { msg: (err && err.message) || String(err) })) + '</div>';
    }
  }

  function historyRowHtml(r, p) {
    const action = I18n.t('panel.action.' + r.action);
    const when = fmtWhen(r.changed_at) || '—';
    const who = r.changed_by_name || (r.changed_by ? '#' + String(r.changed_by).slice(0, 8) : '—');
    const diffs = fieldDiffs(r.old_data, r.new_data);
    const canRestore = r.action === 'update' && r.old_data && (Auth && Auth.canEditPerson(p.id));
    return '<div class="audit-row">' +
      '<div class="audit-meta"><span class="audit-action ' + esc(r.action) + '">' + esc(action) + '</span> · ' +
      esc(who) + ' · ' + esc(when) + '</div>' +
      (diffs.length
        ? '<details class="audit-details"><summary>' +
        esc(I18n.fmt('panel.changedFields', { n: diffs.length })) + '</summary>' +
        diffs.map(d => '<div class="change-row"><b>' + esc(d.label) + '</b> ' +
          '<span class="change-old">' + esc(d.before === '' ? '—' : d.before) + '</span> → ' +
          '<span class="change-new">' + esc(d.after === '' ? '—' : d.after) + '</span></div>').join('') +
        '</details>' : '') +
      (canRestore
        ? '<button type="button" class="btn sm" data-restore-version="' + esc(String(r.id)) + '">' +
        esc(I18n.t('panel.restoreVersion')) + '</button>' : '') +
      '</div>';
  }

  // Which whitelisted columns differ between two audit snapshots.
  function fieldDiffs(oldData, newData) {
    const oldD = oldData || {}, newD = newData || {};
    const out = [];
    Object.keys(FIELD_LABELS).forEach(col => {
      if (!(col in oldD) && !(col in newD)) return;
      const before = oldD[col] == null ? '' : String(oldD[col]);
      const after = newD[col] == null ? '' : String(newD[col]);
      if (before === after) return;
      out.push({ col: col, label: fieldLabel(col), before: before, after: after });
    });
    return out;
  }

  // Put the values from one audit row back. Only columns the form owns are written,
  // and moving a person stays admin-only, exactly like a normal edit.
  async function restoreVersion(p, auditId, btn) {
    const rows = S.auditRows || [];
    const row = rows.find(r => String(r.id) === String(auditId));
    if (!row || !row.old_data) return;
    const old = row.old_data;
    if (!window.confirm(I18n.fmt('panel.restoreConfirm', { when: fmtWhen(row.changed_at) || '' }))) return;
    const payload = {};
    Object.keys(FIELD_LABELS).forEach(col => {
      if (!(col in old)) return;
      if (col === 'is_deleted' || col === 'photo_path' || col === 'legacy_id' || col === 'source' || col === 'parent_id') return;
      let v = old[col];
      if (col === 'dob' || col === 'dod') v = v ? String(v).slice(0, 10) : null;
      payload[col] = v == null ? null : String(v);
    });
    if (Auth && Auth.isAdmin() && Object.prototype.hasOwnProperty.call(old, 'parent_id')) {
      payload.parent_id = old.parent_id || null;
    }
    if (btn) btn.disabled = true;
    try {
      const { error } = await Auth.client.from('people').update(payload).eq('id', p.id);
      if (error) throw error;
      toast(I18n.t('panel.restoreDone'));
      if (window.FT && FT.refreshAndSelect) await FT.refreshAndSelect(p.id);
    } catch (err) {
      toast(I18n.fmt('panel.restoreFailed', { msg: (err && err.message) || String(err) }));
      if (btn) btn.disabled = false;
    }
  }
  // The whole admin area now lives in js/admin.js — a full-screen dialog with tabs for
  // users, deletion requests, recently deleted people, the activity feed, and the
  // Excel import / JSON backup. app.js keeps only these three entry points.
  function openAdminPanel() {
    if (!(Auth && Auth.isAdmin())) return;
    closePanel();
    if (window.Admin) { window.Admin.open(); return; }
    toast(I18n.t('admin.notDeployed'));
  }
  function closeAdminPanel() {
    if (window.Admin && Admin.isOpen()) Admin.close();
  }
  function adminPanelOpen() { return !!(window.Admin && Admin.isOpen()); }

  function focusPerson(id, opts = {}) {
    // make sure the person is visible: expand ancestors, drop filters that hide them
    for (let c = S.byId.get(id).parent; c; c = c.parent) S.collapsed.delete(c.id);
    if (visible && !visible.has(id)) { resetFilters();      toast(I18n.t('generic.filtersCleared')); }
    if (S.view === 'tree') {
      computeVisibility(); renderTree(false);
      // Position: a LINKED spouse has no own slot in the layout map — their card
      // is drawn inside the OWNER's card space — so point the view there when the
      // id belongs to a spouse card. Everything else uses the person's own slot.
      const whoOwnsMe = S.people.find(p => p.spousePid === id);
      let v = S.pos.get(id);
      if (!v && whoOwnsMe) {
        const o = S.pos.get(whoOwnsMe.id);
        if (o) v = { x: o.x + NW + SG, y: o.y, w: NW };   // the spouse card slot
      }
      if (!v) return;
      const st = $('#treeView');
      S.scale = Math.max(S.scale, .9);
      S.tx = st.clientWidth / 2 - (PAD + v.x + v.w / 2) * S.scale;
      S.ty = st.clientHeight / 2 - (PAD + v.y + NH / 2) * S.scale;
      const w = $('#world'); w.style.transition = 'transform .45s ease'; applyTransform();
      setTimeout(() => w.style.transition = '', 480);
      // Card-aware pulse, matching select(): the pulse must hit the card the
      // person was opened from, not any other card referencing the same person.
      const sel = opts.card === 'spouse'
        ? (opts.virtualSpouseOf
          ? `.node.spouse[data-id="${CSS.escape(opts.virtualSpouseOf)}"]:not([data-spouse-pid])`
          : `.node[data-spouse-pid="${CSS.escape(id)}"]`)
        : `.node[data-id="${CSS.escape(id)}"]:not(.spouse)`;
      const n = $(sel); if (n) { n.classList.add('selected', 'pulse'); }
    }
  }

  /* -------------------------------- Table -------------------------------- */
  function renderTable() {
    const t = $('#table');
    const key = S.sort.key, dir = S.sort.dir;
    const rows = S.people.slice().sort((a, b) => {
      const av = a[key] == null ? '' : a[key], bv = b[key] == null ? '' : b[key];
      if (key === 'gen') return (av - bv) * dir || String(a.id).localeCompare(String(b.id));
      if (key === 'dob' || key === 'dod') { const x = parseDate(av), y = parseDate(bv); return ((x ? +x : 1e15) - (y ? +y : 1e15)) * dir; }
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
    const active = filterActive();
    const list = active ? rows.filter(p => matchSet.has(p.id)) : rows;
    // Cells that need a translated or language-dependent value.
    const cell = (p, k) => {
      if (k === 'name') return dispName(p);
      if (k === 'gender') return p.gender ? genderLabel(p.gender) : '';
      if (k === 'is_deleted') return p.is_deleted ? I18n.t('panel.deleted') : '';
      return p[k];
    };
    // No-results row: distinguish 'nothing matches the filters' from an empty or
    // failed load (that one shows the load-error banner instead) and offer a one-tap
    // way back to the full, permission-visible result set.
    const noResults = active && !list.length
      ? `<tr class="no-results"><td colspan="${TABLE_COLS.length}">${esc(I18n.t('empty.msg'))} <button type="button" class="link" data-clearf>${esc(I18n.t('empty.clear'))}</button></td></tr>`
      : '';
    t.innerHTML = `<thead><tr>${TABLE_COLS.map(([k, labelKey]) => `<th data-k="${k}">${esc(I18n.t(labelKey))}</th>`).join('')}</tr></thead>
      <tbody>${list.map(p => `<tr data-id="${esc(p.id)}" class="${active && !matchSet.has(p.id) ? 'nomatch' : ''}${S.selected === p.id ? ' sel' : ''}">
        ${TABLE_COLS.map(([k]) => { const v = cell(p, k); const s = v == null || v === '' ? '' : String(v); return s === '' ? '<td class="dash">—</td>' : `<td title="${esc(s)}">${esc(s)}</td>`; }).join('')}</tr>`).join('')}${noResults}</tbody>`;
    const clearRowBtn = t.querySelector('[data-clearf]'); if (clearRowBtn) clearRowBtn.onclick = resetFilters;
    $('thead', t).onclick = e => { const th = e.target.closest('th'); if (!th) return; const k = th.dataset.k; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 }; renderTable(); };
    $('tbody', t).onclick = e => { const tr = e.target.closest('tr'); if (tr) select(tr.dataset.id); };
  }
  /* --------------------------------- Misc --------------------------------- */
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }

  /* --------------------------- Load-error banner --------------------------- */
  // A failed or empty load stays visible on the page for as long as it lasts. A toast
  // vanishes after three seconds and leaves a blank screen behind, which reads as "the
  // app lost my family" — the most alarming possible way to show a network problem.
  function showLoadError(key, params) {
    S.loadError = { key: key, params: params || null };
    renderLoadError();
  }
  function clearLoadError() {
    if (!S.loadError) return;
    S.loadError = null;
    renderLoadError();
  }
  function renderLoadError() {
    const main = $('.main');
    if (!main) return;
    let box = $('#loadError');
    if (!S.loadError) { if (box) box.remove(); return; }
    if (!box) { box = el('div', 'load-error'); box.id = 'loadError'; main.insertBefore(box, main.firstChild); }
    // esc() because the message can carry a raw server error string.
    box.innerHTML = '<span class="msg">' + esc(I18n.fmt(S.loadError.key, S.loadError.params || {})) + '</span>' +
      '<button type="button" class="btn" id="loadErrorRetry">' + esc(I18n.t('generic.retry')) + '</button>';
    const btn = $('#loadErrorRetry');
    if (btn) btn.onclick = () => { clearLoadError(); syncFromServer(true); };
  }

  /* ------------------------------ Export to Excel ------------------------------ */
  // Same column order as the original spreadsheet (see COLS at the top of this file) so
  // an exported file can be opened next to the old one. Generation is the depth computed
  // from the tree, which is what the app displays.
  const EXPORT_COLS = [
    ['Individual_ID', p => p.legacy_id || p.id],
    ['Parent_ID', p => p.parent ? (p.parent.legacy_id || p.parent.id) : ''],
    ['Generation', p => p.gen],
    ['Gender', p => p.gender || ''],
    ['Full_Name', p => p.name || ''],
    ['Nick_Name', p => p.nick || ''],
    ['Fathers_Name', p => p.father || ''],
    ['Mothers_Name', p => p.mother || ''],
    ['Spouse_Name', p => p.spouse || ''],
    ['Spouse_Father_Name', p => p.spouseFather || ''],
    ['DOB', p => p.dob_display || p.dob || ''],
    ['Place_of_Birth', p => p.pob || ''],
    ['Qualification', p => p.qual || ''],
    ['Date_of_Death', p => p.dod_display || p.dod || ''],
    ['Place_of_Burial', p => p.burial || ''],
    ['Source_File', p => p.source || '']
  ];

  function exportToExcel() {
    if (!(Auth && Auth.isAdmin())) { toast(I18n.t('export.adminOnly')); return; }
    if (!window.XLSX) { toast(I18n.t('export.noSheetJs')); return; }
    // Deleted people are exported only when the admin is actually looking at them.
    const people = S.people.slice().sort((a, b) => a.gen - b.gen || String(a.name).localeCompare(String(b.name)));
    if (!people.length) { toast(I18n.t('export.empty')); return; }
    const header = EXPORT_COLS.map(c => c[0]);
    const rows = people.map(p => {
      const o = {};
      EXPORT_COLS.forEach(([h, get]) => { const v = get(p); o[h] = v == null ? '' : v; });
      return o;
    });
    try {
      const ws = XLSX.utils.json_to_sheet(rows, { header });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
      XLSX.writeFile(wb, 'Family_Tree_' + new Date().toISOString().slice(0, 10) + '.xlsx');
      toast(I18n.fmt('export.done', { n: rows.length }));
    } catch (e) {
      console.warn('Export failed:', e);
      toast(I18n.fmt('refresh.failed', { msg: (e && e.message) || String(e) }));
    }
  }

  /* ---------------------------- Refresh & live data ---------------------------- */
  let refreshing = false, autoRefreshT = null, pollTimer = null, peopleChannel = null, lastRefreshAt = 0;

  // Pull the tree again, keeping the current selection when that person still exists.
  // `quiet` skips the toast (used by Realtime and the 60s poll).
  async function syncFromServer(quiet) {
    if (refreshing || !(Auth && Auth.client && Auth.isAdminOrActive())) return;
    refreshing = true;
    const keep = S.selected;
    const btn = $('#btnRefresh');
    if (btn && !quiet) btn.classList.add('spin');
    try {
      Auth.clearPersonPaths();
      if (window.Photos && Photos.clearCache) Photos.clearCache();   // photos may have changed
      const rows = await loadData();
      if (rows && rows.length) {
        init(rows);
        if (keep && S.byId.has(keep)) select(keep);
      }
      lastRefreshAt = Date.now();
      if (!quiet) toast(I18n.t('refresh.done'));
    } catch (e) {
      console.warn('Refresh failed:', e);
      if (!quiet) toast(I18n.fmt('refresh.failed', { msg: (e && e.message) || String(e) }));
    } finally {
      refreshing = false;
      if (btn) setTimeout(() => btn.classList.remove('spin'), 400);
    }
  }

  // Several change events can land together; collapse them into one reload.
  function scheduleAutoRefresh() {
    clearTimeout(autoRefreshT);
    autoRefreshT = setTimeout(() => {
      // Never yank the ground out from under a form someone is filling in.
      if ($('#panel').querySelector('form')) { toast(I18n.t('live.updated')); return; }
      syncFromServer(true);
    }, 700);
  }

  // Realtime is the fast path; the 60s poll is a permanent safety net. A Realtime
  // subscription can also fail silently (for example when public.people has not been
  // added to the supabase_realtime publication), so polling always runs rather than
  // only after an explicit error. Polls are skipped when Realtime already refreshed
  // recently, so the two mechanisms don't double up.
  function startLiveUpdates() {
    if (peopleChannel || pollTimer) return;   // already listening
    if (!(Auth && Auth.client && Auth.isAdminOrActive())) return;
    try {
      peopleChannel = Auth.client
        .channel('public:people')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, scheduleAutoRefresh)
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn('Realtime unavailable (' + status + ') — falling back to the 60s poll.');
            if (peopleChannel && Auth.client.removeChannel) {
              try { Auth.client.removeChannel(peopleChannel); } catch (e) { /* nothing to do */ }
            }
            peopleChannel = null;
          }
        });
    } catch (e) {
      console.warn('Realtime subscribe failed — continuing with the 60s poll:', e);
      peopleChannel = null;
    }
    startPolling();
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (document.hidden) return;                          // nobody is looking
      if (Date.now() - lastRefreshAt < 55000) return;        // Realtime just did it
      scheduleAutoRefresh();
    }, 60000);
  }

  function stopLiveUpdates() {
    clearTimeout(autoRefreshT);
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (peopleChannel && Auth && Auth.client && Auth.client.removeChannel) {
      try { Auth.client.removeChannel(peopleChannel); } catch (e) { /* nothing to do */ }
    }
    peopleChannel = null;
  }

  // Loads the tree for the current session and nothing else. Called once from boot()
  // and again whenever the signed-in state or profile changes. Signing out drops the
  // data so a different account can never see the previous user's tree.
  let loadingData = false;
  async function reloadData() {
    if (loadingData) return;
    if (!(Auth && Auth.client && Auth.isAdminOrActive())) { clearTree(); return; }
    if (S.sourceLabel) return;   // already loaded for this session
    loadingData = true;
    try {
      const rows = await loadData();
      if (rows && rows.length) init(rows);
    } catch (e) {
      console.warn('Could not load the tree after a sign-in change:', e);
    } finally {
      loadingData = false;
    }
  }

  // Drop every trace of the loaded tree (used when signing out).
  function clearTree() {
    if (!S.people.length && !S.sourceLabel) return;
    S.people = []; S.byId = new Map(); S.kids = new Map(); S.roots = [];
    S.pos = new Map(); S.selected = null; S.collapsed.clear(); S.sourceLabel = '';
    S.editing = false; S.editForm = null; S.auditRows = [];
    S._allRows = []; S.showDeleted = false;
    const sd = $('#showDeleted'); if (sd) sd.checked = false;
    stopLiveUpdates();
    if (Auth) Auth.clearPersonPaths();
    const world = $('#world'); if (world) world.innerHTML = '';
    const panel = $('#panel'); if (panel) { panel.hidden = true; panel.innerHTML = ''; }
    clearLoadError();
    const table = $('#table'); if (table) table.innerHTML = '';
    const stats = $('#stats'); if (stats) stats.innerHTML = '';
    const sub = $('#subtitle'); if (sub) sub.textContent = '';
    const rc = $('#resultCount'); if (rc) rc.textContent = '';
  }

  function init(rows) {
    S.selected = null; S.collapsed.clear();
    build(rows);
    buildControls();
    resetFiltersSilently();
    closePanel();
    refresh(true);
  }
  function resetFiltersSilently() {
    Object.assign(S.f, { q: '', status: '', branch: '', pob: '', qual: '', has: '' });
    S.f.gens.clear(); S.f.genders.clear(); $('#search').value = '';
  }

  // ---------- Language picker ----------
  function toggleLangPicker() {
    const existing = document.querySelector('.lang-picker');
    if (existing) { closeLangPicker(); return; }
    const pop = document.createElement('div');
    pop.className = 'lang-picker';
    pop.innerHTML = I18n.languages.map(l => {
      const labels = { en: ['English', 'English'], ur: ['اردو', 'Urdu'], hi: ['हिंदी', 'Hindi'] };
      const [native, english] = labels[l] || [l, l];
      return `<button data-lang="${l}" ${l === I18n.currentLang() ? 'class="on"' : ''}>
        <span class="lang-name">${esc(native)}</span>
        <span class="lang-native"> · ${esc(english)}</span>
      </button>`;
    }).join('');
    document.body.appendChild(pop);
    // position below the lang button
    const btn = $('#btnLang');
    const r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.right = (innerWidth - r.right) + 'px';
    pop.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
      const lang = b.dataset.lang;
      I18n.setLanguage(lang);
      // persist in localStorage for anonymous users
      try { localStorage.setItem('ft-lang', lang); } catch (e) { /* ignore */ }
      // update the user's profile language if signed in
      if (Auth && Auth.client && Auth.session) {
        Auth.client.from('profiles').update({ language: lang }).eq('id', Auth.session.user.id)
          .then(({ error }) => {
            if (!error) Auth._ensureProfile();
          }).catch(() => { /* non-fatal — the UI already switched */ });
      }
      closeLangPicker();
    });
  }
  function closeLangPicker() { const p = document.querySelector('.lang-picker'); if (p) p.remove(); }

  /* ------------------------------------------------------------------
     Shared surface for js/personform.js, js/admin.js and js/extras.js.
     They are loaded as separate files, so this is the only way they can reach
     the tree model, the permissions and the toast/refresh helpers.
     ------------------------------------------------------------------ */
  window.FT = {
    esc: esc,
    t: (key, params) => (params ? I18n.fmt(key, params) : I18n.t(key)),
    toast: toast,
    client: () => (Auth && Auth.client) || null,
    me: () => (Auth && Auth.profile) || null,
    isAdmin: () => !!(Auth && Auth.isAdmin()),
    isEditor: () => !!(Auth && Auth.isActiveEditor()),
    canEdit: id => !!(Auth && Auth.canEditPerson(id)),
    people: () => S.people,
    // The raw model, for the tools that need positions rather than people (the PNG export).
    state: () => S,
    personById: id => S.byId.get(id) || null,
    kidsOf: id => S.kids.get(id) || [],
    descendantsOf: descendantsOf,
    FIELD_LABELS: FIELD_LABELS,
    fieldLabel: fieldLabel,
    dispName: dispName,
    genderLabel: genderLabel,
    parseDate: parseDate,
    ageText: ageText,
    fmtWhen: fmtWhen,
    initials: initials,
    // Field-completeness used by the admin's branch progress: only the fields
    // that matter are counted, optional ones (photos, Urdu/Hindi names) are not.
    completeness: p => {
      const missing = [];
      if (!p.gender) missing.push('gender');
      if (!p.dob && !p.dob_text) missing.push('dob');
      if ((S.kids.get(p.id) || []).length && !p.spouse) missing.push('spouse');
      return { missing: missing };
    },
    refresh: () => refresh(false),
    renderPanel: () => { if (S.selected) renderPanel(); },
    select: id => select(id, { focus: true }),
    // Draw the tree from a set of rows without a round trip. The print/PNG tools use
    // it after a refresh, and the automated UI checks use it to render fixture data.
    setRows: rows => init(rows),
    clearPanel: () => closePanel(),
    exportToExcel: exportToExcel,
    reloadProfile: () => { if (Auth) { Auth._sessionFresh = false; Auth._ensureProfile(); } },
    reload: () => reloadData(),
    // Re-fetch from Supabase, rebuild the model and select a person. Used after every
    // successful create / edit / delete so the tree, the table and the panel agree.
    async refreshAndSelect(id) {
      if (Auth && Auth.clearPersonPaths) Auth.clearPersonPaths();
      const rows = await loadData();
      if (Array.isArray(rows)) init(rows);
      if (id && S.byId.has(id)) select(id, { focus: true });
      else if (S.selected) renderPanel();
      else renderStats();
    }
  };

  // The i18n module only rewrites elements carrying a data-i18n attribute. Cards,
  // the detail panel, the table, the tooltips and the dialogs build their text in
  // JavaScript, so they have to be drawn again when the language changes.
  document.addEventListener('i18n:change', () => {
    if (window.PersonForm && PersonForm.isOpen()) PersonForm.close();
    if (window.Admin && Admin.isOpen()) Admin.close();
    if (window.Extras && Extras.isOpen && Extras.isOpen()) Extras.close();
    hideTip();
    if (!S.people.length) return;
    buildControls();
    // buildControls() rebuilds the dropdowns; put the current filter choices back.
    $('#fStatus').value = S.f.status || '';
    $('#fBranch').value = S.f.branch || '';
    $('#fPob').value = S.f.pob || '';
    $('#fQual').value = S.f.qual || '';
    $('#fHas').value = S.f.has || '';
    refresh(false);
    if (S.selected) renderPanel();
  });

  let booted = false;

  async function boot() {
    try { const t = localStorage.getItem('ft-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
    // Phase 6: an installable web app. Offline only ever serves the app shell — the
    // service worker ignores Supabase and the CDNs so nothing private is cached.
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered:', e && e.message));
    }
    // Initialise the Supabase auth client (async). Auth.init() must be called
    // before any Supabase data source or edit UI is used.
    if (Auth) { try { await Auth.init(); } catch (e) { console.warn('Auth.init failed:', e); } }
    if (!booted) { bindControls(); bindStage(); booted = true; }
    if (Auth && Auth._failureReason) {
      // The client could not be created (bad config / missing CDN). There is no static
      // tree to fall back to any more; the gate shows the reason.
      toast(I18n.fmt('auth.supabaseUnavailable', { msg: Auth._failureReason }));
      return;
    }
    // Phase 1: nothing loads until an active user is signed in. The auth callbacks call
    // reloadData() again as soon as the session and profile are known.
    reloadData();
  }
  boot();
})();
