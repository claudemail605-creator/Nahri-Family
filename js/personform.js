/* =====================================================================
   PersonForm — ONE reusable dialog for "add a person" and "edit a person".

   Phase 4 requirements this file implements:
     * sections: Names / Parents / Spouse / Life events / Notes + photo
     * the tree parent is read-only when adding a child, and when editing it is
       read-only for editors but a searchable picker for admins
     * validation with inline messages: name required, gender required, death
       before birth, birth in the future, and a warn-only duplicate name+parent
     * the Save button is disabled while the request is in flight
     * INSERT for new people (never path / created_by / updated_by / legacy_id),
       UPDATE that sends only the fields that actually changed
     * a chosen photo is scaled to 800 px wide and limited to 3 MB before upload
     * every string goes through I18n, and the whole dialog works in RTL

   It talks to app.js through window.FT (see the bottom of js/app.js).
   ===================================================================== */

(function () {
  'use strict';

  const T = (key, params) => (params ? I18n.fmt(key, params) : I18n.t(key));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FT = () => window.FT || {};

  /* ------------------------------- fields ------------------------------- */
  // Every column an editor or admin may write. This is also the whitelist: nothing
  // outside this list is ever sent to the database.
  const SECTIONS = [
    {
      key: 'names', title: 'edit.section.names', fields: [
        { col: 'full_name', key: 'edit.fullName', type: 'text', required: true },
        { col: 'nick_name', key: 'edit.nickname' },
        { col: 'name_ur', key: 'edit.nameUr', dir: 'rtl' },
        { col: 'name_hi', key: 'edit.nameHi' },
        { col: 'gender', key: 'edit.gender', type: 'select', required: true }
      ]
    },
    {
      key: 'parents', title: 'edit.section.parents', fields: [
        { col: 'fathers_name', key: 'edit.father' },
        { col: 'mothers_name', key: 'edit.mother' }
      ]
    },
    {
      key: 'spouse', title: 'edit.section.spouse', fields: [
        { col: 'spouse_name', key: 'edit.spouse' },
        { col: 'spouse_father_name', key: 'edit.spouseFather' }
      ]
    },
    {
      key: 'life', title: 'edit.section.life', fields: [
        { col: 'dob', key: 'edit.dob', type: 'date', hint: 'edit.dobHint' },
        { col: 'dob_text', key: 'edit.dobText', hint: 'edit.orType' },
        { col: 'place_of_birth', key: 'edit.pob' },
        { col: 'qualification', key: 'edit.qual' },
        { col: 'dod', key: 'edit.dod', type: 'date' },
        { col: 'dod_text', key: 'edit.dodText', hint: 'edit.orType' },
        { col: 'place_of_burial', key: 'edit.burial' }
      ]
    },
    {
      key: 'notes', title: 'edit.section.photo', fields: [
        { col: 'notes', key: 'edit.notes', type: 'textarea' }
      ]
    }
  ];
  const ALL_FIELDS = SECTIONS.reduce((a, s) => a.concat(s.fields), []);
  const COL_BY_FIELD = {};
  ALL_FIELDS.forEach(f => { COL_BY_FIELD[f.col] = f; });

  // The tree model built in js/app.js uses short field names (name, nick, father, pob,
  // qual, burial) while the database columns — and therefore this form — use full_name,
  // nick_name, fathers_name, place_of_birth, qualification, place_of_burial. Translate on
  // the way in; without it the dialog opened with those boxes empty and a save could
  // have written the blanks back over the family's data.
  const MODEL_KEY = {
    full_name: 'name',
    nick_name: 'nick',
    fathers_name: 'father',
    mothers_name: 'mother',
    spouse_name: 'spouse',
    spouse_father_name: 'spouseFather',
    place_of_birth: 'pob',
    qualification: 'qual',
    place_of_burial: 'burial',
    // A date input only accepts YYYY-MM-DD; dob/dod in the model are display-formatted.
    dob: 'dob_iso',
    dod: 'dod_iso'
  };

  // Anything the parseDate() in app.js understands -> YYYY-MM-DD, or ''.
  function isoOrEmpty(v) {
    if (!v) return '';
    const d = FT().parseDate ? FT().parseDate(v) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
  }

  // People row -> the values the form edits.
  function valuesFromPerson(p) {
    const v = {};
    ALL_FIELDS.forEach(f => {
      const key = MODEL_KEY[f.col] || f.col;
      let raw = p ? (p[key] != null && p[key] !== '' ? p[key] : p[f.col]) : '';
      if (f.type === 'date') raw = isoOrEmpty(raw);
      v[f.col] = raw == null ? '' : String(raw);
    });
    if (v.gender !== 'Male' && v.gender !== 'Female') v.gender = '';
    return v;
  }

  // Defaults for a new child: the parent's own name and their spouse fill in the

  // Defaults for a new spouse: the owner (person being edited) fills in spouse_name,\n  // and the spouse field stays editable.\n  function valuesForNewSpouse(owner) {\n    const v = valuesFromPerson(null);\n    v.spouse_name = owner.name || "";\n    return v;\n  }
  // father/mother boxes, and stay editable.
  function valuesForNewChild(parent) {
    const v = valuesFromPerson(null);
    const male = /^m/i.test(parent.gender || '');
    const female = /^f/i.test(parent.gender || '');
    if (male) {
      v.fathers_name = parent.name || '';
      v.mothers_name = parent.spouse || '';
    } else if (female) {
      v.mothers_name = parent.name || '';
      v.fathers_name = parent.spouse || '';
    } else {
      v.fathers_name = parent.spouse ? '' : (parent.name || '');
      v.mothers_name = parent.spouse || '';
    }
    return v;
  }

  /* -------------------------------- state -------------------------------- */
  let state = null;      // { mode, person, parent, values, file, prepared, saving, parentId }
  let overlay = null;

  const DIALOG_TITLE = {
    edit: 'panel.editTitle',
    addchild: 'panel.addChildTitle',
    addspouse: 'panel.addSpouseTitle',
    addroot: 'panel.addRootTitle'
  };
  const DIALOG_SUB = {
    edit: 'panel.editSub',
    addchild: 'panel.addChildSub',
    addspouse: 'panel.addSpouseSub',
    addroot: 'panel.addRootSub'
  };

  function isOpen() { return !!overlay; }

  function open(opts) {
    const mode = opts.mode || 'edit';
    const person = opts.person || null;
    const parent = opts.parent || null;
    const values = mode === 'edit' ? valuesFromPerson(person)
      : mode === 'addchild' ? valuesForNewChild(parent)
        : valuesFromPerson(null);
    state = {
      mode: mode,
      person: person,
      spouseOwner: mode === 'addspouse' ? (person || null) : null,
      parent: parent,
      values: values,
      original: mode === 'edit' ? Object.assign({}, values) : {},
      // Baseline for the unsaved-changes guard: what the dialog opened with.
      _start: Object.assign({}, values),
      file: null,
      prepared: null,
      // Set when the person already has a photo and the user asks for it to go away.
      // The object in Storage is only deleted once the row has been saved.
      removePhoto: false,
      saving: false,
      parentId: mode === 'addchild' ? (parent ? parent.id : null)
        : mode === 'edit' ? (person ? person.parentId : null)
          : null,
      parentLabel: ''
    };
    state.parentLabel = labelForPersonId(state.parentId);
    render();
  }

  // TRUE when the dialog holds anything the user could lose. In edit mode the
  // original values are the baseline; in create modes the values prefilled by the
  // opener are. A picked photo or a pending photo-removal also counts.
  function isDirty() {
    if (!state) return false;
    if (state.file || state.prepared || state.removePhoto) return true;
    const baseline = state.mode === 'edit' && state.original ? state.original : (state._start || {});
    return ALL_FIELDS.some(f =>
      String(state.values[f.col] == null ? '' : state.values[f.col]) !==
      String(baseline[f.col] == null ? '' : baseline[f.col]));
  }

  // Every close path (the X button, Cancel, Esc, a backdrop tap) funnels into this:
  // an untouched dialog closes quietly, a dirty one asks before discarding, and
  // Cancel keeps it open exactly as the user left it. A save in flight is never
  function requestClose() {
    if (!state) { close(); return; }
    if (state.saving) return;                  // never interrupt an in-flight save
    if (!isDirty()) { close(); return; }       // nothing to lose: close quietly
    if (window.confirm(T('edit.unsavedConfirm'))) close();
  }

  function close() {
    releasePreview();
    if (overlay) { overlay.remove(); overlay = null; }
    state = null;
    window.removeEventListener('keydown', onKeydown, true);
    document.documentElement.classList.remove('modal-open');
  }

  function releasePreview() {
    const img = overlay && overlay.querySelector('[data-pp-preview]');
    if (img && img.dataset.url) { URL.revokeObjectURL(img.dataset.url); delete img.dataset.url; }
  }

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (state && state.saving) return;
    requestClose();
  }

  /* ------------------------------ rendering ------------------------------ */
  // "Name — Gen 3 — parent: X" so two people with the same name stay tellable apart.
  function personOptionLabel(p) {
    // Language-aware: shows the Urdu/Hindi spelling when that language is active.
    const bits = [(FT().dispName ? FT().dispName(p) : p.name)];
    if (p.nick) bits.push('“' + p.nick + '”');
    bits.push(T('chip.gen', { g: p.gen }));
    if (p.parent) bits.push('— ' + (FT().dispName ? FT().dispName(p.parent) : p.parent.name));
    return bits.join(' · ');
  }
  function labelForPersonId(id) {
    if (!id) return '';
    const p = FT().personById ? FT().personById(id) : null;
    return p ? personOptionLabel(p) : '';
  }

  function fieldHtml(f) {
    const id = 'pf_' + f.col;
    const val = state.values[f.col] == null ? '' : String(state.values[f.col]);
    const req = f.required ? ' <span class="edit-req">*</span>' : '';
    const hint = f.hint ? '<div class="edit-hint">' + esc(T(f.hint)) + '</div>' : '';
    const dir = f.dir ? ' dir="' + f.dir + '"' : '';
    let input;
    if (f.type === 'select') {
      input = '<select class="edit-input" id="' + id + '"' + (f.required ? ' required' : '') + '>' +
        '<option value="">' + esc(T('edit.genderPick')) + '</option>' +
        '<option value="Male"' + (val === 'Male' ? ' selected' : '') + '>' + esc(T('chip.male')) + '</option>' +
        '<option value="Female"' + (val === 'Female' ? ' selected' : '') + '>' + esc(T('chip.female')) + '</option>' +
        '</select>';
    } else if (f.type === 'textarea') {
      input = '<textarea class="edit-input" id="' + id + '" rows="3" placeholder="' + esc(T('edit.textareaPlaceholder')) + '"' + dir + '>' + esc(val) + '</textarea>';
    } else {
      input = '<input class="edit-input" id="' + id + '" type="' + (f.type === 'date' ? 'date' : 'text') + '" value="' + esc(val) + '"' + dir +
        (f.type === 'date' ? ' placeholder="YYYY-MM-DD"' : '') + (f.required ? ' required' : '') + '>';
    }
    return '<div class="edit-field" data-field="' + f.col + '">' +
      '<label class="edit-label" for="' + id + '">' + esc(T(f.key)) + req + '</label>' +
      input + hint +
      '<div class="edit-error" data-error-for="' + f.col + '" hidden></div>' +
      '</div>';
  }

  function parentBlockHtml() {
    const admin = FT().isAdmin && FT().isAdmin();
    if (state.mode === 'addspouse') {
      // The spouse record is a top-level person; the partnership is expressed through
      // spouse_name (filled on save). Show WHO they are being married to, fixed.
      const owner = state.spouseOwner;
      const label = owner ? (FT().dispName ? FT().dispName(owner) : owner.name) : '';
      return '<div class="edit-field" data-field="parent">' +
        '<label class="edit-label">' + esc(T('edit.marriedTo')) + '</label>' +
        '<input class="edit-input" type="text" value="' + esc(label) + '" readonly>' +
        '<div class="edit-hint">' + esc(T('edit.marriedToHint', { name: label })) + '</div>' +
        '</div>';
    }
    if (state.mode === 'addchild') {
      return '<div class="edit-field" data-field="parent">' +
        '<label class="edit-label">' + esc(T('edit.parentField')) + '</label>' +
        '<input class="edit-input" type="text" value="' + esc(state.parent ? (FT().dispName ? FT().dispName(state.parent) : state.parent.name) : '') + '" readonly>' +
        '<div class="edit-hint">' + esc(T('edit.parentFixed', { name: state.parent ? (FT().dispName ? FT().dispName(state.parent) : state.parent.name) : '' })) + '</div>' +
        '</div>';
    }
    if (state.mode === 'addroot') {
      return '<div class="edit-field" data-field="parent">' +
        '<label class="edit-label">' + esc(T('edit.parentField')) + '</label>' +
        '<input class="edit-input" type="text" value="' + esc(T('edit.parentNone')) + '" readonly>' +
        '</div>';
    }
    // edit
    if (!admin) {
      return '<div class="edit-field" data-field="parent">' +
        '<label class="edit-label">' + esc(T('edit.parentField')) + '</label>' +
        '<input class="edit-input" type="text" value="' + esc(state.person.parent ? (FT().dispName ? FT().dispName(state.person.parent) : state.person.parent.name) : '') + '" readonly>' +
        '<div class="edit-hint">' + esc(T('edit.parentAdminOnly')) + '</div>' +
        '</div>';
    }
    const people = (FT().people ? FT().people() : []).filter(p => p.id !== state.person.id);
    const list = people.map(p => '<option value="' + esc(personOptionLabel(p)) + '"></option>').join('');
    return '<div class="edit-field" data-field="parent">' +
      '<label class="edit-label" for="pf_parent">' + esc(T('edit.parentField')) + '</label>' +
      '<input class="edit-input" id="pf_parent" type="text" list="pf_parent_list" autocomplete="off" value="' + esc(state.parentLabel) + '" placeholder="' + esc(T('edit.parentNone')) + '">' +
      '<datalist id="pf_parent_list">' + list + '</datalist>' +
      '<div class="edit-hint">' + esc(T('edit.parentAdminOnly')) + '</div>' +
      '<div class="edit-error" data-error-for="parent" hidden></div>' +
      '</div>';
  }

  function photoBlockHtml() {
    const has = !!(state.person && state.person.photo_path);
    return '<div class="edit-field" data-field="photo">' +
      '<label class="edit-label">' + esc(T('edit.photoChoose')) + '</label>' +
      '<div class="photo-row">' +
      '<div class="photo-thumb" data-pp-thumb><span class="photo-thumb-empty">' + esc(T('edit.photoNone')) + '</span></div>' +
      '<div class="photo-row-actions">' +
      '<button type="button" class="btn sm" id="pp_choose">' + esc(T('edit.photoChoose')) + '</button>' +
      '<button type="button" class="btn sm ghost" id="pp_clear" hidden>' + esc(T('edit.photoRemove')) + '</button>' +
      '<div class="edit-hint">' + esc(T('edit.photoHint')) + '</div>' +
      '<div class="edit-hint" data-pp-name>' + (has ? esc(T('edit.photoSavesWith')) : '') + '</div>' +
      '</div></div>' +
      '<input type="file" id="pp_file" accept="image/jpeg,image/png,image/webp" hidden>' +
      '</div>';
  }

  function render() {
    // Drop any dialog that is already on screen — but not through close(), which also
    // clears `state`; this function is about to read `state.mode`.
    releasePreview();
    if (overlay) { overlay.remove(); overlay = null; }
    const mode = state.mode;
    const titleKey = DIALOG_TITLE[mode];
    const ownerLabel = name => (FT().dispName ? FT().dispName(name) : name.name);
    const focusName = mode === 'addspouse' ? (state.spouseOwner ? ownerLabel(state.spouseOwner) : '')
      : mode === 'edit' ? (state.person ? ownerLabel(state.person) : '')
        : (state.parent ? ownerLabel(state.parent) : '');
    const title = T(titleKey, { name: focusName });
    const sub = mode === 'edit'
      ? T(DIALOG_SUB[mode], { gen: state.person.gen, gender: FT().genderLabel ? FT().genderLabel(state.person.gender) : '' })
      : T(DIALOG_SUB[mode]);

    const body = SECTIONS.map(sec =>
      '<fieldset class="edit-section"><legend>' + esc(T(sec.title)) + '</legend>' +
      (sec.key === 'parents' ? parentBlockHtml() : '') +
      sec.fields.map(fieldHtml).join('') +
      (sec.key === 'notes' ? photoBlockHtml() : '') +
      '</fieldset>').join('');

    overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.id = 'personModal';
    overlay.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="pf_title">' +
      '<div class="modal-head">' +
      '<div><h3 id="pf_title">' + esc(title) + '</h3><p class="modal-sub">' + esc(sub) + '</p></div>' +
      '<button type="button" class="icon-btn" id="pf_close" aria-label="' + esc(T('panel.close')) + '">✕</button>' +
      '</div>' +
      '<form id="pf_form" class="edit-form modal-body" novalidate>' + body + '</form>' +
      '<div class="modal-foot">' +
      '<button type="button" class="btn" id="pf_cancel">' + esc(T('panel.cancel')) + '</button>' +
      '<button type="submit" form="pf_form" class="btn primary" id="pf_save">' +
      esc(mode === 'edit' ? T('panel.save') : (mode === 'addroot' ? T('panel.addRoot') : (mode === 'addspouse' ? T('panel.addSpouseGo') : T('panel.addGo')))) +
      '</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.documentElement.classList.add('modal-open');

    overlay.querySelector('#pf_close').onclick = requestClose;
    overlay.querySelector('#pf_cancel').onclick = requestClose;
    overlay.addEventListener('mousedown', e => { if (e.target === overlay && !state.saving) requestClose(); });
    window.addEventListener('keydown', onKeydown, true);
    const form = overlay.querySelector('#pf_form');
    form.addEventListener('submit', e => { e.preventDefault(); save(); });
    // state.values is what validate() and save() read, so every keystroke has to land
    // there. Without this the dialog would save the values it opened with and silently
    // discard everything the person typed.
    form.addEventListener('input', collect);
    form.addEventListener('change', collect);

    const parentInput = overlay.querySelector('#pf_parent');
    if (parentInput) {
      parentInput.addEventListener('input', () => {
        const txt = parentInput.value.trim();
        if (!txt) { state.parentId = null; state.parentLabel = ''; return; }
        const hit = (FT().people ? FT().people() : []).find(p => personOptionLabel(p) === txt && p.id !== state.person.id);
        if (hit) { state.parentId = hit.id; state.parentLabel = txt; }
      });
      parentInput.addEventListener('blur', () => {
        const txt = parentInput.value.trim();
        if (txt && !state.parentId) {
          // The typed text is not one of the offered people — refuse to guess.
          setError('parent', T('admin.pickPerson'));
          parentInput.value = state.parentLabel;
        } else {
          setError('parent', '');
        }
      });
    }

    const choose = overlay.querySelector('#pp_choose');
    const fileInput = overlay.querySelector('#pp_file');
    choose.onclick = () => fileInput.click();
    fileInput.onchange = () => onPickFile(fileInput.files && fileInput.files[0]);
    const clear = overlay.querySelector('#pp_clear');
    clear.onclick = () => {
      state.file = null;
      state.prepared = null;
      // An existing photo is not discarded by forgetting it here: the row still points
      // at it, so remember the request and delete it when the form is saved.
      state.removePhoto = !!(state.person && state.person.photo_path);
      releasePreview();
      paintPhoto();
    };
    if (state.person && state.person.photo_path) paintExistingPhoto();
    // An existing photo has to be removable as well, not only a freshly picked file.
    if (clear && state.person && state.person.photo_path && !state.removePhoto) clear.hidden = false;

    const first = overlay.querySelector('#pf_full_name');
    if (first) setTimeout(() => first.focus(), 0);
  }

  // Read what is on screen into state.values (by column name, the vocabulary the
  // database uses).
  function collect() {
    if (!overlay || !state) return;
    ALL_FIELDS.forEach(f => {
      const input = overlay.querySelector('#pf_' + f.col);
      if (!input) return;
      state.values[f.col] = input.type === 'checkbox' ? input.checked : input.value;
    });
  }

  // Escape a value that may be null/empty.
  function isBlank(v) { return v == null || String(v).trim() === ''; }

  function setError(col, msg) {
    const box = overlay.querySelector('[data-error-for="' + col + '"]');
    const input = overlay.querySelector('#pf_' + col) || overlay.querySelector('#pf_parent');
    if (box) { box.hidden = !msg; box.textContent = msg || ''; }
    if (input) {
      if (msg) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  /* -------------------------------- photo -------------------------------- */
  function onPickFile(file) {
    if (!file) return;
    state.removePhoto = false;
    if (!window.Photos) { FT().toast(T('photos.notConnected')); return; }
    const v = Photos.validate(file);
    if (!v.ok) {
      FT().toast(v.error === 'photos.errSize'
        ? T('edit.photoTooBig', { mb: (file.size / (1024 * 1024)).toFixed(1) })
        : T('edit.photoBadType'));
      return;
    }
    state.file = file;
    state.prepared = null;
    releasePreview();
    paintPhoto();
  }

  function paintPhoto() {
    if (!overlay) return;
    const thumb = overlay.querySelector('[data-pp-thumb]');
    const clear = overlay.querySelector('#pp_clear');
    const nameBox = overlay.querySelector('[data-pp-name]');
    if (!thumb) return;
    if (state.file) {
      const url = URL.createObjectURL(state.file);
      thumb.innerHTML = '<img data-pp-preview alt="" src="' + url + '">';
      thumb.querySelector('img').dataset.url = url;
      if (clear) clear.hidden = false;
      if (nameBox) nameBox.textContent = T('edit.photoSelected', { name: state.file.name });
    } else {
      thumb.innerHTML = '<span class="photo-thumb-empty">' + esc(T('edit.photoNone')) + '</span>';
      // Still offer the button while a stored photo is waiting to be deleted on save.
      const hasStored = !!(state.person && state.person.photo_path && !state.removePhoto);
      if (clear) clear.hidden = !hasStored;
      if (nameBox) nameBox.textContent = hasStored ? T('edit.photoSavesWith') : '';
    }
  }

  async function paintExistingPhoto() {
    if (!overlay || !state.person || !state.person.photo_path || !window.Photos) return;
    const thumb = overlay.querySelector('[data-pp-thumb]');
    if (!thumb) return;
    try {
      const url = await Photos.signedUrl(state.person.photo_path);
      if (!url || !overlay || !overlay.contains(thumb)) return;
      thumb.innerHTML = '<img data-pp-preview alt="" src="' + esc(url) + '">';
    } catch (e) { /* the photo is optional — showing initials is fine */ }
  }

  /* ------------------------------ validation ------------------------------ */
  function today() {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  function validate() {
    let firstBad = null;
    const bad = (col, msg) => { setError(col, msg); if (!firstBad) firstBad = col; };
    ALL_FIELDS.forEach(f => setError(f.col, ''));

    const v = state.values;
    if (isBlank(v.full_name)) bad('full_name', T('edit.fullNameRequired'));
    if (v.gender !== 'Male' && v.gender !== 'Female') bad('gender', T('edit.genderRequired'));

    const dob = v.dob ? FT().parseDate(v.dob) : null;
    const dod = v.dod ? FT().parseDate(v.dod) : null;
    if (v.dob && !dob) bad('dob', T('edit.invalidDate', { field: T('edit.dob') }));
    if (v.dod && !dod) bad('dod', T('edit.invalidDate', { field: T('edit.dod') }));
    const now = today();
    if (dob && dob.getTime() > now.getTime()) bad('dob', T('edit.dobFuture'));
    if (dod && dod.getTime() > now.getTime()) bad('dod', T('edit.dodFuture'));
    if (dob && dod && dod.getTime() < dob.getTime()) bad('dod', T('edit.dodBeforeDob'));

    if (firstBad) {
      const box = overlay.querySelector('[data-error-for="' + firstBad + '"]');
      if (box) box.scrollIntoView({ block: 'center' });
      FT().toast(T('edit.fixFields'));
      return null;
    }

    const payload = {};
    ALL_FIELDS.forEach(f => {
      const raw = state.values[f.col];
      if (f.col === 'dob' || f.col === 'dod') {
        const d = raw ? FT().parseDate(raw) : null;
        payload[f.col] = d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
      } else if (f.col === 'gender') {
        payload[f.col] = raw;
      } else {
        payload[f.col] = isBlank(raw) ? null : String(raw);
      }
    });
    return payload;
  }

  // Warn (never block) when the same name already exists under the same parent.
  function duplicateOf(payload) {
    const name = String(payload.full_name || '').trim().toLowerCase();
    if (!name) return null;
    // addspouse creates a top-level person (no parent), so compare by name alone —
    // spouses married in from other families rarely share a parent.
    const parentId = state.mode === 'addspouse' ? null : (state.mode === 'addchild' ? state.parentId : state.parentId);
    return (FT().people ? FT().people() : []).find(p =>
      p.id !== (state.person && state.person.id) &&
      String(p.name || '').trim().toLowerCase() === name &&
      (p.parentId || null) === (parentId || null)) || null;
  }

  /* --------------------------------- save --------------------------------- */
  async function save() {
    if (!state || state.saving) return;
    collect();
    const payload = validate();
    if (!payload) return;

    const dup = duplicateOf(payload);
    if (dup && !window.confirm(T('edit.dupWarn', { name: FT().dispName ? FT().dispName(dup) : dup.name }))) return;

    const client = FT().client && FT().client();
    if (!client) { FT().toast(T('save.notConnected')); return; }

    const isEdit = state.mode === 'edit';
    const btn = overlay.querySelector('#pf_save');
    state.saving = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = isEdit ? T('edit.saving') : T('edit.adding');
    }
    try {
      let person;
      if (isEdit) {
        // Only the fields that actually changed are sent.
        const changed = {};
        Object.keys(payload).forEach(k => {
          const before = state.original[k] == null ? '' : String(state.original[k]);
          const after = payload[k] == null ? '' : String(payload[k]);
          if (before !== after) changed[k] = payload[k];
        });
        // Moving a person is admin-only (the database refuses it for editors too, but
        // sending it only for admins keeps the failed request out of the way entirely).
        const wantParent = state.parentId || null;
        const hadParent = state.person.parentId || null;
        if (FT().isAdmin && FT().isAdmin() && wantParent !== hadParent) changed.parent_id = wantParent;
        // Deleting the photo counts as a change even when no text field moved.
        if (!Object.keys(changed).length && !state.file && !state.removePhoto) {
          close();
          FT().toast(T('save.changesSaved'));
          return;
        }
        if (Object.keys(changed).length) {
          const { error } = await client.from('people').update(changed).eq('id', state.person.id);
          if (error) throw error;
        }
        person = FT().personById(state.person.id);
      } else {
        // INSERT: parent_id (only addchild has one) + whitelisted columns.
        const insert = Object.assign({}, payload);
        insert.parent_id = state.parentId || null;
        // Addspouse: the new row itself points back at the partner, so both sides
        // of the marriage carry each other as spouse_name from day one.
        if (state.mode === 'addspouse' && state.spouseOwner) {
          insert.spouse_name = (FT().dispName ? FT().dispName(state.spouseOwner) : state.spouseOwner.name) || state.spouseOwner.name;
        }
        const { data, error } = await client.from('people').insert(insert).select('*').single();
        if (error) throw error;
        person = { id: data.id, name: data.full_name, photo_path: data.photo_path || null };
        // Addspouse: link BOTH sides. The new row gets the owner as spouse_name; the
        // owner's spouse_name is only patched when it pointed at the new spouse's name
        // exactly (that is the flow that created this request — a virtual spouse panel
        // or branch tile), never silently over a DIFFERENT existing spouse.
        if (state.mode === 'addspouse' && state.spouseOwner) {
          // Patch the OWNER's side too — only when it does not already name somebody
          // else (never overwrite an existing different partner silently).
          const owner = state.spouseOwner;
          const newSpouseName = insert.spouse_name || payload.full_name;
          if (!owner.spouse || owner.spouse.trim() === '' || owner.spouse === newSpouseName) {
            const { error: linkErr } = await client.from('people')
              .update({ spouse_name: owner.spouse === newSpouseName ? owner.spouse : newSpouseName })
              .eq('id', owner.id);
            if (linkErr) console.warn('Could not link the spouse back to the owner:', linkErr.message);
          }
        }
      }

      // A photo the user asked to remove goes first: the row stops pointing at it, and
      // only then is the object deleted (Photos.remove does both, in that order).
      if (isEdit && state.removePhoto && state.person.photo_path && window.Photos) {
        try { await Photos.remove(state.person.id, state.person.photo_path); } catch (e) {
          FT().toast(T('photos.errFailed', { msg: (e && e.message) || String(e) }));
        }
      }
      // Photo last, so a failed upload cannot leave an orphan object for a person
      // that was never created.
      if (state.file && person && person.id) {
        const prepared = await Photos.prepareFile(state.file) || null;
        const key = await Photos.upload(person.id, prepared || state.file, (person.photo_path || null));
        if (person.photo_path && person.photo_path !== key) Photos.invalidate(person.photo_path);
        Photos.invalidate(key);
      }

      const newId = person ? person.id : (state.person && state.person.id);
      const newName = (payload.full_name || '').trim();
      close();
      if (FT().refreshAndSelect) await FT().refreshAndSelect(newId);
      FT().toast(isEdit ? T('save.changesSaved') : T('save.added', { name: newName }));
    } catch (err) {
      const msg = (err && err.message) || String(err);
      const friendly = /row-level security|permission|not allowed|forbids|violates|unauthoriz|403/i.test(msg)
        ? T('save.permError')
        : /Only an admin can move a person/.test(msg)
          ? T('save.moveError')
          : /duplicate key|legacy_id/.test(msg)
            ? T('save.foreignKeyError')
            : isEdit ? T('save.saveFailed', { msg: msg }) : T('save.addFailed', { msg: msg });
      FT().toast(friendly);
      if (state && btn) {
        state.saving = false;
        btn.disabled = false;
        btn.textContent = isEdit ? T('panel.save') : (state.mode === 'addroot' ? T('panel.addRoot') : T('panel.addGo'));
      }
    }
  }

  // Live-updating a form is never a good idea; app.js asks this before reloading.
  window.addEventListener('ft:beforeReload', e => { if (isOpen()) e.preventDefault(); });

  window.PersonForm = { open: open, close: close, isOpen: isOpen };
})();
