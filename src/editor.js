import { getFamilyData, setFamilyData, refreshViewer, normalizeData, getRelationshipLabels, getAvatarUrl, setAvatarUrl, removeAvatarUrl } from './viewer.js';
import { confirmModal, showToast } from './ui.js';
import { proposeChanges } from './propose.js';
import { cacheGet, cacheSet, cacheRemove } from './storage.js';
import { saveAvatar, getAvatar, removeAvatar as removeAvatarIDB } from './avatar-store.js';

const MAX_AVATAR_SIZE = 1 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg'];

let editingPersonId = null;

export function initEditor() {
  document.getElementById('editModeBtn').addEventListener('click', enterEditMode);
  document.getElementById('viewModeBtn').addEventListener('click', exitEditMode);
  document.getElementById('addPersonBtn').addEventListener('click', showAddForm);
  document.getElementById('cancelEditBtn').addEventListener('click', hideForm);
  document.getElementById('personForm').addEventListener('submit', handleSave);
  document.getElementById('deletePersonBtn').addEventListener('click', handleDelete);
  document.getElementById('exportBtn').addEventListener('click', exportJson);
  document.getElementById('proposeBtn').addEventListener('click', proposeChanges);
  document.getElementById('qualityBtn').addEventListener('click', toggleQualityPanel);
  document.getElementById('closeQualityBtn').addEventListener('click', () => {
    document.getElementById('qualityPanel').style.display = 'none';
  });

  document.getElementById('avatarInput').addEventListener('change', handleAvatarUpload);
  document.getElementById('removeAvatarBtn').addEventListener('click', handleAvatarRemove);

  document.addEventListener('principal-changed', () => {
    if (document.getElementById('editorPanel').style.display === 'block') {
      renderPersonList();
      if (document.getElementById('personForm').style.display === 'block') {
        populateRelationshipSelects();
        if (editingPersonId) restoreCheckedRels();
      }
      if (document.getElementById('qualityPanel').style.display === 'block') {
        renderQualityPanel();
      }
    }
  });
}

function enterEditMode() {
  document.getElementById('editorPanel').style.display = 'block';
  document.getElementById('editModeBtn').style.display = 'none';
  document.getElementById('viewModeBtn').style.display = 'inline-block';
  document.getElementById('exportBtn').style.display = 'inline-block';
  document.getElementById('proposeBtn').style.display = (cacheGet('family-tree-data') || cacheGet('family-tree-kinship')) && !cacheGet('family-tree-proposed') ? 'inline-block' : 'none';
  document.getElementById('toggleViewBtn').style.display = 'none';
  renderPersonList();
}

function exitEditMode() {
  document.getElementById('editorPanel').style.display = 'none';
  document.getElementById('qualityPanel').style.display = 'none';
  document.getElementById('editModeBtn').style.display = 'inline-block';
  document.getElementById('viewModeBtn').style.display = 'none';
  document.getElementById('exportBtn').style.display = 'none';
  document.getElementById('proposeBtn').style.display = 'none';
  document.getElementById('principalSelector').style.display = 'flex';
  document.getElementById('toggleViewBtn').style.display = 'inline-block';
  hideForm();
  refreshViewer();
}

function renderPersonList() {
  const list = document.getElementById('personList');
  const data = getFamilyData();
  list.innerHTML = '<h3>All Family Members</h3>';

  const labels = getRelationshipLabels();
  data.forEach(person => {
    const item = document.createElement('div');
    item.className = 'person-list-item';
    const name = (person.data['first name'] || '') + (person.data['last name'] ? ' ' + person.data['last name'] : '');
    const rel = labels.get(person.id);
    const relHtml = rel ? ` <span class="person-list-rel">(${rel.te})</span>` : '';
    item.innerHTML = `
      <span class="person-list-name">${name}${relHtml}</span>
      <button class="btn btn-small btn-secondary" data-id="${person.id}">Edit</button>
    `;
    item.querySelector('button').addEventListener('click', () => showEditForm(person.id));
    list.appendChild(item);
  });
}

function showAddForm() {
  editingPersonId = null;
  document.getElementById('personForm').style.display = 'block';
  document.getElementById('personList').style.display = 'none';
  document.getElementById('deletePersonBtn').style.display = 'none';
  clearForm();
  renderAvatarPreview(null);
  populateRelationshipSelects();
  document.getElementById('editorPanel').scrollTo({ top: 0, behavior: 'smooth' });
}

function showEditForm(personId) {
  const data = getFamilyData();
  const person = data.find(p => p.id === personId);
  if (!person) return;

  editingPersonId = personId;
  const form = document.getElementById('personForm');
  form.style.display = 'block';
  document.getElementById('personList').style.display = 'none';
  document.getElementById('deletePersonBtn').style.display = 'inline-block';
  document.getElementById('editorPanel').scrollTo({ top: 0, behavior: 'smooth' });

  document.getElementById('personId').value = person.id;
  document.getElementById('firstName').value = person.data['first name'] || '';
  document.getElementById('lastName').value = person.data['last name'] || '';
  document.getElementById('gender').value = person.data.gender || 'M';
  document.getElementById('birthday').value = person.data.birthday || '';

  renderAvatarPreview(person.data.avatar || null, person.data.gender);
  populateRelationshipSelects();

  (person.rels.parents || []).forEach(pid => {
    const cb = document.querySelector(`#parentPicker_${pid}`);
    if (cb) cb.checked = true;
  });

  (person.rels.spouses || []).forEach(sid => {
    const cb = document.querySelector(`#spousePicker_${sid}`);
    if (cb) cb.checked = true;
  });

  (person.rels.children || []).forEach(cid => {
    const cb = document.querySelector(`#childrenPicker_${cid}`);
    if (cb) cb.checked = true;
  });
}

function populateRelationshipSelects() {
  const data = getFamilyData();
  const labels = getRelationshipLabels();
  const pickers = ['parentPicker', 'spousePicker', 'childrenPicker'];

  for (const pickerId of pickers) {
    const picker = document.getElementById(pickerId);
    const list = picker.querySelector('.rel-picker-list');
    const searchInput = picker.querySelector('.rel-picker-search');
    list.innerHTML = '';

    data.forEach(person => {
      if (person.id === editingPersonId) return;
      const name = (person.data['first name'] || '') + (person.data['last name'] ? ' ' + person.data['last name'] : '');
      const rel = labels.get(person.id);

      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = person.id;
      cb.id = `${pickerId}_${person.id}`;

      const lbl = document.createElement('span');
      lbl.innerHTML = rel ? `${name} <span class="rel-picker-kinship">(${rel.te})</span>` : name;

      li.appendChild(cb);
      li.appendChild(lbl);
      li.addEventListener('click', (e) => {
        if (e.target !== cb) cb.checked = !cb.checked;
      });
      list.appendChild(li);
    });

    searchInput.value = '';
    searchInput.oninput = () => {
      const q = searchInput.value.toLowerCase().trim();
      list.querySelectorAll('li').forEach(li => {
        const name = li.querySelector('span').textContent.toLowerCase();
        li.classList.toggle('hidden', q && !name.includes(q));
      });
    };
  }
}

function hideForm() {
  document.getElementById('personForm').style.display = 'none';
  document.getElementById('personList').style.display = '';
  editingPersonId = null;
  clearForm();
}

function renderAvatarPreview(avatarFilename, gender) {
  const preview = document.getElementById('avatarPreview');
  const removeBtn = document.getElementById('removeAvatarBtn');
  const src = avatarFilename ? getAvatarUrl(avatarFilename) : null;

  if (src) {
    preview.innerHTML = `<img src="${src}" alt="Avatar" />`;
    removeBtn.style.display = 'inline-block';
  } else {
    const color = gender === 'F' ? 'rgb(196, 138, 146)' : 'rgb(120, 159, 172)';
    preview.innerHTML = `<svg viewBox="0 0 64 64"><circle cx="32" cy="24" r="14" fill="${color}"/><ellipse cx="32" cy="56" rx="22" ry="16" fill="${color}"/></svg>`;
    removeBtn.style.display = 'none';
  }
}

async function handleAvatarUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    showToast('Only PNG and JPG files are allowed', 'error');
    e.target.value = '';
    return;
  }
  if (file.size > MAX_AVATAR_SIZE) {
    showToast('File must be under 1 MB', 'error');
    e.target.value = '';
    return;
  }

  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const personId = editingPersonId || document.getElementById('personId').value || '_new';
  const filename = `${personId}.${ext}`;

  const buffer = await file.arrayBuffer();
  await saveAvatar(filename, buffer);

  const blobUrl = URL.createObjectURL(new Blob([buffer], { type: file.type }));
  setAvatarUrl(filename, blobUrl);

  const data = getFamilyData();
  if (editingPersonId) {
    const person = data.find(p => p.id === editingPersonId);
    if (person) {
      const oldAvatar = person.data.avatar;
      if (oldAvatar && oldAvatar !== filename) {
        await removeAvatarIDB(oldAvatar);
        removeAvatarUrl(oldAvatar);
      }
      person.data.avatar = filename;
    }
  }

  renderAvatarPreview(filename);
  e.target.value = '';
}

async function handleAvatarRemove() {
  const data = getFamilyData();
  if (!editingPersonId) return;
  const person = data.find(p => p.id === editingPersonId);
  if (!person || !person.data.avatar) return;

  const filename = person.data.avatar;
  await removeAvatarIDB(filename);
  removeAvatarUrl(filename);
  person.data.avatar = '';
  renderAvatarPreview(null, person.data.gender);
}

function clearForm() {
  document.getElementById('personId').value = '';
  document.getElementById('firstName').value = '';
  document.getElementById('lastName').value = '';
  document.getElementById('gender').value = 'M';
  document.getElementById('birthday').value = '';
  document.getElementById('avatarInput').value = '';
  for (const id of ['parentPicker', 'spousePicker', 'childrenPicker']) {
    const picker = document.getElementById(id);
    picker.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    picker.querySelector('.rel-picker-search').value = '';
    picker.querySelectorAll('li').forEach(li => li.classList.remove('hidden'));
  }
}

function getCheckedIds(pickerId) {
  return Array.from(
    document.querySelectorAll(`#${pickerId} input[type="checkbox"]:checked`)
  ).map(cb => cb.value);
}

function restoreCheckedRels() {
  const person = getFamilyData().find(p => p.id === editingPersonId);
  if (!person) return;
  (person.rels.parents || []).forEach(pid => {
    const cb = document.querySelector(`#parentPicker_${pid}`);
    if (cb) cb.checked = true;
  });
  (person.rels.spouses || []).forEach(sid => {
    const cb = document.querySelector(`#spousePicker_${sid}`);
    if (cb) cb.checked = true;
  });
  (person.rels.children || []).forEach(cid => {
    const cb = document.querySelector(`#childrenPicker_${cid}`);
    if (cb) cb.checked = true;
  });
}

async function handleSave(e) {
  e.preventDefault();
  const data = getFamilyData();

  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const gender = document.getElementById('gender').value;
  const birthday = document.getElementById('birthday').value.trim();

  const selectedParents = getCheckedIds('parentPicker');
  const selectedSpouses = getCheckedIds('spousePicker');
  const selectedChildren = getCheckedIds('childrenPicker');

  if (editingPersonId) {
    const person = data.find(p => p.id === editingPersonId);
    if (!person) return;

    const oldParents = person.rels.parents || [];
    const oldSpouses = person.rels.spouses || [];
    const oldChildren = person.rels.children || [];

    person.data['first name'] = firstName;
    person.data['last name'] = lastName;
    person.data.gender = gender;
    person.data.birthday = birthday;
    person.rels.parents = selectedParents;
    person.rels.spouses = selectedSpouses;
    person.rels.children = selectedChildren;

    syncBidirectionalRels(data, editingPersonId, oldParents, selectedParents, oldSpouses, selectedSpouses, oldChildren, selectedChildren);
  } else {
    const newId = generateId(firstName, lastName);
    let avatar = '';

    const tempAvatar = getAvatarUrl('_new.png') ? '_new.png' : getAvatarUrl('_new.jpg') ? '_new.jpg' : null;
    if (tempAvatar) {
      const ext = tempAvatar.split('.').pop();
      const finalName = `${newId}.${ext}`;
      const buf = await getAvatar(tempAvatar);
      if (buf) {
        await saveAvatar(finalName, buf);
        await removeAvatarIDB(tempAvatar);
        const blobUrl = getAvatarUrl(tempAvatar);
        removeAvatarUrl(tempAvatar);
        if (blobUrl) setAvatarUrl(finalName, blobUrl);
        avatar = finalName;
      }
    }

    const newPerson = {
      id: newId,
      data: { 'first name': firstName, 'last name': lastName, gender, birthday, avatar },
      rels: { parents: selectedParents, spouses: selectedSpouses, children: selectedChildren },
    };
    data.push(newPerson);
    syncBidirectionalRels(data, newId, [], selectedParents, [], selectedSpouses, [], selectedChildren);
  }

  setFamilyData(data);
  saveToLocalStorage(data);
  hideForm();
  renderPersonList();
}

function syncBidirectionalRels(data, personId, oldParents, newParents, oldSpouses, newSpouses, oldChildren, newChildren) {
  // Remove person from old parents' children
  oldParents.forEach(pid => {
    const parent = data.find(p => p.id === pid);
    if (parent) {
      parent.rels.children = (parent.rels.children || []).filter(c => c !== personId);
    }
  });
  // Add person to new parents' children
  newParents.forEach(pid => {
    const parent = data.find(p => p.id === pid);
    if (parent && !(parent.rels.children || []).includes(personId)) {
      parent.rels.children = [...(parent.rels.children || []), personId];
    }
  });

  // Remove person from old spouses' spouses
  oldSpouses.forEach(sid => {
    const spouse = data.find(p => p.id === sid);
    if (spouse) {
      spouse.rels.spouses = (spouse.rels.spouses || []).filter(s => s !== personId);
    }
  });
  // Add person to new spouses' spouses
  newSpouses.forEach(sid => {
    const spouse = data.find(p => p.id === sid);
    if (spouse && !(spouse.rels.spouses || []).includes(personId)) {
      spouse.rels.spouses = [...(spouse.rels.spouses || []), personId];
    }
  });

  // Remove person from old children's parents
  oldChildren.forEach(cid => {
    const child = data.find(p => p.id === cid);
    if (child) {
      child.rels.parents = (child.rels.parents || []).filter(pid => pid !== personId);
    }
  });
  // Add person to new children's parents
  newChildren.forEach(cid => {
    const child = data.find(p => p.id === cid);
    if (child && !(child.rels.parents || []).includes(personId)) {
      child.rels.parents = [...(child.rels.parents || []), personId];
    }
  });
}

async function handleDelete() {
  if (!editingPersonId) return;
  const ok = await confirmModal('Delete person', 'Are you sure you want to delete this person? This cannot be undone.');
  if (!ok) return;

  let data = getFamilyData();
  const person = data.find(p => p.id === editingPersonId);
  if (!person) return;

  // Remove references from other people
  data.forEach(p => {
    p.rels.parents = (p.rels.parents || []).filter(id => id !== editingPersonId);
    p.rels.children = (p.rels.children || []).filter(id => id !== editingPersonId);
    p.rels.spouses = (p.rels.spouses || []).filter(id => id !== editingPersonId);
  });

  data = data.filter(p => p.id !== editingPersonId);
  setFamilyData(data);
  saveToLocalStorage(data);
  hideForm();
  renderPersonList();
}

function generateId(firstName, lastName) {
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const parts = [normalize(firstName)];
  if (lastName) parts.push(normalize(lastName));
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(36).slice(-1)).join('').padEnd(4, '0').slice(0, 4);
  return [...parts, suffix].join('_');
}

function cleanData(data) {
  const toAddIds = new Set(data.filter(d => d.to_add).map(d => d.id));
  const stripped = data
    .filter(p => !p.to_add)
    .map(p => ({
      id: p.id,
      data: { ...p.data },
      rels: {
        spouses: (p.rels.spouses || []).filter(id => !toAddIds.has(id)),
        parents: (p.rels.parents || []).filter(id => !toAddIds.has(id)),
        children: (p.rels.children || []).filter(id => !toAddIds.has(id)),
      },
    }));
  return normalizeData(stripped);
}

function saveToLocalStorage(data) {
  cacheSet('family-tree-data', JSON.stringify(cleanData(data)));
  cacheRemove('family-tree-proposed');
  const proposeBtn = document.getElementById('proposeBtn');
  if (proposeBtn && proposeBtn.style.display !== 'none' || document.getElementById('editorPanel').style.display === 'block') {
    proposeBtn.style.display = 'inline-block';
  }
}

function exportJson() {
  const data = cleanData(getFamilyData());
  const json = JSON.stringify(data, null, 2);
  const modal = document.getElementById('exportModal');
  const textarea = document.getElementById('exportJsonArea');
  const closeBtn = document.getElementById('exportCloseBtn');
  const cancelBtn = document.getElementById('exportCancelBtn');
  const copyBtn = document.getElementById('exportCopyBtn');
  const downloadBtn = document.getElementById('exportDownloadBtn');

  textarea.value = json;
  modal.style.display = 'flex';

  const close = () => { modal.style.display = 'none'; };

  closeBtn.onclick = close;
  cancelBtn.onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };

  copyBtn.onclick = () => {
    navigator.clipboard.writeText(json)
      .then(() => showToast('Copied to clipboard'))
      .catch(() => showToast('Failed to copy to clipboard', 'error'));
  };

  downloadBtn.onclick = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'family.json';
    a.click();
    URL.revokeObjectURL(url);
  };
}

const ALL_FIELDS = ['first name', 'last name', 'gender', 'birthday'];

function scanMissingAttributes() {
  const data = getFamilyData();
  const results = [];
  for (const person of data) {
    const missing = ALL_FIELDS.filter(f => !person.data[f] || !String(person.data[f]).trim());
    if (missing.length > 0) {
      const name = (person.data['first name'] || '').trim() + ' ' + (person.data['last name'] || '').trim();
      results.push({ id: person.id, name: name.trim() || person.id, missing });
    }
  }
  return results;
}

function renderQualityPanel() {
  const list = document.getElementById('qualityList');
  const issues = scanMissingAttributes();

  if (issues.length === 0) {
    list.innerHTML = '<p class="quality-summary">All members have complete data.</p>';
    return;
  }

  const labels = getRelationshipLabels();
  list.innerHTML = `<p class="quality-summary">${issues.length} member${issues.length > 1 ? 's' : ''} with missing data</p>`;
  for (const item of issues) {
    const rel = labels.get(item.id);
    const relHtml = rel ? ` <span class="person-list-rel">(${rel.te})</span>` : '';
    const row = document.createElement('div');
    row.className = 'quality-item';
    row.innerHTML = `
      <div>
        <div class="quality-item-name">${item.name}${relHtml}</div>
        <div class="quality-item-tags">
          ${item.missing.map(f => `<span class="quality-tag">${f}</span>`).join('')}
        </div>
      </div>`;
    row.addEventListener('click', () => showEditForm(item.id));
    list.appendChild(row);
  }
}

function toggleQualityPanel() {
  const panel = document.getElementById('qualityPanel');
  if (panel.style.display === 'none' || !panel.style.display) {
    renderQualityPanel();
    panel.style.display = 'block';
  } else {
    panel.style.display = 'none';
  }
}
