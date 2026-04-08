import { getFamilyData, setFamilyData, refreshViewer } from './viewer.js';
import { confirmModal, showToast } from './ui.js';

let editingPersonId = null;

export function initEditor() {
  document.getElementById('editModeBtn').addEventListener('click', enterEditMode);
  document.getElementById('viewModeBtn').addEventListener('click', exitEditMode);
  document.getElementById('addPersonBtn').addEventListener('click', showAddForm);
  document.getElementById('cancelEditBtn').addEventListener('click', hideForm);
  document.getElementById('personForm').addEventListener('submit', handleSave);
  document.getElementById('deletePersonBtn').addEventListener('click', handleDelete);
  document.getElementById('exportBtn').addEventListener('click', exportJson);
  document.getElementById('qualityBtn').addEventListener('click', toggleQualityPanel);
  document.getElementById('closeQualityBtn').addEventListener('click', () => {
    document.getElementById('qualityPanel').style.display = 'none';
  });
}

function enterEditMode() {
  document.getElementById('editorPanel').style.display = 'block';
  document.getElementById('editModeBtn').style.display = 'none';
  document.getElementById('viewModeBtn').style.display = 'inline-block';
  document.getElementById('exportBtn').style.display = 'inline-block';
  document.getElementById('principalSelector').style.display = 'none';
  document.getElementById('toggleViewBtn').style.display = 'none';
  renderPersonList();
}

function exitEditMode() {
  document.getElementById('editorPanel').style.display = 'none';
  document.getElementById('qualityPanel').style.display = 'none';
  document.getElementById('editModeBtn').style.display = 'inline-block';
  document.getElementById('viewModeBtn').style.display = 'none';
  document.getElementById('exportBtn').style.display = 'none';
  document.getElementById('principalSelector').style.display = 'flex';
  document.getElementById('toggleViewBtn').style.display = 'inline-block';
  hideForm();
  refreshViewer();
}

function renderPersonList() {
  const list = document.getElementById('personList');
  const data = getFamilyData();
  list.innerHTML = '<h3>All Family Members</h3>';

  data.forEach(person => {
    const item = document.createElement('div');
    item.className = 'person-list-item';
    const name = (person.data['first name'] || '') + (person.data['last name'] ? ' ' + person.data['last name'] : '');
    item.innerHTML = `
      <span class="person-list-name">${name}</span>
      <button class="btn btn-small btn-secondary" data-id="${person.id}">Edit</button>
    `;
    item.querySelector('button').addEventListener('click', () => showEditForm(person.id));
    list.appendChild(item);
  });
}

function showAddForm() {
  editingPersonId = null;
  document.getElementById('personForm').style.display = 'block';
  document.getElementById('deletePersonBtn').style.display = 'none';
  clearForm();
  populateRelationshipSelects();
}

function showEditForm(personId) {
  const data = getFamilyData();
  const person = data.find(p => p.id === personId);
  if (!person) return;

  editingPersonId = personId;
  document.getElementById('personForm').style.display = 'block';
  document.getElementById('deletePersonBtn').style.display = 'inline-block';

  document.getElementById('personId').value = person.id;
  document.getElementById('firstName').value = person.data['first name'] || '';
  document.getElementById('lastName').value = person.data['last name'] || '';
  document.getElementById('gender').value = person.data.gender || 'M';
  document.getElementById('birthday').value = person.data.birthday || '';

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
  const pickers = ['parentPicker', 'spousePicker', 'childrenPicker'];

  for (const pickerId of pickers) {
    const picker = document.getElementById(pickerId);
    const list = picker.querySelector('.rel-picker-list');
    const searchInput = picker.querySelector('.rel-picker-search');
    list.innerHTML = '';

    data.forEach(person => {
      if (person.id === editingPersonId) return;
      const name = (person.data['first name'] || '') + (person.data['last name'] ? ' ' + person.data['last name'] : '');

      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = person.id;
      cb.id = `${pickerId}_${person.id}`;

      const lbl = document.createElement('span');
      lbl.textContent = name;

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
        const name = li.querySelector('label').textContent.toLowerCase();
        li.classList.toggle('hidden', q && !name.includes(q));
      });
    };
  }
}

function hideForm() {
  document.getElementById('personForm').style.display = 'none';
  editingPersonId = null;
  clearForm();
}

function clearForm() {
  document.getElementById('personId').value = '';
  document.getElementById('firstName').value = '';
  document.getElementById('lastName').value = '';
  document.getElementById('gender').value = 'M';
  document.getElementById('birthday').value = '';
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

function handleSave(e) {
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
    const newPerson = {
      id: newId,
      data: { 'first name': firstName, 'last name': lastName, gender, birthday, avatar: '' },
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
  return data
    .filter(p => !p.to_add)
    .map(p => {
      const clean = {
        id: p.id,
        data: { ...p.data },
        rels: {
          spouses: [...(p.rels.spouses || [])],
          parents: [...(p.rels.parents || [])],
          children: [...(p.rels.children || [])],
        },
      };
      const toAddIds = new Set(data.filter(d => d.to_add).map(d => d.id));
      clean.rels.spouses = clean.rels.spouses.filter(id => !toAddIds.has(id));
      clean.rels.parents = clean.rels.parents.filter(id => !toAddIds.has(id));
      clean.rels.children = clean.rels.children.filter(id => !toAddIds.has(id));
      return clean;
    });
}

function saveToLocalStorage(data) {
  localStorage.setItem('family-tree-data', JSON.stringify(cleanData(data)));
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

  list.innerHTML = `<p class="quality-summary">${issues.length} member${issues.length > 1 ? 's' : ''} with missing data</p>`;
  for (const item of issues) {
    const row = document.createElement('div');
    row.className = 'quality-item';
    row.innerHTML = `
      <div>
        <div class="quality-item-name">${item.name}</div>
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
