/* =====================================================================
   HealthCheck — READ-ONLY data quality report for administrators.

   Everything here only READS rows that the admin can already see (the same
   `people` rows app.js already loads, plus profiles / branch_access) and
   turns them into findings. This module never writes: a correction is always
   made later through the normal person form, where the guard triggers and
   the audit log live. It never merges, deletes or changes anything.

   Check categories (also the UI filter values):
     duplicates  potential duplicate people (same name + shared facts)
     missing     incomplete records that actually matter
     dates       impossible / suspicious dates
     integrity   self-links, ambiguous spouse matches, multiple spouses
     branches    branches with many incomplete records

   Severity: 'high' (worth fixing first), 'medium' (review soon),
             'low' (information only, often legitimate).

   Every finding carries the person id(s) so the UI can open the records.

   Review markers: the database has no table for "issue reviewed", so
   dismissing a finding is stored in this browser ONLY (localStorage) and is
   clearly labelled as such. It is not a durable, shared record.
   ===================================================================== */

(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CATEGORIES = ['duplicates', 'missing', 'dates', 'integrity', 'branches'];
  const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

  /* ------------------------------- parsing ------------------------------- */
  function parseDate(v) {
    if (v == null || v === '') return null;
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  // A year we can trust loosely even when only dob_text exists ("1970", "1965 (approx)").
  function yearOf(p) {
    const d = parseDate(p.dob) || parseDate(p.dob_text ? String(p.dob_text).match(/\d{4}/)?.[0] : null);
    if (d) return d.getUTCFullYear();
    const m = String(p.dob_text || '').match(/(18|19|20)\d{2}/);
    return m ? +m[0] : null;
  }
  function deathYear(p) {
    const d = parseDate(p.dod) || parseDate(p.dod_text ? String(p.dod_text).match(/\d{4}/)?.[0] : null);
    return d ? d.getUTCFullYear() : null;
  }

  /* ------------------------------- checks -------------------------------- */
  // Pure functions over rows. Each returns findings; `run()` assembles them.
  // rows: the live people rows (id, full_name, name_ur, name_hi, gender, spouse_name,
  //       fathers_name, mothers_name, parent_id, dob, dob_text, dod, dod_text, path, is_removed…)

  function checkDuplicates(rows) {
    const out = [];
    const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const groups = new Map();
    rows.forEach(p => {
      if (p.is_deleted) return;
      const key = [norm(p.full_name), norm(p.name_ur), norm(p.name_hi)].find(Boolean);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    groups.forEach(list => {
      if (list.length < 2) return;
      // Same name is only interesting when at least one more fact agrees:
      // birth year, father, mother or spouse. Parent/spouse live as names here —
      // a text match is evidence, not proof (see the finding wording).
      const byYear = new Map(), byParent = new Map(), bySpouse = new Map();
      list.forEach(p => {
        const y = yearOf(p);
        if (y) { if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(p); }
        const pa = norm(p.fathers_name || p.mothers_name);
        if (pa) { if (!byParent.has(pa)) byParent.set(pa, []); byParent.get(pa).push(p); }
        const sp = norm(p.spouse_name);
        if (sp) { if (!bySpouse.has(sp)) bySpouse.set(sp, []); bySpouse.get(sp).push(p); }
      });
      const paired = new Set();
      const pair = (a, b, why, sev) => {
        const k = [a.id, b.id].sort().join('|');
        if (paired.has(k)) return;
        paired.add(k);
        out.push({
          category: 'duplicates', severity: sev,
          personIds: [a.id, b.id],
          titleKey: 'health.dupTitle',
          reasonKey: why,
          a: a.id, b: b.id,
          params: { n: list.length }
        });
      };
      // Same name AND same birth year -> strong candidate.
      byYear.forEach(list2 => { if (list2.length > 1) for (let i = 1; i < list2.length; i++) pair(list2[0], list2[i], 'health.dupYear', 'high'); });
      // Same name AND same father/mother/spouse -> also strong.
      byParent.forEach(list2 => { if (list2.length > 1) for (let i = 1; i < list2.length; i++) pair(list2[0], list2[i], 'health.dupParent', 'medium'); });
      bySpouse.forEach(list2 => { if (list2.length > 1) for (let i = 1; i < list2.length; i++) pair(list2[0], list2[i], 'health.dupSpouse', 'medium'); });
    });
    return out;
  }

  function checkMissing(rows, kidsMap) {
    const out = [];
    rows.forEach(p => {
      if (p.is_deleted) return;
      if (!String(p.full_name || '').trim()) {
        out.push({ category: 'missing', severity: 'high', personIds: [p.id], titleKey: 'health.missingName', reasonKey: 'health.missingNameWhy' });
        return;
      }
      if (!p.gender) {
        out.push({ category: 'missing', severity: 'low', personIds: [p.id], titleKey: 'health.missingGender', reasonKey: 'health.missingGenderWhy' });
      }
      const hasDates = p.dob || p.dob_text;
      const hasKids = (kidsMap.get(p.id) || []).length > 0;
      if (!hasDates && hasKids) {
        out.push({ category: 'missing', severity: 'medium', personIds: [p.id], titleKey: 'health.missingDobKids', reasonKey: 'health.missingDobKidsWhy' });
      }
      if (!p.spouse_name && hasKids) {
        // The other parent is naturally interesting. Not an error — a widowed or
        // single-parent record is legitimate. Information only.
        out.push({ category: 'missing', severity: 'low', personIds: [p.id], titleKey: 'health.missingSpouseKids', reasonKey: 'health.missingSpouseKidsWhy' });
      }
      if (!p.parent_id && !p.spouse_name) {
        // A root with no spouse: often the family's starting person. Low signal.
        out.push({ category: 'missing', severity: 'low', personIds: [p.id], titleKey: 'health.missingParentSpouse', reasonKey: 'health.missingParentSpouseWhy' });
      }
    });
    return out;
  }

  function checkDates(rows) {
    const out = [];
    const now = new Date().getUTCFullYear();
    rows.forEach(p => {
      if (p.is_deleted) return;
      const by = yearOf(p);
      const dy = deathYear(p);
      if (by && (by < 1700 || by > now)) {
        out.push({ category: 'dates', severity: 'medium', personIds: [p.id], titleKey: 'health.dobRange', reasonKey: 'health.dobRangeWhy', params: { y: by } });
      }
      if (dy && (dy < 1700 || dy > now + 1)) {
        out.push({ category: 'dates', severity: 'medium', personIds: [p.id], titleKey: 'health.dodRange', reasonKey: 'health.dodRangeWhy', params: { y: dy } });
      }
      if (by && dy && dy < by) {
        out.push({ category: 'dates', severity: 'high', personIds: [p.id], titleKey: 'health.dodBeforeDob', reasonKey: 'health.dodBeforeDobWhy' });
      }
    });
    // parent born after child (tolerance: 5 years, for historical sloppiness)
    const byId = new Map(rows.map(p => [p.id, p]));
    rows.forEach(p => {
      if (p.is_deleted || !p.parent_id) return;
      const parent = byId.get(p.parent_id);
      if (!parent || parent.is_deleted) return;
      const cb = yearOf(p), pb = yearOf(parent);
      if (cb && pb && pb > cb + 5) {
        out.push({
          category: 'dates', severity: 'high', personIds: [p.id, parent.id],
          titleKey: 'health.parentAfterChild', reasonKey: 'health.parentAfterChildWhy',
          params: { c: cb, p: pb }
        });
      }
    });
    return out;
  }

  function checkIntegrity(rows) {
    const out = [];
    const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    // 1. self-link
    rows.forEach(p => {
      if (p.parent_id && p.parent_id === p.id) {
        out.push({ category: 'integrity', severity: 'high', personIds: [p.id], titleKey: 'health.selfParent', reasonKey: 'health.selfParentWhy' });
      }
      if (p.spouse_name && norm(p.spouse_name) === norm(p.full_name)) {
        out.push({ category: 'integrity', severity: 'high', personIds: [p.id], titleKey: 'health.selfSpouse', reasonKey: 'health.selfSpouseWhy' });
      }
    });
    // 2. ambiguous spouse text: one spouse_name matches several different records
    const bySpouseKey = new Map();
    rows.forEach(p => {
      const sp = norm(p.spouse_name);
      if (!sp) return;
      if (!bySpouseKey.has(sp)) bySpouseKey.set(sp, []);
      bySpouseKey.get(sp).push(p);
    });
    bySpouseKey.forEach((owners, sp) => {
      if (owners.length < 2) return;
      // All owners claiming the same spouse text. If the spouse resolves to ONE
      // person, fine (normal couple). If it resolves to several DIFFERENT
      // records, at least one link is wrong.
      const matched = new Set();
      owners.forEach(o => {
        const hit = rows.find(r => !r.is_deleted && [norm(r.full_name), norm(r.name_ur), norm(r.name_hi)].includes(sp) && r.id !== o.id);
        if (hit) matched.add(hit.id);
      });
      if (matched.size > 1) {
        out.push({
          category: 'integrity', severity: 'high',
          personIds: [...owners.map(o => o.id), ...matched],
          titleKey: 'health.spouseAmbiguous', reasonKey: 'health.spouseAmbiguousWhy',
          params: { name: owners[0].spouse_name, n: matched.size }
        });
      }
    });
    // 3. disconnected people: multiple roots. Informational, never an error.
    const rootSet = new Set(rows.filter(p => !p.parent_id && !p.is_deleted).map(p => p.id));
    if (rootSet.size > 1) {
      out.push({
        category: 'integrity', severity: 'low',
        personIds: [...rootSet],
        titleKey: 'health.multipleRoots', reasonKey: 'health.multipleRootsWhy',
        params: { n: rootSet.size }
      });
    }
    return out;
  }

  function checkBranches(rows, kidsMap, editorMap, branchNames) {
    const out = [];
    // Branch = a root (and its whole subtree). Roots themselves are often the
    // family's first generation: report from the second generation down.
    const roots = rows.filter(p => !p.parent_id && !p.is_deleted);
    const seen = new Set();
    const childrenOf = (id) => rows.filter(p => p.parent_id === id && !p.is_deleted);
    const walk = (p, acc) => {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      acc.total++;
      const comp = completeness(p, kidsMap);
      if (comp.missing.length) acc.incomplete++;
      childrenOf(p.id).forEach(c => walk(c, acc));
    };
    completeness.missingFieldsDef = null; // (placeholder to keep linters calm)
    roots.forEach(r => {
      const acc = { total: 0, incomplete: 0, missing: {} };
      walk(r, acc);
      if (acc.total < 5) return;              // tiny offshoot, not worth a section
      if (!acc.incomplete) return;
      const topMissing = Object.entries(acc.missing).sort((a, b) => b[1] - a[1]).slice(0, 2)
        .map(([k, n]) => k + ' (' + n + ')').join(', ');
      const editorName = editorMap.get(r.id);
      // branch reason tail: who the editor is (if one is assigned)
      out.push({
        category: 'branches', severity: acc.incomplete / acc.total > .4 ? 'medium' : 'low',
        personIds: [r.id],
        titleKey: 'health.branchSparse', reasonKey: 'health.branchSparseWhy',
        params: {
          name: r.full_name,
          total: acc.total,
          incomplete: acc.incomplete,
          missing: topMissing || '—',
          editors: editorName ? ', editor: ' + editorName : ''
        }
      });
    });
    void branchNames;
    return out;
  }

  // Which fields actually matter per row. Used by branches and shared with app.js.
  function completeness(p, kidsMap) {
    const missing = [];
    if (!p.gender) missing.push('gender');
    if (!p.dob && !p.dob_text) missing.push('dob');
    if ((kidsMap.get(p.id) || []).length && !p.spouse_name) missing.push('spouse');
    return { missing: missing };
  }

  /* ------------------------------ assembly ------------------------------- */
  // rows: live `people` rows (may include path arrays), kidsMap optional overridden
  function run(rows, opts = {}) {
    const kidsMap = opts.kidsMap || buildKids(rows);
    const editorMap = opts.editorMap || new Map();
    let findings = [].concat(
      checkDuplicates(rows),
      checkMissing(rows, kidsMap),
      checkDates(rows),
      checkIntegrity(rows),
      checkBranches(rows, kidsMap, editorMap)
    ).map(f => Object.assign({}, f, { params: f.params || {} }));
    // personIds -> names for display
    const byId = new Map(rows.map(p => [p.id, p]));
    findings = findings.filter(f => f.personIds.every(id => byId.has(id)));
    findings.forEach(f => {
      f.names = f.personIds.map(id => {
        const p = byId.get(id);
        return p ? p.full_name : id.slice(0, 8);
      });
    });
    // high first, then medium then low, then title for stable ordering
    findings.sort((a, b) =>
      (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) ||
      a.category.localeCompare(b.category) ||
      String(a.names[0] || '').localeCompare(String(b.names[0] || '')));
    return { findings: findings, byId: byId, kidsMap: kidsMap };
  }

  function buildKids(rows) {
    const m = new Map(rows.map(p => [p.id, []]));
    rows.forEach(p => { if (p.parent_id && m.has(p.parent_id)) m.get(p.parent_id).push(p); });
    return m;
  }

  /* ------------------------------- rendering ------------------------------ */
  // localStorage-backed list of dismissed finding keys (this browser only)
  function storeKey(rowsStamp) { return 'ft-health-dismissed-' + rowsStamp; }
  function rowsStamp(rows) {
    return String(rows.length) + '-' + rows.slice(0, 3).map(p => String(p.id).slice(0, 6)).join('-');
  }
  function dismissedSet(rows) {
    try { return new Set(JSON.parse(localStorage.getItem(storeKey(rowsStamp(rows))) || '[]')); }
    catch (e) { return new Set(); }
  }
  function persistDismissed(rows, set) {
    try { localStorage.setItem(storeKey(rowsStamp(rows)), JSON.stringify([...set])); }
    catch (e) { /* private mode: markers just do not persist */ }
  }

  function keyOf(f) { return f.category + '|' + f.personIds.slice().sort().join('|') + '|' + f.titleKey; }

  function record(f, T, opts) {
    const openBtns = f.personIds.slice(0, 4).map(id =>
      '<button type="button" class="btn sm" data-open="' + esc(id) + '">' +
      esc(T('health.open') + ' ' + String(opts.names.get(id) || id.slice(0, 8))) + '</button>').join('');
    return '<div class="hc-finding sev-' + esc(f.severity) + '">' +
      '<div class="hc-finding-main">' +
      '<div class="hc-finding-title"><span class="hc-sev ' + esc(f.severity) + '">' + esc(T('health.sev.' + f.severity)) + '</span> ' +
      esc(T(f.titleKey, f.params)) + '</div>' +
      '<div class="hc-finding-reason">' + esc(T(f.reasonKey, f.params)) + '</div>' +
      '<div class="hc-finding-names">' + esc(f.names.join(' ↔ ')) + '</div>' +
      '<div class="hc-finding-actions">' + openBtns +
      '<button type="button" class="btn sm ghost" data-dismiss="' + esc(keyOf(f)) + '">' + esc(T('health.dismiss')) + '</button>' +
      '</div></div></div>';
  }

  // container, rows (live rows), opts { editorMap, showAllEditors }
  function render(container, rows, opts = {}) {
    const T = window.I18n ? (k, p) => (p ? I18n.fmt(k, p) : I18n.t(k)) : (k) => k;
    const res = run(rows, opts);
    const dismissed = opts.includeDismissed ? new Set() : dismissedSet(rows);
    const totals = {};
    CATEGORIES.forEach(c => { totals[c] = res.findings.filter(f => f.category === c && !dismissed.has(keyOf(f))).length; });
    const activeCat = opts.cat || '';
    const activeSev = opts.sev || '';
    const filtered = res.findings.filter(f =>
      !dismissed.has(keyOf(f)) &&
      (!activeCat || f.category === activeCat) &&
      (!activeSev || f.severity === activeSev));

    const chip = (cat, label) =>
      '<button type="button" class="chip' + (activeCat === cat ? ' on' : '') + '" data-cat="' + cat + '">' +
      esc(label) + ' <b>' + totals[cat] + '</b></button>';

    container.innerHTML =
      '<p class="admin-hint">' + esc(T('health.intro')) + '</p>' +
      '<div class="hc-filters">' +
      '<button type="button" class="chip' + (!activeCat ? ' on' : '') + '" data-cat="">' + esc(T('health.all')) + ' <b>' + res.findings.filter(f => !dismissed.has(keyOf(f))).length + '</b></button>' +
      chip('duplicates', T('health.cat.duplicates')) + chip('missing', T('health.cat.missing')) +
      chip('dates', T('health.cat.dates')) + chip('integrity', T('health.cat.integrity')) +
      chip('branches', T('health.cat.branches')) +
      '<select class="edit-input hc-sevsel" id="hc_sev">' +
      '<option value="">' + esc(T('health.sevAll')) + '</option>' +
      ['high', 'medium', 'low'].map(s => '<option value="' + s + '"' + (activeSev === s ? ' selected' : '') + '>' + esc(T('health.sev.' + s)) + '</option>').join('') +
      '</select>' +
      '<button type="button" class="btn sm ghost" id="hc_showdismissed">' +
      esc(opts.includeDismissed ? T('health.hideDismissed') : T('health.showDismissed')) + '</button>' +
      '</div>' +
      '<div class="hc-note">' + esc(T('health.readOnlyNote')) + '</div>' +
      (filtered.length
        ? filtered.map(f => record(f, T, { names: new Map(f.personIds.map(id => [id, res.byId.get(id).full_name])) })).join('')
        : '<div class="admin-empty">' + esc(T('health.clean')) + '</div>');

    const rerender = (patch) => render(container, rows, Object.assign({}, opts, patch));
    container.querySelectorAll('[data-cat]').forEach(b => { b.onclick = () => rerender({ cat: b.dataset.cat }); });
    const sev = container.querySelector('#hc_sev');
    if (sev) sev.onchange = () => rerender({ sev: sev.value });
    const showD = container.querySelector('#hc_showdismissed');
    if (showD) showD.onclick = () => rerender({ includeDismissed: !opts.includeDismissed });
    container.querySelectorAll('[data-open]').forEach(b => {
      b.onclick = () => { if (window.FT && FT.select) FT.select(b.dataset.open); };
    });
    container.querySelectorAll('[data-dismiss]').forEach(b => {
      b.onclick = () => {
        const s = dismissedSet(rows);
        s.add(b.dataset.dismiss);
        persistDismissed(rows, s);
        rerender({});
      };
    });
  }

  window.HealthCheck = { run: run, render: render, completeness: completeness, CATEGORIES: CATEGORIES };
})();
