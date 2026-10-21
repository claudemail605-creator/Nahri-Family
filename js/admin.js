/* =====================================================================
   Admin — the Phase 5 admin area (visible only to profile.role = 'admin').

   Tabs:
     Users             every account, invite a new one, edit role/branches,
                       resend the invitation, set a temporary password,
                       activate / deactivate
     Deletion requests  the queue editors create; approving soft-deletes
     Recently deleted   soft-deleted people with a Restore button
     Activity           the newest 100 audit_log rows, with filters
     Import and backup  .xlsx import with a preview, plus a JSON backup

   Account-creating actions (invite / resend / set password / ban) need the
   `admin-users` Edge Function, because they use the service-role key that must
   never reach the browser. Everything else (profiles, branch_access,
   deletion_requests, audit_log, people) is written straight from here and is
   allowed by the row-level security rules in database/01_schema.sql.

   Strings all come from I18n; the layout is RTL-safe.
   ===================================================================== */

(function () {
  'use strict';

  const T = (key, params) => (params ? I18n.fmt(key, params) : I18n.t(key));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FT = () => window.FT || {};
  const client = () => (FT().client ? FT().client() : null);

  const state = {
    open: false,
    tab: 'users',
    loading: false,
    users: [],          // profiles
    branches: new Map(), // user_id -> [person_id]
    lastSignIn: {},     // user_id -> iso string (only when the function is deployed)
    functionMissing: false,
    requests: [],
    deleted: [],
    activity: [],
    activityFilter: { user: '', person: '', action: '', from: '', to: '' },
    usersFilter: { q: '', status: '', branch: '' },
    healthRows: null,       // live people rows fetched when the health tab opens
    healthStamp: 0,
    importRows: null,
    importProblems: [],
    importFile: null,
    busy: false
  };

  function isOpen() { return state.open; }

  /* ------------------------------- shell -------------------------------- */
  let overlay = null;

  function open(tab) {
    if (!(FT().isAdmin && FT().isAdmin())) return;
    state.open = true;
    if (tab) state.tab = tab;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal admin-modal';
      overlay.id = 'adminModal';
      document.body.appendChild(overlay);
      document.documentElement.classList.add('modal-open');
      overlay.addEventListener('mousedown', e => { if (e.target === overlay && !state.busy) close(); });
      window.addEventListener('keydown', onKeydown, true);
    }
    overlay.hidden = false;
    renderShell();
    loadTab();
  }

  function close() {
    if (!overlay) { state.open = false; return; }
    if (state.busy) return;
    state.open = false;
    overlay.hidden = true;
    overlay.innerHTML = '';
    document.documentElement.classList.remove('modal-open');
  }

  function onKeydown(e) {
    if (!state.open || e.key !== 'Escape') return;
    if (document.querySelector('.modal-sub-dialog')) return;   // a nested dialog handles it
    e.preventDefault();
    close();
  }

  const TABS = [
    ['users', 'admin.tab.users'],
    ['health', 'admin.tab.health'],
    ['branches', 'admin.tab.branches'],
    ['requests', 'admin.tab.requests'],
    ['deleted', 'admin.tab.deleted'],
    ['activity', 'admin.tab.activity'],
    ['import', 'admin.tab.import']
  ];

  function renderShell() {
    overlay.innerHTML =
      '<div class="modal-card admin-card" role="dialog" aria-modal="true" aria-labelledby="admin_title">' +
      '<div class="modal-head">' +
      '<div><h3 id="admin_title">' + esc(T('admin.title')) + '</h3>' +
      '<p class="modal-sub">' + esc(T('admin.subtitle')) + '</p></div>' +
      '<div class="modal-head-actions">' +
      '<button type="button" class="btn sm" id="ad_reload">' + esc(T('admin.reload')) + '</button>' +
      '<button type="button" class="icon-btn" id="ad_close" aria-label="' + esc(T('admin.close')) + '">✕</button>' +
      '</div></div>' +
      '<div class="admin-tabs" role="tablist">' +
      TABS.map(([k, label]) =>
        '<button type="button" role="tab" data-tab="' + k + '" class="' + (state.tab === k ? 'on' : '') + '">' + esc(T(label)) + '</button>').join('') +
      '</div>' +
      '<div class="modal-body admin-body" id="ad_body"><div class="admin-empty">' + esc(T('generic.loading')) + '</div></div>' +
      '</div>';
    overlay.querySelector('#ad_close').onclick = close;
    overlay.querySelector('#ad_reload').onclick = () => loadTab(true);
    overlay.querySelectorAll('[data-tab]').forEach(b => {
      b.onclick = () => {
        state.tab = b.dataset.tab;
        overlay.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
        loadTab();
      };
    });
  }

  function body() { return overlay.querySelector('#ad_body'); }
  function say(html) { const b = body(); if (b) b.innerHTML = html; }

  function loadTab(force) {
    if (state.tab === 'users') return loadUsers(force);
    if (state.tab === 'health') return loadHealth(force);
    if (state.tab === 'branches') return loadBranchProgress();
    if (state.tab === 'requests') return loadRequests();
    if (state.tab === 'deleted') return loadDeleted();
    if (state.tab === 'activity') return loadActivity();
    if (state.tab === 'import') return renderImport();
  }

  /* ------------------------------ health ---------------------------------- */
  // READ ONLY: the report analyses the CURRENT saved rows, fetched fresh from
  // the database when the tab opens (and on the Reload button). It never writes.
  async function loadHealth(force) {
    const c = client();
    if (!c) { say('<div class="admin-empty">' + esc(T('save.notConnected')) + '</div>'); return; }
    state.busy = true;
    say('<div class="admin-empty">' + esc(T('generic.loading')) + '</div>');
    try {
      if (!state.users.length) {
        const { data, error } = await c.from('profiles').select('*');
        if (error) throw error;
        state.users = data || [];
      }
      if (!state.branches.size) {
        const { data, error } = await c.from('branch_access').select('user_id, person_id');
        if (error) throw error;
        state.branches = new Map();
        (data || []).forEach(r => {
          const list = state.branches.get(r.user_id) || [];
          list.push(r.person_id);
          state.branches.set(r.user_id, list);
        });
      }
      const fresh = force || !state.healthRows;
      if (fresh) {
        const { data, error } = await c.from('people').select('*').order('full_name', { ascending: true }).limit(10000);
        if (error) throw error;
        state.healthRows = data || [];
        state.healthStamp = Date.now();
      }
      renderHealth();
    } catch (err) {
      say('<div class="admin-empty">' + esc(T('admin.loadFailed', { msg: (err && err.message) || String(err) })) + '</div>');
    } finally {
      state.busy = false;
    }
  }

  function renderHealth() {
    if (!window.HealthCheck) {
      say('<div class="admin-empty">' + esc(T('health.noModule')) + '</div>');
      return;
    }
    // The report needs to re-render itself on filter changes, so it gets a wrapper
    // that stays in the DOM; HealthCheck binds to it and only re-draws inside it.
    say('<div id="hc_host"></div>');
    const host = overlay.querySelector('#hc_host');
    // who can edit which branch: for each branch anchor, the assigned editor(s)
    const editorMap = new Map();
    state.users.forEach(u => {
      if (u.role !== 'editor') return;
      (state.branches.get(u.id) || []).forEach(pid => editorMap.set(pid, u.full_name || u.email));
    });
    HealthCheck.render(host, state.healthRows, { editorMap: editorMap });
    const reload = document.createElement('button');
    reload.className = 'btn sm';
    reload.type = 'button';
    reload.textContent = T('admin.reload');
    reload.style.marginLeft = '8px';
    reload.onclick = () => loadHealth(true);
    host.querySelector('.hc-filters').appendChild(reload);
  }

  /* ------------------------------ small UI ------------------------------ */
  // A nested dialog (invite, edit user, set password, confirm) inside the admin card.
  function dialog(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-sub-wrap';
    wrap.innerHTML =
      '<div class="modal-sub-dialog" role="dialog" aria-modal="true">' +
      '<h4>' + esc(opts.title) + '</h4>' +
      (opts.sub ? '<p class="modal-sub">' + esc(opts.sub) + '</p>' : '') +
      '<form class="edit-form" id="subform">' + (opts.body || '') + '</form>' +
      '<div class="modal-sub-foot">' +
      '<button type="button" class="btn" data-cancel>' + esc(T('panel.cancel')) + '</button>' +
      '<button type="submit" form="subform" class="btn primary" data-ok>' + esc(opts.ok || T('admin.profileSave')) + '</button>' +
      '</div></div>';
    overlay.appendChild(wrap);
    const form = wrap.querySelector('#subform');
    const cancel = () => wrap.remove();
    wrap.querySelector('[data-cancel]').onclick = cancel;
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) cancel(); });
    form.onsubmit = async e => {
      e.preventDefault();
      const okBtn = wrap.querySelector('[data-ok]');
      okBtn.disabled = true;
      try {
        await opts.onSubmit(form, msg => say(msg));
        cancel();
      } catch (err) {
        okBtn.disabled = false;
        FT().toast((err && err.message) || String(err));
      }
    };
    const first = form.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 0);
    return wrap;
  }

  function val(form, sel) {
    const e = form.querySelector(sel);
    return e ? String(e.value || '').trim() : '';
  }

  function fmtWhen(iso) {
    if (!iso) return T('admin.never');
    const d = new Date(iso);
    if (isNaN(d)) return T('admin.never');
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function personOptionLabel(p) {
    // Language-aware: shows the Urdu/Hindi spelling when that language is active.
    const bits = [(FT().dispName ? FT().dispName(p) : p.name)];
    if (p.nick) bits.push('“' + p.nick + '”');
    bits.push(T('chip.gen', { g: p.gen }));
    if (p.parent) bits.push('— ' + (FT().dispName ? FT().dispName(p.parent) : p.parent.name));
    return bits.join(' · ');
  }

  /* --------------------------- the Edge Function --------------------------- */
  // Calls supabase/functions/admin-users. Returns { data } or throws an Error
  // carrying a translated message. `state.functionMissing` remembers a 404-ish
  // failure so the UI can say so plainly instead of repeating the raw error.
  async function fn(action, payload) {
    const c = client();
    if (!c || !c.functions) throw new Error(T('save.notConnected'));
    const { data, error } = await c.functions.invoke('admin-users', { body: Object.assign({ action: action }, payload || {}) });
    if (error) {
      const msg = (error.message || String(error));
      if (/failed to send|not found|404|4040/i.test(msg)) {
        state.functionMissing = true;
        throw new Error(T('admin.notDeployed'));
      }
      // The function answers 4xx/5xx with { error } in the body, which the client
      // surfaces as a FunctionsHttpError whose context carries the JSON.
      let detail = msg;
      try {
        const ctx = error.context;
        if (ctx && typeof ctx.json === 'function') {
          const j = await ctx.json();
          if (j && j.error) detail = j.error;
        }
      } catch (e) { /* keep the original message */ }
      throw new Error(detail);
    }
    if (data && data.error) throw new Error(data.error);
    return data || {};
  }

  async function fetchLastSignIn() {
    try {
      const data = await fn('list');
      (data.users || []).forEach(u => { state.lastSignIn[u.id] = u.last_sign_in_at || null; });
      state.functionMissing = false;
    } catch (e) {
      state.functionMissing = true;
    }
  }

  /* -------------------------------- users -------------------------------- */
  async function loadUsers(force) {
    const c = client();
    if (!c) { say('<div class="admin-empty">' + esc(T('save.notConnected')) + '</div>'); return; }
    state.busy = true;
    say('<div class="admin-empty">' + esc(T('admin.usersLoading')) + '</div>');
    try {
      const [profRes, branchRes] = await Promise.all([
        c.from('profiles').select('*').order('created_at', { ascending: true }),
        c.from('branch_access').select('user_id, person_id')
      ]);
      if (profRes.error) throw profRes.error;
      if (branchRes.error) throw branchRes.error;
      state.users = profRes.data || [];
      state.branches = new Map();
      (branchRes.data || []).forEach(r => {
        const list = state.branches.get(r.user_id) || [];
        list.push(r.person_id);
        state.branches.set(r.user_id, list);
      });
      if (force || !Object.keys(state.lastSignIn).length) await fetchLastSignIn();
      renderUsers();
    } catch (err) {
      say('<div class="admin-empty">' + esc(T('admin.usersFailed', { msg: (err && err.message) || String(err) })) + '</div>');
    } finally {
      state.busy = false;
    }
  }

  function userStatus(u) {
    if (u.active === false) return 'inactive';
    // me() being set to this account IS proof they signed in — the session is live.
    const me = FT().me && FT().me();
    if (me && me.id === u.id) return 'active';
    if (state.functionMissing) return 'unknown';
    return state.lastSignIn[u.id] ? 'active' : 'pending';
  }

  function renderUsers() {
    const f = state.usersFilter;
    const q = String(f.q || '').trim().toLowerCase();
    const users = state.users.filter(u => {
      if (q) {
        const hay = [u.full_name, u.email].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      if (f.status && userStatus(u) !== f.status) return false;
      if (f.branch && !(state.branches.get(u.id) || []).includes(f.branch)) return false;
      return true;
    });

    // Branch filter: every anchor that appears in branch_access.
    const anchorIds = [];
    state.branches.forEach(ids => ids.forEach(id => { if (!anchorIds.includes(id)) anchorIds.push(id); }));
    const branchOpts = anchorIds.map(id => {
      const p = FT().personById ? FT().personById(id) : null;
      return '<option value="' + esc(id) + '"' + (f.branch === id ? ' selected' : '') + '>' +
        esc(p ? (FT().dispName ? FT().dispName(p) : p.name) : id.slice(0, 8)) + '</option>';
    }).join('');
    const statusOpts = ['', 'pending', 'active', 'inactive']
      .map(sv => {
        const lbl = sv ? T('admin.status.' + sv) : T('status.everyone');
        return '<option value="' + sv + '"' + (f.status === sv ? ' selected' : '') + '>' + esc(lbl) + '</option>';
      }).join('');

    const rows = users.map(u => {
      const branchIds = state.branches.get(u.id) || [];
      const branchNames = branchIds.map(id => {
        const p = FT().personById ? FT().personById(id) : null;
        return p ? (FT().dispName ? FT().dispName(p) : p.name) : id.slice(0, 8);
      });
      const me = FT().me && FT().me();
      const isMe = !!(me && me.id === u.id);
      const st = userStatus(u);
      const role = u.role === 'admin' ? T('admin.inviteRoleAdmin') : T('admin.inviteRoleEditor');
      const chip = st === 'unknown' ? '' :
        '<span class="admin-status-chip ' + (st === 'active' ? 'seen' : st === 'pending' ? 'pending' : '') + '">' +
        esc(T('admin.status.' + st)) + '</span>';
      return '<div class="admin-user" data-user="' + esc(u.id) + '">' +
        '<div class="admin-user-main">' +
        '<div class="admin-user-name">' + esc(u.full_name || u.email) + ' ' + chip +
        (u.role === 'admin' ? ' <span class="tag">' + esc(T('admin.adminTag')) + '</span>' : '') +
        (!u.active ? ' <span class="tag gray">' + esc(T('admin.inactiveTag')) + '</span>' : '') +
        (isMe ? ' <span class="tag gray">' + esc(T('admin.you')) + '</span>' : '') + '</div>' +
        '<div class="admin-user-email">' + esc(u.email) + '</div>' +
        '<div class="admin-user-meta">' + esc(role) + '</div>' +
        '<div class="admin-user-meta"><b>' + esc(T('admin.col.branches')) + ':</b> ' +
        (branchNames.length ? esc(branchNames.join(', ')) : '<i>' + esc(T('admin.noBranches')) + '</i>') + '</div>' +
        '<div class="admin-user-meta"><b>' + esc(T('admin.col.lastSeen')) + ':</b> ' +
        esc(state.functionMissing ? T('admin.unknown')
          : (state.lastSignIn[u.id] ? fmtWhen(state.lastSignIn[u.id]) : T('admin.never'))) + '</div>' +
        '</div>' +
        '<div class="admin-user-actions">' +
        '<button type="button" class="btn sm" data-act="details">' + esc(T('admin.details')) + '</button>' +
        '<button type="button" class="btn sm" data-act="edit">' + esc(T('admin.editUser')) + '</button>' +
        '<button type="button" class="btn sm" data-act="resend">' + esc(T('admin.resendInvite')) + '</button>' +
        '<button type="button" class="btn sm" data-act="password">' + esc(T('admin.setTempPassword')) + '</button>' +
        (!u.active
          ? '<button type="button" class="btn sm" data-act="activate">' + esc(T('admin.activate')) + '</button>'
          : '<button type="button" class="btn sm danger" data-act="deactivate">' + esc(T('admin.deactivate')) + '</button>') +
        (st === 'pending' && !state.functionMissing && !isMe
          ? '<button type="button" class="btn sm ghost" data-act="cancel">' + esc(T('admin.cancelInvite')) + '</button>'
          : '') +
        '</div></div>';
    }).join('');

    say(
      (state.functionMissing ? '<div class="admin-notice">' + esc(T('admin.notDeployed')) + '</div>' : '') +
      '<div class="admin-filters">' +
      '<input class="edit-input" id="uf_q" type="search" placeholder="' + esc(T('admin.userSearch')) + '" value="' + esc(f.q) + '" autocomplete="off">' +
      '<select class="edit-input" id="uf_status">' + statusOpts + '</select>' +
      '<select class="edit-input" id="uf_branch"><option value="">' + esc(T('admin.filterAllBranches')) + '</option>' + branchOpts + '</select>' +
      '</div>' +
      '<div class="admin-bar"><button type="button" class="btn primary sm" id="ad_invite">' + esc(T('admin.inviteTitle')) + '</button>' +
      '<span class="admin-hint" style="margin-inline-start:auto">' + esc(T('admin.usersCount', { n: users.length, total: state.users.length })) + '</span></div>' +
      (rows || '<div class="admin-empty">' + esc((f.q || f.status || f.branch) ? T('admin.noUsersMatch') : T('admin.noUsers')) + '</div>')
    );

    const deb = (fnWork, ms) => { let tt; return (...a) => { clearTimeout(tt); tt = setTimeout(() => fnWork(...a), ms); }; };
    overlay.querySelector('#uf_q').oninput = deb(e => { state.usersFilter.q = e.target.value; renderUsers(); }, 150);
    overlay.querySelector('#uf_status').onchange = e => { state.usersFilter.status = e.target.value; renderUsers(); };
    overlay.querySelector('#uf_branch').onchange = e => { state.usersFilter.branch = e.target.value; renderUsers(); };

    overlay.querySelector('#ad_invite').onclick = openInvite;
    overlay.querySelectorAll('[data-user]').forEach(row => {
      const u = state.users.find(x => x.id === row.dataset.user);
      row.querySelectorAll('[data-act]').forEach(b => {
        b.onclick = () => {
          const act = b.dataset.act;
          if (act === 'details') return openUserDetails(u);
          if (act === 'edit') return openEditUser(u);
          if (act === 'resend') return resendInvite(u);
          if (act === 'password') return openSetPassword(u);
          if (act === 'deactivate') return setActive(u, false);
          if (act === 'activate') return setActive(u, true);
          if (act === 'cancel') return cancelInvite(u);
        };
      });
    });
  }

  // Account details: everything the trusted backend already gives, in one place.
  function openUserDetails(u) {
    const branchIds = state.branches.get(u.id) || [];
    const branchNames = branchIds.map(id => {
      const p = FT().personById ? FT().personById(id) : null;
      return (p ? (FT().dispName ? FT().dispName(p) : p.name) : id.slice(0, 8));
    });
    const st = userStatus(u);
    const last = state.functionMissing ? T('admin.unknown')
      : (state.lastSignIn[u.id] ? fmtWhen(state.lastSignIn[u.id]) : T('admin.never'));
    const rowsInfo = [
      [T('admin.col.name'), esc(u.full_name || u.email)],
      [T('admin.inviteEmail'), esc(u.email)],
      [T('admin.inviteRole'), esc(u.role === 'admin' ? T('admin.inviteRoleAdmin') : T('admin.inviteRoleEditor'))],
      [T('admin.col.status'), esc(st === 'unknown' ? T('admin.unknown') : T('admin.status.' + st))],
      [T('admin.col.accountStatus'), esc(u.active ? T('admin.status.active') : T('admin.inactiveTag'))],
      [T('admin.col.lastSeen'), esc(last)],
      [T('admin.col.created'), esc(u.created_at ? fmtWhen(u.created_at) : T('admin.unknown'))],
      [T('admin.col.branches'), esc(branchNames.length ? branchNames.join(', ') : T('admin.noBranches'))]
    ];
    const bodyHtml = rowsInfo.map(([k, v]) =>
      '<div class="p-row"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>').join('') +
      '<p class="admin-hint">' + esc(T('admin.detailsNote')) + '</p>' +
      '<div class="admin-bar"><button type="button" class="btn sm" id="ud_resend">' + esc(T('admin.resendOrRecovery')) + '</button></div>';
    const wrap = dialog({
      title: T('admin.detailsTitle', { name: u.full_name || u.email }),
      ok: T('panel.close'),
      body: bodyHtml,
      onSubmit: async () => { /* the OK button simply closes the details view */ }
    });
    const rb = wrap.querySelector('#ud_resend');
    if (rb) rb.onclick = () => resendInvite(u);
  }

  async function resendInvite(u) {
    try {
      const res = await fn('resend', { user_id: u.id });
      FT().toast(res && res.kind === 'recovery'
        ? T('admin.recoverySent', { email: u.email })
        : T('admin.resendDone', { email: u.email }));
    } catch (e) {
      FT().toast((e && e.message) || String(e));
    }
  }

  // Cancel a PENDING invitation: removes the not-yet-used account through the
  // Edge Function, which refuses anything that has ever signed in — so a real
  // account can never be deleted from here by accident.
  async function cancelInvite(u) {
    if (!window.confirm(T('admin.cancelInviteConfirm', { email: u.email }))) return;
    try {
      await fn('remove', { user_id: u.id });
      FT().toast(T('admin.cancelInviteDone', { email: u.email }));
      await loadUsers(true);
    } catch (e) {
      FT().toast((e && e.message) || String(e));
    }
  }

  // Branch picker: a filter box over a scrollable list of people with checkboxes.
  function branchPickerHtml(sel) {
    const chosen = new Set(sel || []);
    const list = (FT().people ? FT().people() : []).slice().sort((a, b) => a.gen - b.gen || String(a.name).localeCompare(String(b.name)));
    return '<div class="edit-field">' +
      '<label class="edit-label">' + esc(T('admin.inviteBranches')) + '</label>' +
      '<input class="edit-input" type="search" id="bp_filter" placeholder="' + esc(T('admin.inviteBranchesSearch')) + '" autocomplete="off">' +
      '<div class="branch-list" id="bp_list">' +
      list.map(p =>
        '<label class="check-row branch-item" data-name="' + esc(String(p.name).toLowerCase() + ' ' + String(p.name_ur || '').toLowerCase() + ' ' + String(p.name_hi || '').toLowerCase()) + '">' +
        '<input type="checkbox" value="' + esc(p.id) + '"' + (chosen.has(p.id) ? ' checked' : '') + '>' +
        '<span>' + esc(personOptionLabel(p)) + '</span></label>').join('') +
      '</div></div>';
  }

  function readBranchPicker(form) {
    return [...form.querySelectorAll('#bp_list input[type=checkbox]')].filter(c => c.checked).map(c => c.value);
  }

  function wireBranchFilter(form) {
    const f = form.querySelector('#bp_filter');
    if (!f) return;
    f.addEventListener('input', () => {
      const q = f.value.trim().toLowerCase();
      form.querySelectorAll('.branch-item').forEach(item => {
        item.hidden = !!(q && item.dataset.name.indexOf(q) < 0);
      });
    });
  }

  function openInvite() {
    dialog({
      title: T('admin.inviteTitle'),
      sub: T('admin.inviteSub'),
      ok: T('admin.inviteSend'),
      body:
        '<div class="edit-field"><label class="edit-label" for="iv_email">' + esc(T('admin.inviteEmail')) + ' *</label>' +
        '<input class="edit-input" id="iv_email" type="email" required></div>' +
        '<div class="edit-field"><label class="edit-label" for="iv_name">' + esc(T('admin.inviteName')) + ' *</label>' +
        '<input class="edit-input" id="iv_name" type="text" required></div>' +
        '<div class="edit-field"><label class="edit-label" for="iv_role">' + esc(T('admin.inviteRole')) + '</label>' +
        '<select class="edit-input" id="iv_role">' +
        '<option value="editor">' + esc(T('admin.inviteRoleEditor')) + '</option>' +
        '<option value="admin">' + esc(T('admin.inviteRoleAdmin')) + '</option></select></div>' +
        branchPickerHtml([]) +
        '<label class="check-row"><input type="checkbox" id="iv_mail" checked><span>' + esc(T('admin.inviteSendMail')) + '</span></label>' +
        // Live review box: the assignment is spelled out before the send button.
        '<div class="branch-note" id="iv_review"></div>',
      onSubmit: async (form) => {
        const email = val(form, '#iv_email');
        const name = val(form, '#iv_name');
        if (!email) throw new Error(T('admin.emailRequired'));
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(T('admin.emailInvalid'));
        if (!name) throw new Error(T('admin.nameRequired'));
        const branchIds = readBranchPicker(form);
        const sendMail = form.querySelector('#iv_mail').checked;
        const res = await fn('invite', { email: email, full_name: name, role: val(form, '#iv_role'), branch_person_ids: branchIds, send_email: sendMail });
        if (sendMail) FT().toast(T('admin.inviteDone', { email: email }));
        else if (res && res.temporary_password) FT().toast(T('admin.inviteNoMail', { pw: res.temporary_password }));
        else FT().toast(T('admin.inviteDone', { email: email }));
        await loadUsers(true);
      }
    });
    wireBranchFilter(overlay.querySelector('.modal-sub-dialog'));
    // Keep the review current with everything the admin has picked so far.
    const wrap = overlay.querySelector('.modal-sub-wrap');
    const reviewBox = wrap && wrap.querySelector('#iv_review');
    if (reviewBox) {
      const paintReview = () => {
        const name = val(wrap, '#iv_name') || '…';
        const email = val(wrap, '#iv_email') || '…';
        const role = val(wrap, '#iv_role') || 'editor';
        const roleLabel = role === 'admin' ? T('admin.inviteRoleAdmin') : T('admin.inviteRoleEditor');
        const branchNames = [...wrap.querySelectorAll('#bp_list input[type=checkbox]')].filter(c => c.checked)
          .map(c => {
            const p = FT().personById ? FT().personById(c.value) : null;
            return p ? (FT().dispName ? FT().dispName(p) : p.name) : c.value.slice(0, 8);
          });
        reviewBox.innerHTML =
          '<b>' + esc(T('branch.reviewTitle')) + '</b><br>' +
          esc(T('branch.reviewLine', { name: name, email: email, role: roleLabel, n: branchNames.length })) +
          (branchNames.length ? '<br>' + esc(branchNames.join(' · ')) : '<br><i>' + esc(T('branch.reviewNoBranches')) + '</i>');
      };
      paintReview();
      wrap.querySelector('#subform').addEventListener('input', paintReview);
      wrap.querySelector('#subform').addEventListener('change', paintReview);
    }
  }

  function openEditUser(u) {
    const isMe = FT().me && FT().me() && FT().me().id === u.id;
    dialog({
      title: T('admin.editTitle', { name: u.full_name || u.email }),
      ok: T('admin.profileSave'),
      body:
        '<div class="edit-field"><label class="edit-label" for="eu_name">' + esc(T('admin.inviteName')) + '</label>' +
        '<input class="edit-input" id="eu_name" type="text" value="' + esc(u.full_name || '') + '"></div>' +
        '<div class="edit-field"><label class="edit-label" for="eu_role">' + esc(T('admin.inviteRole')) + '</label>' +
        '<select class="edit-input" id="eu_role"' + (isMe ? ' disabled' : '') + '>' +
        '<option value="editor"' + (u.role === 'editor' ? ' selected' : '') + '>' + esc(T('admin.inviteRoleEditor')) + '</option>' +
        '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>' + esc(T('admin.inviteRoleAdmin')) + '</option></select>' +
        (isMe ? '<div class="edit-hint">' + esc(T('admin.selfRole')) + '</div>' : '') + '</div>' +
        branchPickerHtml(state.branches.get(u.id) || []),
      onSubmit: async (form) => {
        const branchIds = readBranchPicker(form);
        const role = isMe ? u.role : val(form, '#eu_role');
        const fullName = val(form, '#eu_name');
        if (!fullName) throw new Error(T('admin.nameRequired'));
        // Phase 5C: confirm before changing someone's branches, and before handing
        // out admin rights.
        const before = (state.branches.get(u.id) || []).slice().sort().join(',');
        const after = branchIds.slice().sort().join(',');
        if (before !== after && !window.confirm(T('admin.confirmBranches', { name: u.full_name || u.email }))) return;
        if (!isMe && role === 'admin' && u.role !== 'admin' && !window.confirm(T('admin.confirmRole', { name: u.full_name || u.email }))) return;
        // Everything here is allowed by RLS for an admin, so no Edge Function needed.
        const c = client();
        const { error } = await c.from('profiles').update({ full_name: fullName, role: role }).eq('id', u.id);
        if (error) throw new Error(/permission|policy/i.test(error.message) ? T('admin.profilePermError') : error.message);
        const del = await c.from('branch_access').delete().eq('user_id', u.id);
        if (del.error) throw new Error(del.error.message);
        if (branchIds.length) {
          const ins = await c.from('branch_access').insert(branchIds.map(pid => ({ user_id: u.id, person_id: pid })));
          if (ins.error) throw new Error(ins.error.message);
        }
        FT().toast(T('admin.branchesSaved'));
        if (isMe && FT().reloadProfile) FT().reloadProfile();
        await loadUsers(true);
      }
    });
    wireBranchFilter(overlay.querySelector('.modal-sub-dialog'));
  }

  async function resendInvite(u) {
    try {
      await fn('resend', { user_id: u.id });
      FT().toast(T('admin.resendDone', { email: u.email }));
    } catch (e) {
      FT().toast((e && e.message) || String(e));
    }
  }

  function openSetPassword(u) {
    dialog({
      title: T('admin.setTempPasswordTitle', { name: u.full_name || u.email }),
      sub: T('admin.setTempPasswordSub'),
      ok: T('admin.setTempPassword'),
      body: '<div class="edit-field"><label class="edit-label" for="sp_pw">' + esc(T('admin.tempPasswordLabel')) + '</label>' +
        '<input class="edit-input" id="sp_pw" type="text" minlength="8" required></div>',
      onSubmit: async (form) => {
        const pw = val(form, '#sp_pw');
        if (pw.length < 8) throw new Error(T('auth.pwTooShort'));
        await fn('set_password', { user_id: u.id, password: pw });
        FT().toast(T('admin.setTempPasswordDone', { name: u.full_name || u.email }));
      }
    });
  }

  async function setActive(u, active) {
    const me = FT().me && FT().me();
    if (!active && me && me.id === u.id) { FT().toast(T('admin.selfActive')); return; }
    if (!active && !window.confirm(T('admin.confirmDeactivate', { name: u.full_name || u.email }))) return;
    try {
      await fn('disable', { user_id: u.id, active: active });
      FT().toast(active ? T('admin.activated', { name: u.full_name || u.email }) : T('admin.deactivated', { name: u.full_name || u.email }));
      await loadUsers(true);
    } catch (e) {
      // Without the Edge Function the auth user cannot be banned, but the profile
      // flag still stops the account from using the tree — do that much directly.
      try {
        const c = client();
        const { error } = await c.from('profiles').update({ active: active }).eq('id', u.id);
        if (error) throw error;
        FT().toast(active ? T('admin.activated', { name: u.full_name || u.email }) : T('admin.deactivated', { name: u.full_name || u.email }));
        await loadUsers(true);
      } catch (e2) {
        FT().toast(T('admin.changeFailed', { msg: (e2 && e2.message) || String(e2) }));
      }
    }
  }

  /* ------------------------- branch progress (real data) ------------------------- */
  // A simple progress view for assigned branches. Every number is computed live
  // from the database-backed client model + branch_access/profiles rows — the
  // same definitions the "My Family Branch" workspace shows its editor, so an
  // admin sees what the editor sees. Nothing is hard-coded or estimated.
  async function loadBranchProgress(force) {
    const c = client();
    if (!c) { say('<div class="admin-empty">' + esc(T('save.notConnected')) + '</div>'); return; }
    say('<div class="admin-empty">' + esc(T('generic.loading')) + '</div>');
    try {
      if (!state.users.length || force) {
        const { data, error } = await c.from('profiles').select('*').order('full_name', { ascending: true });
        if (error) throw error;
        state.users = data || [];
      }
      if (!state.branches.size || force) {
        const { data, error } = await c.from('branch_access').select('user_id, person_id');
        if (error) throw error;
        state.branches = new Map();
        (data || []).forEach(r => {
          const list = state.branches.get(r.user_id) || [];
          list.push(r.person_id);
          state.branches.set(r.user_id, list);
        });
      }
      if (force || !Object.keys(state.lastSignIn).length) await fetchLastSignIn();
      renderBranchProgress();
    } catch (err) {
      say('<div class="admin-empty">' + esc(T('admin.loadFailed', { msg: (err && err.message) || String(err) })) + '</div>');
    }
  }

  function renderBranchProgress() {
    const f = FT();
    const rows = [];
    state.users.forEach(u => {
      if (u.role !== 'editor') return;                 // admins have no assignment
      const branchIds = state.branches.get(u.id) || [];
      if (!branchIds.length) return;                   // nothing assigned yet
      let total = 0, done = 0, missingFields = 0;
      const anchors = [];
      const seen = new Set();
      branchIds.forEach(pid => {
        if (!f.branchPeople) return;
        f.branchPeople(pid).forEach(p => {
          if (seen.has(p.id)) return;
          seen.add(p.id);
          total++;
          const comp = f.completeness ? f.completeness(p) : { missing: [] };
          if (!comp.missing.length) done++; else missingFields += comp.missing.length;
        });
        const ap = f.personById ? f.personById(pid) : null;
        if (ap) anchors.push(f.dispName ? f.dispName(ap) : ap.name);
      });
      const signedIn = state.functionMissing ? null : !!state.lastSignIn[u.id];
      const status = signedIn === null ? T('admin.unknown')
        : (signedIn ? T('admin.statusSignedIn') : T('admin.statusNotSignedIn'));
      const activeChip = u.active
        ? '<span class="admin-status-chip seen">' + esc(T('admin.statusActive')) + '</span>'
        : '<span class="admin-status-chip pending">' + esc(T('admin.inactiveTag')) + '</span>';
      rows.push(
        '<div class="branch-progress-row">' +
        '<div class="branch-progress-main">' +
        '<div class="branch-progress-name">' + esc(u.full_name || u.email) + activeChip + '</div>' +
        '<div class="branch-progress-meta">' + esc(u.email) + '</div>' +
        '<div class="branch-progress-meta"><b>' + esc(T('admin.branchAnchor')) + ':</b> ' +
        (anchors.length ? esc(anchors.join(', ')) : '—') + '</div>' +
        '<div class="branch-progress-meta"><b>' + esc(T('admin.branchSignIn')) + ':</b> ' + esc(status) + '</div>' +
        '</div>' +
        '<div class="branch-progress-stats">' +
        '<span>' + esc(T('admin.branchPeople')) + ': <b>' + total + '</b></span>' +
        '<span class="ok">' + esc(T('admin.branchComplete')) + ': <b>' + done + '</b></span>' +
        '<span class="miss">' + esc(T('admin.branchMissing')) + ': <b>' + (total - done) + '</b></span>' +
        '</div></div>');
    });
    say(
      '<p class="admin-hint">' + esc(T('admin.branchesSub')) + '</p>' +
      (rows.length ? rows.join('') : '<div class="admin-empty">' + esc(T('admin.branchesNone')) + '</div>'));
  }

  /* --------------------------- deletion requests --------------------------- */
  async function loadRequests() {
    const c = client();
    if (!c) { say('<div class="admin-empty">' + esc(T('save.notConnected')) + '</div>'); return; }
    say('<div class="admin-empty">' + esc(T('generic.loading')) + '</div>');
    try {
      const { data, error } = await c.from('deletion_requests')
        .select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      state.requests = data || [];
      renderRequests();
    } catch (err) {
      say('<div class="admin-empty">' + esc(T('admin.loadFailed', { msg: (err && err.message) || String(err) })) + '</div>');
    }
  }

  function renderRequests() {
    const pend = state.requests.filter(r => r.status === 'pending');
    const rest = state.requests.filter(r => r.status !== 'pending');
    const card = (r) => {
      const p = FT().personById ? FT().personById(r.person_id) : null;
      const by = personName(r.requested_by);
      return '<div class="delreq-row ' + (r.status === 'pending' ? 'delreq-pending' : 'delreq-resolved') + '">' +
        '<div><div class="delreq-person">' + esc(p ? (FT().dispName ? FT().dispName(p) : p.name) : r.person_id.slice(0, 8)) + '</div>' +
        '<div class="delreq-meta">' + esc(T('admin.requestBy', { name: by, when: fmtWhen(r.created_at) })) + '</div>' +
        '<div class="delreq-reason"><b>' + esc(T('admin.requestReason')) + ':</b> ' +
        esc(r.reason || T('admin.requestNoReason')) + '</div>' +
        (r.status !== 'pending' ? '<div class="delreq-meta">' + esc(T('admin.requestResolved', { when: fmtWhen(r.resolved_at) })) + '</div>' : '') +
        '</div>' +
        (r.status === 'pending'
          ? '<div class="delreq-actions">' +
          '<button type="button" class="btn sm danger" data-req="' + esc(r.id) + '" data-status="approved">' + esc(T('admin.approve')) + '</button>' +
          '<button type="button" class="btn sm" data-req="' + esc(r.id) + '" data-status="rejected">' + esc(T('admin.reject')) + '</button>' +
          '</div>'
          : '<span class="tag gray">' + esc(r.status === 'approved' ? T('panel.action.delete') : T('admin.reject')) + '</span>') +
        '</div>';
    };
    say(
      (pend.length ? pend.map(card).join('') : '<div class="admin-empty">' + esc(T('admin.requestsNone')) + '</div>') +
      (rest.length ? '<div class="admin-sep"></div>' + rest.map(card).join('') : '')
    );
    overlay.querySelectorAll('[data-req]').forEach(b => {
      b.onclick = () => resolveRequest(b.dataset.req, b.dataset.status);
    });
  }

  function personName(id) {
    const p = FT().personById ? FT().personById(id) : null;
    if (p) return (FT().dispName ? FT().dispName(p) : p.name);
    const u = state.users.find(x => x.id === id);
    if (u) return u.full_name || u.email;
    return id ? String(id).slice(0, 8) : '—';
  }

  async function resolveRequest(reqId, status) {
    const r = state.requests.find(x => x.id === reqId);
    if (!r) return;
    const p = FT().personById ? FT().personById(r.person_id) : null;
    if (status === 'approved') {
      const ok = window.confirm(T('admin.approveBody', { person: p ? (FT().dispName ? FT().dispName(p) : p.name) : r.person_id.slice(0, 8) }));
      if (!ok) return;
    }
    state.busy = true;
    try {
      const c = client();
      if (status === 'approved') {
        const { error } = await c.from('people').update({ is_deleted: true }).eq('id', r.person_id);
        if (error) throw error;
      }
      const { error: e2 } = await c.from('deletion_requests')
        .update({ status: status, resolved_by: FT().me ? (FT().me() || {}).id : null, resolved_at: new Date().toISOString() })
        .eq('id', reqId);
      if (e2) throw e2;
      FT().toast(status === 'approved' ? T('admin.requestApproved') : T('admin.requestRejected'));
      await loadRequests();
      if (FT().refreshAndSelect) await FT().refreshAndSelect();
    } catch (err) {
      FT().toast(T('admin.resolveFailed', { msg: (err && err.message) || String(err) }));
    } finally {
      state.busy = false;
    }
  }

  /* ---------------------------- recently deleted ---------------------------- */
  async function loadDeleted() {
    const c = client();
    if (!c) { say('<div class="admin-empty">' + esc(T('save.notConnected')) + '</div>'); return; }
    say('<div class="admin-empty">' + esc(T('generic.loading')) + '</div>');
    try {
      const { data, error } = await c.from('people')
        .select('id, full_name, gender, parent_id, updated_at, legacy_id')
        .eq('is_deleted', true)
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      state.deleted = data || [];
      renderDeleted();
    } catch (err) {
      say('<div class="admin-empty">' + esc(T('admin.loadFailed', { msg: (err && err.message) || String(err) })) + '</div>');
    }
  }

  function renderDeleted() {
    say(
      '<p class="admin-hint">' + esc(T('admin.deletedNote')) + '</p>' +
      (state.deleted.length
        ? state.deleted.map(p =>
          '<div class="admin-user"><div class="admin-user-main">' +
          '<div class="admin-user-name">' + esc(p.full_name) + '</div>' +
          '<div class="admin-user-meta">' + esc(T('admin.deletedWhen', { when: fmtWhen(p.updated_at) })) +
          (p.legacy_id ? ' · legacy ' + esc(p.legacy_id) : '') + '</div></div>' +
          '<div class="admin-user-actions"><button type="button" class="btn sm" data-restore="' + esc(p.id) + '">' +
          esc(T('admin.restore')) + '</button></div></div>').join('')
        : '<div class="admin-empty">' + esc(T('admin.deletedNone')) + '</div>')
    );
    overlay.querySelectorAll('[data-restore]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.restore;
        const p = state.deleted.find(x => x.id === id);
        state.busy = true;
        try {
          const { error } = await client().from('people').update({ is_deleted: false }).eq('id', id);
          if (error) throw error;
          FT().toast(T('admin.restored', { name: p ? p.full_name : '' }));
          await loadDeleted();
          if (FT().refreshAndSelect) await FT().refreshAndSelect(id);
        } catch (err) {
          FT().toast(T('admin.restoreFailed', { msg: (err && err.message) || String(err) }));
        } finally { state.busy = false; }
      };
    });
  }

  /* ------------------------------- activity ------------------------------- */
  async function loadActivity() {
    const c = client();
    if (!c) { say('<div class="admin-empty">' + esc(T('save.notConnected')) + '</div>'); return; }
    say('<div class="admin-empty">' + esc(T('generic.loading')) + '</div>');
    const f = state.activityFilter;
    try {
      let q = c.from('audit_log')
        .select('id, person_id, action, changed_by, changed_by_name, old_data, new_data, changed_at')
        .order('changed_at', { ascending: false })
        .limit(100);
      if (f.user) q = q.eq('changed_by', f.user);
      if (f.person) q = q.eq('person_id', f.person);
      if (f.action) q = q.eq('action', f.action);
      if (f.from) q = q.gte('changed_at', f.from + 'T00:00:00Z');
      if (f.to) q = q.lte('changed_at', f.to + 'T23:59:59Z');
      const { data, error } = await q;
      if (error) throw error;
      state.activity = data || [];
      renderActivity();
    } catch (err) {
      say('<div class="admin-empty">' + esc(T('admin.loadFailed', { msg: (err && err.message) || String(err) })) + '</div>');
    }
  }

  function renderActivity() {
    const f = state.activityFilter;
    const userOpts = state.users.map(u => '<option value="' + esc(u.id) + '"' + (f.user === u.id ? ' selected' : '') + '>' +
      esc(u.full_name || u.email) + '</option>').join('');
    const personOpts = (FT().people ? FT().people() : []).map(p => '<option value="' + esc(p.id) + '"' + (f.person === p.id ? ' selected' : '') + '>' +
      esc((FT().dispName ? FT().dispName(p) : p.name)) + '</option>').join('');
    const actionOpts = ['insert', 'update', 'delete', 'restore', 'hard_delete']
      .map(a => '<option value="' + a + '"' + (f.action === a ? ' selected' : '') + '>' + esc(T('panel.action.' + a)) + '</option>').join('');

    say(
      '<div class="admin-filters">' +
      '<label>' + esc(T('admin.filterUser')) + '<select id="fl_user"><option value="">' + esc(T('status.everyone')) + '</option>' + userOpts + '</select></label>' +
      '<label>' + esc(T('admin.filterPerson')) + '<select id="fl_person"><option value="">' + esc(T('status.everyone')) + '</option>' + personOpts + '</select></label>' +
      '<label>' + esc(T('admin.filterAction')) + '<select id="fl_action"><option value="">' + esc(T('status.everyone')) + '</option>' + actionOpts + '</select></label>' +
      '<label>' + esc(T('admin.filterFrom')) + '<input type="date" id="fl_from" value="' + esc(f.from) + '"></label>' +
      '<label>' + esc(T('admin.filterTo')) + '<input type="date" id="fl_to" value="' + esc(f.to) + '"></label>' +
      '<button type="button" class="btn sm primary" id="fl_apply">' + esc(T('admin.filterApply')) + '</button>' +
      '<button type="button" class="btn sm" id="fl_clear">' + esc(T('admin.filterClear')) + '</button>' +
      '</div>' +
      '<p class="admin-hint">' + esc(T('admin.activitySub')) + '</p>' +
      (state.activity.length
        ? state.activity.map(a =>
          '<div class="audit-row"><div class="audit-meta">' +
          '<span class="audit-action ' + esc(a.action) + '">' + esc(T('panel.action.' + a.action) || a.action) + '</span> · ' +
          esc(a.changed_by_name || '—') + ' · ' + esc(fmtWhen(a.changed_at)) +
          (a.person_id ? ' · ' + esc(personName(a.person_id)) : '') +
          '</div>' + changesHtml(a) + '</div>').join('')
        : '<div class="admin-empty">' + esc(T('admin.activityNone')) + '</div>')
    );

    overlay.querySelector('#fl_apply').onclick = () => {
      state.activityFilter = {
        user: overlay.querySelector('#fl_user').value,
        person: overlay.querySelector('#fl_person').value,
        action: overlay.querySelector('#fl_action').value,
        from: overlay.querySelector('#fl_from').value,
        to: overlay.querySelector('#fl_to').value
      };
      loadActivity();
    };
    overlay.querySelector('#fl_clear').onclick = () => {
      state.activityFilter = { user: '', person: '', action: '', from: '', to: '' };
      loadActivity();
    };
  }

  // Which columns actually changed, with old -> new values.
  function changesHtml(a) {
    if (a.action === 'insert') return '';
    const oldD = a.old_data || {}, newD = a.new_data || {};
    const skip = { path: 1, updated_at: 1, updated_by: 1, created_at: 1, created_by: 1 };
    const keys = Object.keys(FT().FIELD_LABELS || {});
    const shown = [];
    keys.forEach(k => {
      if (skip[k]) return;
      const before = oldD[k], after = newD[k];
      if (String(before == null ? '' : before) === String(after == null ? '' : after)) return;
      shown.push('<div class="change-row"><b>' + esc(FT().fieldLabel(k)) + '</b> ' +
        '<span class="change-old">' + esc(before == null || before === '' ? '—' : before) + '</span> → ' +
        '<span class="change-new">' + esc(after == null || after === '' ? '—' : after) + '</span></div>');
    });
    if (!shown.length) return '';
    return '<div class="audit-delta">' + shown.join('') + '</div>';
  }

  /* --------------------------- import and backup --------------------------- */
  function renderImport() {
    const rows = state.importRows;
    const problems = state.importProblems;
    say(
      '<div class="admin-section">' +
      '<h5>' + esc(T('admin.importTitle')) + '</h5>' +
      '<p class="admin-hint">' + esc(T('admin.importSub')) + '</p>' +
      '<div class="admin-bar">' +
      '<button type="button" class="btn sm" id="im_pick">' + esc(T('admin.importPick')) + '</button>' +
      '<span class="admin-hint" id="im_status">' + (rows ? esc(T('admin.importRows', { n: rows.length })) + (state.importFile ? ' · ' + esc(state.importFile.name) : '') : '') + '</span>' +
      '</div>' +
      '<input type="file" id="im_file" accept=".xlsx,.xls" hidden>' +
      (rows ? '<div class="import-problems">' +
        (problems.length
          ? '<h5>' + esc(T('admin.importProblems', { n: problems.length })) + '</h5><ul>' +
          problems.slice(0, 100).map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>'
          : '<p class="ok">' + esc(T('admin.importNoProblems')) + '</p>') +
        '</div>' : '') +
      (rows ? '<label class="check-row"><input type="checkbox" id="im_update"><span>' + esc(T('admin.importUpdate')) + '</span></label>' +
        '<div class="import-preview">' +
        '<table class="mini"><thead><tr><th>ID</th><th>Parent</th><th>' + esc(T('table.col.name')) + '</th><th>' + esc(T('table.col.gender')) + '</th><th>' + esc(T('table.col.dob')) + '</th></tr></thead><tbody>' +
        rows.slice(0, 50).map(r => '<tr><td>' + esc(r.legacy) + '</td><td>' + esc(r.parent || '—') + '</td><td>' + esc(r.full_name) + '</td><td>' + esc(r.gender || '—') + '</td><td>' + esc(r.dob || r.dob_text || '—') + '</td></tr>').join('') +
        '</tbody></table>' + (rows.length > 50 ? '<p class="admin-hint">… ' + esc(rows.length - 50) + '</p>' : '') + '</div>' +
        '<div class="admin-bar"><button type="button" class="btn primary sm" id="im_run">' + esc(T('admin.importRun', { n: rows.length })) + '</button></div>' : '') +
      '</div>' +
      '<div class="admin-section">' +
      '<h5>' + esc(T('admin.backupTitle')) + '</h5>' +
      '<p class="admin-hint">' + esc(T('admin.backupSub')) + '</p>' +
      '<div class="admin-bar">' +
      '<button type="button" class="btn sm" id="bk_json">' + esc(T('admin.backupButton')) + '</button>' +
      '<button type="button" class="btn sm" id="bk_xlsx">' + esc(T('export.button')) + '</button>' +
      '</div></div>'
    );

    const fileEl = overlay.querySelector('#im_file');
    overlay.querySelector('#im_pick').onclick = () => fileEl.click();
    fileEl.onchange = () => onImportFile(fileEl.files && fileEl.files[0]);
    if (state.importRows) {
      overlay.querySelector('#im_run').onclick = () => {
        const update = overlay.querySelector('#im_update').checked;
        if (!window.confirm(T('admin.importConfirm'))) return;
        runImport(update);
      };
    }
    overlay.querySelector('#bk_json').onclick = downloadBackup;
    overlay.querySelector('#bk_xlsx').onclick = () => { close(); if (FT().exportToExcel) FT().exportToExcel(); };
  }

  async function onImportFile(file) {
    if (!file) return;
    if (!window.XLSX) { FT().toast(T('export.noSheetJs')); return; }
    const status = overlay.querySelector('#im_status');
    if (status) status.textContent = T('admin.importReading');
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      state.importRows = parseWorkbook(wb);
      state.importFile = file;
      renderImport();
    } catch (err) {
      FT().toast(T('admin.importFailed', { msg: (err && err.message) || String(err) }));
    }
  }

  // Read the original column layout and report every problem found. Nothing is
  // written to the database from here.
  function parseWorkbook(wb) {
    const SHEET = 'Family_Data';
    const ws = wb.Sheets[SHEET] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error(T('admin.importSheetMissing', { sheet: SHEET }));
    const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, cellDates: true });
    const norm = h => String(h || '').toLowerCase().replace(/[^a-z]/g, '');
    const MAP = {
      individualid: 'legacy', parentid: 'parent', gender: 'gender', fullname: 'full_name',
      nickname: 'nick_name', fathersname: 'fathers_name', mothersname: 'mothers_name',
      spousename: 'spouse_name', spousefathername: 'spouse_father_name', dob: 'dob_text',
      placeofbirth: 'place_of_birth', qualification: 'qualification', dateofdeath: 'dod_text',
      placeofburial: 'place_of_burial', sourcefile: 'source',
      nameurdu: 'name_ur', nameur: 'name_ur', namerdu: 'name_ur',
      namehindi: 'name_hi', namehi: 'name_hi'
    };
    const problems = [];
    const rows = raw.map((r, i) => {
      const o = {};
      for (const k of Object.keys(r)) {
        const f = MAP[norm(k)];
        if (!f) continue;
        let v = r[k];
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        o[f] = (v == null || String(v).trim() === '') ? null : String(v).trim();
      }
      if (!o.legacy) { problems.push(T('admin.importNoName', { id: '#' + (i + 2) })); return null; }
      if (!o.full_name) { problems.push(T('admin.importNoName', { id: o.legacy })); return null; }
      if (o.gender && o.gender !== 'Male' && o.gender !== 'Female') {
        problems.push(T('admin.importBadGender', { id: o.legacy, value: o.gender }));
        o.gender = null;
      }
      o.dob = isoDate(o.dob_text);
      o.dod = isoDate(o.dod_text);
      // "1970" and "1965 (approx)" are legitimate partial dates: they live on in
      // dob_text/dod_text. Only a value shaped like a full date that is not one is
      // worth showing the admin as a problem.
      if (o.dob_text && !o.dob && looksNumericDate(o.dob_text)) problems.push(T('admin.importBadDate', { id: o.legacy, value: o.dob_text }));
      if (o.dod_text && !o.dod && looksNumericDate(o.dod_text)) problems.push(T('admin.importBadDate', { id: o.legacy, value: o.dod_text }));
      if (o.dob && o.dod && o.dod < o.dob) problems.push(T('admin.importDodBeforeDob', { id: o.legacy }));
      return o;
    }).filter(Boolean);

    const ids = new Map();
    rows.forEach(r => ids.set(r.legacy, (ids.get(r.legacy) || 0) + 1));
    ids.forEach((n, id) => { if (n > 1) problems.push(T('admin.importDup', { id: id, n: n })); });
    const known = new Set(rows.map(r => r.legacy));
    rows.forEach(r => {
      if (r.parent && !known.has(r.parent)) {
        problems.push(T('admin.importBadParent', { id: r.legacy, parent: r.parent }));
        r.parent = null;
      }
    });
    state.importProblems = problems;
    return orderParentsFirst(rows);
  }

  // "01/03/1970" or "1970-03-01" -> "1970-03-01"; partial dates stay text-only.
  // Does this read as a full date (any separator, day or year first)?
  const looksNumericDate = s => /^\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}$/.test(String(s == null ? '' : s).trim());

  function isoDate(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return null;
    let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
    if (m) {
      const y = +m[3], mo = +m[2], d = +m[1];
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
        return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
      return null;
    }
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) {
      // Check the day and month too: a spreadsheets cell typed as "1985-13-45" matches
      // the shape of a date but is not one, and it must be reported instead of being
      // handed to the database as a broken value.
      const y = +m[1], mo = +m[2], d = +m[3];
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
        return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
    }
    return null;
  }

  function orderParentsFirst(rows) {
    const byId = new Map(rows.map(r => [r.legacy, r]));
    const out = [], done = new Set(), visiting = new Set();
    const visit = (r) => {
      if (done.has(r.legacy)) return;
      if (visiting.has(r.legacy)) { r.parent = null; return; }
      visiting.add(r.legacy);
      const p = r.parent ? byId.get(r.parent) : null;
      if (p) visit(p);
      visiting.delete(r.legacy);
      done.add(r.legacy);
      out.push(r);
    };
    rows.forEach(visit);
    return out;
  }

  async function runImport(updateExisting) {
    const c = client();
    const rows = state.importRows || [];
    if (!rows.length) { FT().toast(T('admin.importNothing')); return; }
    state.busy = true;
    let added = 0, updated = 0;
    const idMap = new Map();   // legacy_id -> uuid
    try {
      // Existing legacy ids (so a re-import can update instead of duplicating).
      const { data: existing, error: e0 } = await c.from('people').select('id, legacy_id').not('legacy_id', 'is', null);
      if (e0) throw e0;
      (existing || []).forEach(r => idMap.set(r.legacy_id, r.id));

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const payload = {
          gender: r.gender, full_name: r.full_name, nick_name: r.nick_name,
          fathers_name: r.fathers_name, mothers_name: r.mothers_name,
          spouse_name: r.spouse_name, spouse_father_name: r.spouse_father_name,
          dob: r.dob, dob_text: r.dob_text, place_of_birth: r.place_of_birth,
          qualification: r.qualification, dod: r.dod, dod_text: r.dod_text,
          place_of_burial: r.place_of_burial, name_ur: r.name_ur, name_hi: r.name_hi,
          source: r.source
        };
        const parentId = r.parent ? idMap.get(r.parent) : null;
        const known = idMap.get(r.legacy);

        if (known && !updateExisting) { continue; }
        if (known) {
          const { error } = await c.from('people').update(Object.assign({ parent_id: parentId || null }, payload)).eq('id', known);
          if (error) throw error;
          updated++;
        } else {
          const { data, error } = await c.from('people')
            .insert(Object.assign({ legacy_id: r.legacy, parent_id: parentId || null }, payload))
            .select('id').single();
          if (error) throw error;
          idMap.set(r.legacy, data.id);
          added++;
        }
        const status = overlay.querySelector('#im_status');
        if (status) status.textContent = T('admin.importWorking', { done: i + 1, total: rows.length });
      }
      FT().toast(T('admin.importDone', { added: added, updated: updated }));
      state.importRows = null;
      state.importProblems = [];
      state.importFile = null;
      if (FT().refreshAndSelect) await FT().refreshAndSelect();
      renderImport();
    } catch (err) {
      FT().toast(T('admin.importFailed', { msg: (err && err.message) || String(err) }));
    } finally {
      state.busy = false;
    }
  }

  async function downloadBackup() {
    const c = client();
    state.busy = true;
    try {
      const [people, profiles, branches, requests, audit] = await Promise.all([
        c.from('people').select('*').limit(10000),
        c.from('profiles').select('*').limit(1000),
        c.from('branch_access').select('*').limit(10000),
        c.from('deletion_requests').select('*').limit(10000),
        c.from('audit_log').select('*').order('changed_at', { ascending: false }).limit(5000)
      ]);
      const first = [people, profiles, branches, requests, audit].find(r => r.error);
      if (first) throw first.error;
      const payload = {
        exported_at: new Date().toISOString(),
        app: 'FamilyTree',
        people: people.data || [],
        profiles: profiles.data || [],
        branch_access: branches.data || [],
        deletion_requests: requests.data || [],
        audit_log: audit.data || []
      };
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Family_Tree_Backup_' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      FT().toast(T('admin.backupDone', { n: payload.people.length }));
    } catch (err) {
      FT().toast(T('admin.importFailed', { msg: (err && err.message) || String(err) }));
    } finally {
      state.busy = false;
    }
  }

  window.Admin = { open: open, close: close, isOpen: isOpen };
})();
