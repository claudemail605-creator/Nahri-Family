/* =====================================================================
   Branch — the "My Family Branch" guided workspace (Priority 3).

   An invited, branch-limited editor lands HERE after signing in, instead of
   being dropped into the full family tree. The screen shows:
     * their assigned anchor person (or a choice, when there are several)
     * every relative they are actually allowed to work on
     * real completeness, computed live from the saved database fields
     * focused actions: Add/Edit details, Add a child, Add a spouse

   SECURITY MODEL (unchanged — the database stays the only authority):
     * Which people appear here is derived from branch_access, the same table
       the public.can_edit_person() RLS helper reads.
     * Every button an editor sees is gated by Auth.canEditPerson(), which
       mirrors can_edit_person() (anchor + descendants via people.path).
     * All writes go through the existing person form, so the same RLS
       policies, people_guard trigger and audit trigger answer them. Nothing
       here trusts a URL, location hash or browser state as authorisation —
       the hash only chooses which SCREEN is in front.
     * Nothing is fetched that the signed-in user could not have fetched
       anyway; RLS already decides what exists beyond the UI.

   The module reuses, deliberately:
     * the i18n dictionary (branch.* keys, en/ur/hi)
     * PersonForm for every write (with its duplicate-name warning)
     * the detail panel (FT.select) for "open someone"
     * FT state for the people model
   ===================================================================== */

(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (key, params) => (params ? I18n.fmt(key, params) : I18n.t(key));
  const FT = () => window.FT || {};
  const Auth = () => window.Auth || null;

  /* ------------------------------ state ------------------------------ */
  const S = {
    open: false,
    activeBranch: null,      // anchor person id the tiles are drawn from
    filter: 'all',           // 'all' | 'missing' | 'done'
    highlighted: null,       // id currently emphasised by "next person with gaps"
    redirectedFor: null      // profile id already auto-redirected (once per sign-in)
  };

  function section() { return $('#branchView'); }
  function isOpen() { return S.open; }

  function profile() { const a = Auth(); return a ? a.profile : null; }
  function isEditor() { const p = profile(); return !!(p && p.role === 'editor' && p.active); }
  function myBranchIds() {
    const a = Auth();
    return isEditor() ? ((a && a.branchAccess) || []).filter(Boolean) : [];
  }

  /* --------------------------- branch maths --------------------------- */
  // Anchor + all descendants, straight from the client model (which RLS lets
  // every active user read). This mirrors what can_edit_person() returns true
  // for, so nothing outside the editor's branches is ever offered for editing.
  function branchPeople(anchorId) {
    const f = FT();
    if (!f.personById || !f.kidsOf) return [];
    const seen = new Set(), out = [];
    const walk = id => {
      if (seen.has(id)) return;
      seen.add(id);
      const p = f.personById(id);
      if (!p) return;
      out.push(p);
      (f.kidsOf(id) || []).forEach(c => walk(c.id));
    };
    walk(anchorId);
    return out;
  }

  // Everything the current editor may edit, across all assigned branches.
  function myPeople() {
    const ids = myBranchIds();
    const seen = new Map();
    ids.forEach(id => branchPeople(id).forEach(p => seen.set(p.id, p)));
    return [...seen.values()];
  }

  /* ------------------------- completeness model ------------------------- */
  // Real fields only (the people table). Nothing invented, nothing saved that
  // the database did not confirm. Groups:
  //   identity (nickname) · gender · birth (date + place) · parents
  //   spouse · children · education/occupation · photo
  const MISSING_KEY = {
    nick: 'edit.nickname', gender: 'edit.gender', dob: 'edit.dob', pob: 'edit.pob',
    parents: 'edit.section.parents', spouse: 'edit.spouse', children: 'tooltip.children',
    qual: 'edit.qual', photo: 'edit.photoChoose'
  };

  function completeness(p) {
    const f = FT();
    const kids = (f.kidsOf ? f.kidsOf(p.id) : []) || [];
    const items = [
      ['nick', p.nick],
      ['gender', p.gender],
      ['dob', p.dob || p.dob_text],
      ['pob', p.pob],
      ['parents', p.father || p.mother || p.parentId],
      ['spouse', p.spouse],
      ['children', kids.length],
      ['qual', p.qual],
      ['photo', p.photo_path]
    ];
    const missing = items.filter(x => !x[1]).map(x => x[0]);
    const total = items.length;
    const pct = total ? Math.round(((total - missing.length) / total) * 100) : 100;
    return { missing: missing, pct: pct };
  }

  /* ------------------------------- view ------------------------------- */
  function show() {
    const secEl = section();
    if (!secEl) return;
    S.open = true;
    // Remember the choice so refreshing and signing back in lands here again.
    try { localStorage.setItem('ft-view', 'branch'); } catch (e) { /* ignore */ }

    const tree = $('#treeView'), table = $('#tableView');
    if (tree) tree.hidden = true;
    if (table) table.hidden = true;
    if (FT().clearPanel) FT().clearPanel();
    if (location.hash !== '#branch') {
      try { history.replaceState(null, '', '#branch'); } catch (e) { location.hash = 'branch'; }
    }
    // The section itself carries the `hidden` attribute from the HTML — show() owns it.
    secEl.hidden = false;
    render();
  }

  function goBackToTree() {
    S.open = false;
    try { localStorage.setItem('ft-view', 'tree'); } catch (e) { /* ignore */ }
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
    const tree = $('#treeView'), table = $('#tableView'), secEl = section();
    if (tree) tree.hidden = false;   // unhide FIRST so the seg highlight below computes against it
    if (secEl) { secEl.hidden = true; secEl.innerHTML = ''; }
    if (FT().clearPanel) FT().clearPanel();
    const sw = $('#viewSwitch');
    if (sw) {
      const target = $('#treeView') && !$('#treeView').hidden ? 'tree' : 'table';
      [...sw.children].forEach(x => x.classList.toggle('on', x.dataset.view === target));
    }
    if (tree) tree.hidden = false;
    if (FT() && FT().refresh) FT().refresh(false);
  }

  /* ------------------------------ render ------------------------------ */
  function render() {
    const secEl = section();
    if (!secEl || !S.open) return;
    const f = FT();
    const people = f.people ? f.people() : [];
    if (!people.length) {
      secEl.innerHTML = '<div class="branch-wrap"><div class="branch-empty">' +
        esc(T('branch.loadingPeople')) + '</div></div>';
      I18n.apply();
      return;
    }

    const ids = myBranchIds();
    const me = isEditor();

    // No valid assignment: a clear message, never a fake tree grant. Reading the
    // tree stays available exactly as today (the database decides that anyway).
    if (me && !ids.length) {
      secEl.innerHTML = '<div class="branch-wrap">' +
        '<div class="branch-hero"><h2>' + esc(T('branch.noAssignmentTitle')) + '</h2>' +
        '<p>' + esc(T('branch.noAssignmentSub')) + '</p>' +
        '<div class="branch-cta"><button type="button" class="btn primary" id="br_openTree">' +
        esc(T('branch.openTree')) + '</button></div></div></div>';
      const b = $('#br_openTree', secEl);
      if (b) b.onclick = goBackToTree;
      I18n.apply();
      return;
    }
    if (!me) { // an admin or an unexpected role: keep the existing experience
      goBackToTree();
      return;
    }

    // A valid anchor must exist in the model; drop stale ids quietly.
    const anchors = ids.filter(id => f.personById(id));
    if (!anchors.length && ids.length) {
      secEl.innerHTML = '<div class="branch-wrap"><div class="branch-empty">' +
        esc(T('branch.loadingPeople')) + '</div></div>';
      I18n.apply();
      return;
    }
    if (!S.activeBranch || !anchors.includes(S.activeBranch)) S.activeBranch = anchors[0];

    const anchor = f.personById(S.activeBranch);
    const list = branchPeople(S.activeBranch);
    const scored = list.map(p => Object.assign({}, p, { comp: completeness(p) }));
    const done = scored.filter(p => !p.comp.missing.length).length;
    const todo = scored.length - done;
    const pct = scored.length ? Math.round((done / scored.length) * 100) : 100;

    const shown = scored.filter(p =>
      S.filter === 'missing' ? p.comp.missing.length > 0 :
      S.filter === 'done' ? !p.comp.missing.length : true);

    secEl.innerHTML =
      '<div class="branch-wrap">' +
      // hero
      '<div class="branch-hero">' +
      '<h2>' + esc(T('branch.welcomeTitle')) + '</h2>' +
      '<p>' + esc(T('branch.welcomeSub')) + '</p>' +
      '<div class="branch-anchor">' + esc(T('branch.yourAnchor').split('{name')[0]) + '<b>' + esc(anchor ? (f.dispName ? f.dispName(anchor) : anchor.name) : '') + '</b>' +
      (anchor && anchor.dob_display ? '<span>· ' + esc(anchor.dob_display) + '</span>' : '') + '</div>' +
      '<div class="branch-cta">' +
      '<button type="button" class="btn primary" id="br_start">' + esc(T('branch.start')) + '</button>' +
      '<button type="button" class="btn ghost" id="br_backTree">' + esc(T('branch.backToTree')) + '</button>' +
      '</div></div>' +
      // progress
      '<div class="branch-summary">' +
      '<div class="branch-stat"><b>' + scored.length + '</b><span>' + esc(T('branch.statPeople')) + '</span></div>' +
      '<div class="branch-stat"><b class="ok">' + done + '</b><span>' + esc(T('branch.statComplete')) + '</span></div>' +
      '<div class="branch-stat"><b class="miss">' + todo + '</b><span>' + esc(T('branch.statMissing')) + '</span></div>' +
      '</div>' +
      '<div class="branch-bar"><div class="branch-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<p class="branch-note" style="margin-top:8px">' + esc(T('branch.summary', { c: done, n: scored.length, p: pct })) + '</p>' +
      // toolbar
      '<div class="branch-toolbar">' +
      '<div class="seg small">' +
      segBtn('all', T('branch.filterAll', { n: scored.length })) +
      segBtn('missing', T('branch.filterMissing', { n: todo })) +
      segBtn('done', T('branch.filterDone', { n: done })) +
      '</div>' +
      '<button type="button" class="btn sm" id="br_next">' + esc(T('branch.nextIncomplete')) + '</button>' +
      '<button type="button" class="btn ghost sm" id="br_backTree2">' + esc(T('branch.backToTree')) + '</button>' +
      '</div>' +
      // tiles
      (anchors.length > 1 ?
        '<div class="branch-note">' + esc(T('branch.chooseBranch')) + '<div class="tile-actions" style="margin-top:8px">' +
        anchors.map(aid => {
          const a = f.personById(aid);
          if (!a) return '';
          return '<button type="button" class="btn sm' + (aid === S.activeBranch ? ' primary' : '') + '" data-branch="' + esc(aid) + '">' +
            esc(f.dispName ? f.dispName(a) : a.name) + '</button>';
        }).join('') + '</div></div>' : '') +
      '<div class="person-grid" id="br_grid"></div>' +
      '</div>';

    // actions
    $('#br_start', secEl).onclick = () => {
      const first = firstIncomplete(scored);
      if (first) { S.highlighted = first.id; tileFocus(first.id); jumpToTile(first.id); }
      else { S.filter = 'all'; render(); }
    };
    $('#br_backTree', secEl).onclick = goBackToTree;
    $('#br_backTree2', secEl).onclick = goBackToTree;
    $('#br_next', secEl).onclick = () => {
      const next = firstIncomplete(shown);
      if (!next) { FT().toast(T('branch.everythingShown')); return; }
      S.highlighted = next.id;
      jumpToTile(next.id); tileFocus(next.id);
    };
    secEl.querySelectorAll('[data-branch]').forEach(b => {
      b.onclick = () => { S.activeBranch = b.dataset.branch; render(); };
    });
    secEl.querySelectorAll('[data-f]').forEach(b => {
      b.onclick = () => { S.filter = b.dataset.f; render(); };
    });

    const grid = $('#br_grid', secEl);
    grid.innerHTML = shown.map((p, i) => tileHtml(p, i)).join('');
    wireTiles(grid, shown);
    I18n.apply();
  }

  function segBtn(f, label) {
    return '<button type="button" data-f="' + f + '" class="' + (S.filter === f ? 'on' : '') + '">' +
      esc(label) + '</button>';
  }

  function firstIncomplete(list) { return list.find(p => p.comp.missing.length) || null; }

  function tileHtml(p, i) {
    const f = FT();
    const canEdit = !!(f.canEdit && f.canEdit(p.id));
    const miss = p.comp.missing.slice(0, 6);
    const doneTile = !p.comp.missing.length;
    const hl = S.highlighted === p.id ? ' highlight' : '';
    let actions = '';
    if (canEdit) {
      actions += '<button type="button" class="btn" data-act="edit" data-id="' + esc(p.id) + '">' +
        esc(T(doneTile ? 'branch.editDetails' : 'branch.addDetails')) + '</button>';
      actions += '<button type="button" class="btn sm" data-act="addchild" data-id="' + esc(p.id) + '">' +
        esc(T('panel.addChild')) + '</button>';
      if (!p.spouse) {
        actions += '<button type="button" class="btn sm" data-act="addspouse" data-id="' + esc(p.id) + '">' +
          esc(T('branch.addSpouseS')) + '</button>';
      }
    }
    const rel = p.parent ? (f.dispName ? f.dispName(p.parent) : p.parent.name) : '';
    return '<div class="person-tile ' + (doneTile ? 'done' : 'todo') + hl + '" role="button" tabindex="0" ' +
      'data-tile="' + esc(p.id) + '" style="animation-delay:' + Math.min(i * 30, 240) + 'ms">' +
      '<div class="tile-head">' +
      '<div class="tile-ring" style="--p:' + p.comp.pct + '%"><i>' + p.comp.pct + '%</i></div>' +
      '<div style="min-width:0"><div class="tile-name">' + esc(f.dispName ? f.dispName(p) : p.name) + '</div>' +
      (rel ? '<div class="tile-rel">' + esc(rel) + ' · ' + esc(T('chip.gen', { g: p.gen })) + '</div>' : '') +
      '</div></div>' +
      '<div class="tile-missing">' +
      (doneTile ? '<span class="tile-chip ok">' + esc(T('branch.complete')) + '</span>' :
        miss.map(m => '<span class="tile-chip">' + esc(T(MISSING_KEY[m] || m)) + '</span>').join('')) +
      '</div>' +
      (actions ? '<div class="tile-actions">' + actions + '</div>' : '') +
      '</div>';
  }

  function wireTiles(grid, shown) {
    grid.querySelectorAll('[data-tile]').forEach(tile => {
      const openTile = () => {
        const id = tile.dataset.tile;
        const p = FT().personById(id);
        if (!p) return;
        // Show the full record in the (existing) detail panel next to the
        // workspace — no duplicate data entry screens.
        FT().select(id);
      };
      tile.onclick = e => { if (!e.target.closest('[data-act]')) openTile(); };
      tile.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTile(); }
      };
    });
    grid.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        if (!window.PersonForm) { FT().toast(T('save.notConnected')); return; }
        const p = FT().personById(btn.dataset.id);
        if (!p) return;
        if (btn.dataset.act === 'edit') {
          PersonForm.open({ mode: 'edit', person: p });
        } else if (btn.dataset.act === 'addspouse') {
          // Dedicated add-spouse dialog: names the owner, inserts one row linked both ways.
          PersonForm.open({ mode: 'addspouse', person: p });
        } else if (btn.dataset.act === 'addchild') {
          PersonForm.open({ mode: 'addchild', parent: p });
        }
      };
    });
  }

  function tileFocus(id) {
    const tile = document.querySelector('[data-tile="' + CSS.escape(id) + '"]');
    if (tile) tile.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function jumpToTile(id) {
    const t = document.querySelector('[data-tile="' + CSS.escape(id) + '"]');
    if (t) { t.classList.add('highlight'); setTimeout(() => t.classList.remove('highlight'), 1400); }
  }

  /* ------------------------- navigation & nav item ------------------------- */
  function updateNav() {
    const on = isEditor();
    const btn = $('#btnBranch');
    if (btn) btn.hidden = !on;
    // Phones hide the top-bar item (<=640px), so the drawer carries a second one.
    const mbtn = $('#btnBranchMobile');
    if (mbtn) mbtn.hidden = !on;
  }

  // Decide where the user lands after a sign-in / profile (re)load.
  function onProfileReady(prof) {
    updateNav();
    if (!prof || !prof.active || prof.role !== 'editor') return;
    let chosen = null;
    try { chosen = localStorage.getItem('ft-view'); } catch (e) { /* ignore */ }
    const wantsHash = location.hash.indexOf('#branch') === 0;
    if (wantsHash) { S.redirectedFor = prof.id; show(); return; }
    if (chosen === 'branch') { show(); return; }
    // First visit as this editor (no explicit choice yet): land in the workspace.
    if (S.redirectedFor !== prof.id) {
      S.redirectedFor = prof.id;
      show();
    }
  }

  /* ------------------------------- wiring ------------------------------- */
  function init() {
    if (!section()) return;
    // The hash is only a navigation hint; refresh, back/forward and old links
    // resolve through the profile + branch_access every single time.
    window.addEventListener('hashchange', () => {
      if (!isOpen() && location.hash.indexOf('#branch') === 0 && isEditor()) show();
    });
    // Language switch re-draws every JS-rendered surface; the workspace too.
    document.addEventListener('i18n:change', () => { if (S.open) render(); });

    // After PersonForm saves, app.js reloads the data via FT.refreshAndSelect —
    // wrap it so the (saved) numbers reload into the workspace as well.
    if (window.FT) {
      const f = window.FT;
      const orig = f.refreshAndSelect;
      f.refreshAndSelect = async function (id) {
        const r = await orig(id);
        if (S.open) render();
        return r;
      };
    }
    const branchBtn = $('#btnBranch');
    if (branchBtn) branchBtn.onclick = () => { if (isEditor()) { S.open ? goBackToTree() : show(); } };
    const mBranchBtn = $('#btnBranchMobile');
    if (mBranchBtn) mBranchBtn.onclick = () => {
      if (!isEditor()) return;
      // Close the filter drawer so the branch workspace can be shown.
      window.drawer?.close?.() || (() => {
        const sb = $('#sidebar');
        if (sb) sb.classList.remove('open');
        const backdrop = $('#drawerBackdrop');
        if (backdrop) backdrop.hidden = true;
      })();
      show();
    };

    // If the profile is already known by the time this script runs, act on it.
    const a = Auth();
    if (a && a.profile && a.profile.active) onProfileReady(a.profile);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.Branch = {
    isOpen: isOpen,
    show: show,
    render: render,
    goBackToTree: goBackToTree,
    updateNav: updateNav,
    onProfileReady: onProfileReady,
    completeness: completeness,
    branchPeople: branchPeople,
    myPeople: myPeople
  };
})();
