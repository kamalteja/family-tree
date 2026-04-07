import * as f3 from 'family-chart';
import 'family-chart/styles/family-chart.css';
import { computeAllRelationships } from './kinship.js';
import { decryptFamilyData } from './crypto.js';

let chart = null;
let familyData = [];
let kinshipRules = {};
let relationshipLabels = new Map();
let currentPrincipalId = null;
let isFullTreeView = false;

export function getFamilyData() {
  return familyData;
}

export function setFamilyData(data) {
  familyData = data;
}

export function getKinshipRules() {
  return kinshipRules;
}

export function getChart() {
  return chart;
}

async function loadDataFile(name, password) {
  if (import.meta.env.DEV) {
    const res = await fetch(import.meta.env.BASE_URL + `data/${name}.json`);
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
      return res.json();
    }
  }

  const res = await fetch(import.meta.env.BASE_URL + `data/${name}.enc`);
  if (!res.ok) throw new Error(`No data found: ${name}`);
  const encrypted = await res.text();
  if (!password) throw new Error('Password required');
  const decrypted = await decryptFamilyData(encrypted, password);
  return JSON.parse(decrypted);
}

export async function initViewer(password) {
  const [rawFamilyData, rulesRes] = await Promise.all([
    loadDataFile('family', password),
    loadDataFile('kinship-rules', password),
  ]);

  familyData = rawFamilyData;
  kinshipRules = rulesRes;

  const saved = localStorage.getItem('family-tree-data');
  if (saved) {
    try {
      familyData = JSON.parse(saved);
    } catch {
      // ignore malformed localStorage
    }
  }

  currentPrincipalId = familyData.length > 0 ? familyData[0].id : null;

  populatePrincipalDropdown();
  recomputeRelationships();
  createChart();
}

function populatePrincipalDropdown() {
  const dropdown = document.getElementById('principalDropdown');
  dropdown.innerHTML = '';

  familyData.forEach(person => {
    const opt = document.createElement('option');
    opt.value = person.id;
    opt.textContent = person.data['first name'] + (person.data['last name'] ? ' ' + person.data['last name'] : '');
    if (person.id === currentPrincipalId) opt.selected = true;
    dropdown.appendChild(opt);
  });

  dropdown.addEventListener('change', (e) => {
    changePrincipal(e.target.value);
  });
}

function recomputeRelationships() {
  if (!currentPrincipalId || familyData.length === 0) return;
  relationshipLabels = computeAllRelationships(currentPrincipalId, familyData, kinshipRules);
}

export function changePrincipal(newId) {
  currentPrincipalId = newId;
  recomputeRelationships();

  const dropdown = document.getElementById('principalDropdown');
  if (dropdown.value !== newId) dropdown.value = newId;

  if (chart) {
    chart.updateMainId(newId);
    chart.updateTree({ tree_position: 'main_to_middle' });
    refreshCardLabels();
  }

  isFullTreeView = false;
  updateToggleButton();
}

function createChart() {
  const container = document.getElementById('FamilyChart');
  container.innerHTML = '';

  chart = f3.createChart(container, familyData);

  chart.setCardHtml()
    .setCardInnerHtmlCreator(createCardHtml)
    .setStyle('default')
    .setOnHoverPathToMain()
    .setCardDim({
      w: 220,
      h: 100,
      text_x: 75,
      text_y: 15,
      img_w: 60,
      img_h: 60,
      img_x: 5,
      img_y: 15,
    });

  chart
    .setCardXSpacing(320)
    .setCardYSpacing(200)
    .setShowSiblingsOfMain(true)
    .setTransitionTime(800);

  if (currentPrincipalId) {
    chart.updateMainId(currentPrincipalId);
  }

  chart.updateTree({ initial: true, tree_position: 'fit' });

  setupToggleButton();
  setupFitButton();
}

function formatBirthday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function createCardHtml(d) {
  const data = d.data.data;
  const personId = d.data.id;
  const name = (data['first name'] || '') + (data['last name'] ? ' ' + data['last name'] : '');
  const labels = relationshipLabels.get(personId);

  const isMainPerson = personId === currentPrincipalId;
  const highlightClass = isMainPerson ? ' card-principal' : '';

  let relationHtml = '';
  if (labels) {
    if (isMainPerson) {
      relationHtml = `<div class="card-relation card-relation-self">${labels.te}</div>`;
    } else {
      relationHtml = `<div class="card-relation">
        <span class="relation-te">${labels.te}</span>
        <span class="relation-en">${labels.en}</span>
      </div>`;
    }
  }

  const gender = data.gender === 'M' ? 'male' : 'female';
  const avatarColor = data.gender === 'M' ? 'rgb(120, 159, 172)' : 'rgb(196, 138, 146)';
  const fallbackSvg = `<svg viewBox="0 0 64 64" class="card-avatar"><circle cx="32" cy="24" r="14" fill="${avatarColor}"/><ellipse cx="32" cy="56" rx="22" ry="16" fill="${avatarColor}"/></svg>`;
  const avatarHtml = data.avatar
    ? `<img src="${import.meta.env.BASE_URL}avatars/${data.avatar}" alt="${name}" class="card-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" /><span style="display:none">${fallbackSvg}</span>`
    : fallbackSvg;

  const birthdayHtml = data.birthday
    ? `<div class="card-birthday">${formatBirthday(data.birthday)}</div>`
    : '';

  return `<div class="card-inner${highlightClass}" data-gender="${gender}">
    <div class="card-avatar-wrap">${avatarHtml}</div>
    <div class="card-info">
      <div class="card-name">${name}</div>
      ${birthdayHtml}
      ${relationHtml}
    </div>
  </div>`;
}

function refreshCardLabels() {
  const container = document.getElementById('FamilyChart');
  const cards = container.querySelectorAll('.card-inner');
  cards.forEach(card => {
    // Cards are re-rendered by the library on updateTree,
    // so we rely on createCardHtml being called again.
  });
  // Force re-render
  if (chart) {
    chart.updateTree({ tree_position: 'main_to_middle' });
  }
}

function setupFitButton() {
  document.getElementById('fitViewBtn').addEventListener('click', () => {
    if (chart) {
      chart.updateTree({ tree_position: 'fit' });
    }
  });
}

function setupToggleButton() {
  const btn = document.getElementById('toggleViewBtn');
  btn.style.display = 'inline-block';
  btn.addEventListener('click', toggleFullTree);
}

function updateToggleButton() {
  const btn = document.getElementById('toggleViewBtn');
  btn.textContent = isFullTreeView ? 'Show Principal Root' : 'Show Full Tree';
}

function findRootAncestor() {
  const personMap = new Map(familyData.map(p => [p.id, p]));
  let current = currentPrincipalId;
  const visited = new Set();

  while (current && !visited.has(current)) {
    visited.add(current);
    const person = personMap.get(current);
    if (!person || !person.rels.parents || person.rels.parents.length === 0) {
      return current;
    }
    current = person.rels.parents[0];
  }

  return currentPrincipalId;
}

function toggleFullTree() {
  isFullTreeView = !isFullTreeView;
  updateToggleButton();

  if (chart) {
    if (isFullTreeView) {
      const rootId = findRootAncestor();
      chart.updateMainId(rootId);
      chart.updateTree({ tree_position: 'fit' });
    } else {
      chart.updateMainId(currentPrincipalId);
      chart.updateTree({ tree_position: 'main_to_middle' });
    }
  }
}

export function refreshViewer() {
  recomputeRelationships();
  if (chart) {
    chart.updateData(familyData);
    chart.updateMainId(currentPrincipalId);
    chart.updateTree({ tree_position: 'main_to_middle' });
  }
  populatePrincipalDropdown();
}
