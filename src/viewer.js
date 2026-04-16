import * as f3 from 'family-chart';
import 'family-chart/styles/family-chart.css';
import { computeAllRelationships } from './kinship.js';
import { decryptFamilyData, decryptToBlob } from './crypto.js';
import { cacheGet, cacheSet } from './storage.js';
import { getAllAvatars } from './avatar-store.js';

let chart = null;
let familyData = [];
let kinshipRules = {};
let relationshipLabels = new Map();
let currentPrincipalId = null;
const avatarUrlCache = new Map();
let isFullTreeView = false;

export function getAvatarUrl(filename) {
  return avatarUrlCache.get(filename) || null;
}

export function setAvatarUrl(filename, url) {
  avatarUrlCache.set(filename, url);
}

export function removeAvatarUrl(filename) {
  avatarUrlCache.delete(filename);
}

export function normalizeData(data) {
  return data.map(p => ({
    ...p,
    rels: {
      spouses: [...(p.rels?.spouses || [])].sort(),
      parents: [...(p.rels?.parents || [])].sort(),
      children: [...(p.rels?.children || [])].sort(),
    },
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export function getFamilyData() {
  return familyData;
}

export function setFamilyData(data) {
  familyData = data;
}

export function getKinshipRules() {
  return kinshipRules;
}

export function setKinshipRules(rules) {
  kinshipRules = rules;
  recomputeRelationships();
}

export function getRelationshipLabels() {
  return relationshipLabels;
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

export async function loadData(password) {
  const [rawFamilyData, rulesRes] = await Promise.all([
    loadDataFile('family', password),
    loadDataFile('kinship-rules', password),
  ]);

  familyData = rawFamilyData;
  kinshipRules = rulesRes;

  const saved = cacheGet('family-tree-data');
  if (saved) {
    try {
      familyData = JSON.parse(saved);
    } catch { /* ignore malformed localStorage */ }
  }

  const savedKinship = cacheGet('family-tree-kinship');
  if (savedKinship) {
    try {
      kinshipRules = JSON.parse(savedKinship);
    } catch { /* ignore malformed localStorage */ }
  }

  await decryptAvatars(password);

  const cachedPrincipal = cacheGet('family-tree-principal');
  if (cachedPrincipal && familyData.some(p => p.id === cachedPrincipal)) {
    currentPrincipalId = cachedPrincipal;
  } else {
    currentPrincipalId = familyData.length > 0 ? familyData[0].id : null;
  }

  updateMemberCount();
  populatePrincipalDropdown();
  recomputeRelationships();
}

export function renderChart() {
  createChart();
}

function updateMemberCount() {
  const el = document.getElementById('memberCount');
  if (el) el.innerHTML = `Total members: <strong>${familyData.length}</strong>`;
}

const MIME_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

async function decryptAvatars(password) {
  const avatarFiles = [...new Set(familyData.map(p => p.data.avatar).filter(Boolean))];
  if (avatarFiles.length === 0) return;

  const pw = password || cacheGet('family-tree-password') || '';

  let localAvatars = new Map();
  try {
    const entries = await getAllAvatars();
    for (const { filename, data } of entries) {
      localAvatars.set(filename, data);
    }
  } catch { /* IndexedDB unavailable */ }

  await Promise.all(avatarFiles.map(async (filename) => {
    if (avatarUrlCache.has(filename)) return;

    if (localAvatars.has(filename)) {
      const buf = localAvatars.get(filename);
      const ext = filename.split('.').pop().toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      avatarUrlCache.set(filename, URL.createObjectURL(new Blob([buf], { type: mime })));
      return;
    }

    const ext = filename.split('.').pop().toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    try {
      if (import.meta.env.DEV) {
        const res = await fetch(import.meta.env.BASE_URL + 'avatars/' + filename);
        if (res.ok && !(res.headers.get('content-type') || '').includes('html')) {
          avatarUrlCache.set(filename, import.meta.env.BASE_URL + 'avatars/' + filename);
          return;
        }
      }
      if (!pw) return;
      const res = await fetch(import.meta.env.BASE_URL + 'avatars/' + filename + '.enc');
      if (!res.ok) return;
      const encrypted = await res.text();
      const blobUrl = await decryptToBlob(encrypted, pw, mime);
      avatarUrlCache.set(filename, blobUrl);
    } catch { /* avatar not available */ }
  }));
}

function populatePrincipalDropdown() {
  const container = document.getElementById('principalDropdown');
  const trigger = document.getElementById('principalTrigger');
  const valueEl = trigger.querySelector('.custom-select-value');
  const menu = document.getElementById('principalMenu');
  const searchInput = document.getElementById('principalSearch');
  const optionsList = document.getElementById('principalOptions');

  function buildOptions() {
    optionsList.innerHTML = '';
    familyData.forEach(person => {
      const name = person.data['first name'] + (person.data['last name'] ? ' ' + person.data['last name'] : '');
      const li = document.createElement('li');
      li.dataset.id = person.id;
      li.textContent = name;
      if (person.id === currentPrincipalId) li.classList.add('selected');
      li.addEventListener('click', () => {
        changePrincipal(person.id);
        closeDropdown();
      });
      optionsList.appendChild(li);
    });
    updateDisplayValue();
  }

  function updateDisplayValue() {
    const person = familyData.find(p => p.id === currentPrincipalId);
    if (person) {
      valueEl.textContent = person.data['first name'] + (person.data['last name'] ? ' ' + person.data['last name'] : '');
    }
    optionsList.querySelectorAll('li').forEach(li => {
      li.classList.toggle('selected', li.dataset.id === currentPrincipalId);
    });
  }

  function openDropdown() {
    container.classList.add('open');
    searchInput.value = '';
    filterOptions('');
    requestAnimationFrame(() => searchInput.focus());
  }

  function closeDropdown() {
    container.classList.remove('open');
    searchInput.value = '';
    filterOptions('');
  }

  function filterOptions(query) {
    const q = query.toLowerCase();
    optionsList.querySelectorAll('li').forEach(li => {
      li.classList.toggle('hidden', q && !li.textContent.toLowerCase().includes(q));
    });
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    container.classList.contains('open') ? closeDropdown() : openDropdown();
  });

  searchInput.addEventListener('input', () => filterOptions(searchInput.value));
  searchInput.addEventListener('click', (e) => e.stopPropagation());

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
    if (e.key === 'Enter') {
      const visible = [...optionsList.querySelectorAll('li:not(.hidden)')];
      if (visible.length === 1) {
        visible[0].click();
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) closeDropdown();
  });

  buildOptions();
  container._updateValue = updateDisplayValue;
  container._buildOptions = buildOptions;
}

function recomputeRelationships() {
  if (!currentPrincipalId || familyData.length === 0) return;
  relationshipLabels = computeAllRelationships(currentPrincipalId, familyData, kinshipRules);
}

export function changePrincipal(newId) {
  currentPrincipalId = newId;
  cacheSet('family-tree-principal', newId);
  recomputeRelationships();

  const dropdown = document.getElementById('principalDropdown');
  if (dropdown._updateValue) dropdown._updateValue();

  if (chart) {
    chart.updateMainId(newId);
    chart.updateTree({ tree_position: 'main_to_middle' });
  }

  isFullTreeView = false;
  updateToggleButton();
  document.dispatchEvent(new CustomEvent('principal-changed'));
}

export function buildFamilyGraph(data) {
  const graph = new Map();
  (data || familyData).forEach(p => {
    if (!graph.has(p.id)) graph.set(p.id, new Set());
    for (const rel of ['parents', 'spouses', 'children']) {
      (p.rels[rel] || []).forEach(rid => {
        if (!graph.has(rid)) graph.set(rid, new Set());
        graph.get(p.id).add(rid);
        graph.get(rid).add(p.id);
      });
    }
  });
  return graph;
}

export function findPathBFS(fromId, toId, data) {
  if (fromId === toId) return [fromId];
  const graph = buildFamilyGraph(data);
  const visited = new Set([fromId]);
  const queue = [[fromId]];
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    for (const neighbor of (graph.get(current) || [])) {
      if (neighbor === toId) return [...path, neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return null;
}

let traceHoverId = null;

function traceEnter(datum) {
  const personId = datum.data.id;
  traceHoverId = personId;
  if (!currentPrincipalId || personId === currentPrincipalId) return;

  const path = findPathBFS(personId, currentPrincipalId);
  if (!path) return;
  const pathSet = new Set(path);
  const container = document.getElementById('FamilyChart');

  container.querySelectorAll('svg.main_svg .links_view .link').forEach(el => {
    const d = el.__data__;
    if (!d || d.spouse) return;
    if (Array.isArray(d.source)) {
      if (pathSet.has(d.target?.data?.id) && d.source.some(s => pathSet.has(s?.data?.id)))
        d.source.forEach(s => { if (s?.data?.id) pathSet.add(s.data.id); });
    } else if (Array.isArray(d.target)) {
      if (pathSet.has(d.source?.data?.id) && d.target.some(t => pathSet.has(t?.data?.id)))
        d.target.forEach(t => { if (t?.data?.id) pathSet.add(t.data.id); });
    }
  });

  container.querySelectorAll('#htmlSvg .cards_view .card_cont').forEach(el => {
    const d = el.__data__;
    if (d && pathSet.has(d.data.id)) {
      const inner = el.querySelector('.card-inner');
      if (inner) {
        const isEndpoint = d.data.id === personId || d.data.id === currentPrincipalId;
        const delay = Math.abs(datum.depth - d.depth) * 200;
        setTimeout(() => {
          if (traceHoverId === personId) {
            inner.classList.add('f3-path-to-main');
            if (isEndpoint) inner.classList.add('f3-trace-endpoint');
          }
        }, delay);
      }
    }
  });

  container.querySelectorAll('svg.main_svg .links_view .link').forEach(el => {
    const d = el.__data__;
    if (!d) return;
    let match = false;

    if (d.spouse) {
      match = pathSet.has(d.source?.data?.id) && pathSet.has(d.target?.data?.id);
    } else if (Array.isArray(d.source)) {
      match = pathSet.has(d.target?.data?.id) && d.source.some(s => pathSet.has(s?.data?.id));
    } else if (Array.isArray(d.target)) {
      match = pathSet.has(d.source?.data?.id) && d.target.some(t => pathSet.has(t?.data?.id));
    }

    if (match) {
      const delay = Math.abs(datum.depth - (d.depth || 0)) * 200;
      setTimeout(() => {
        if (traceHoverId === personId) el.classList.add('f3-path-to-main');
      }, delay);
    }
  });
}

function traceLeave() {
  traceHoverId = null;
  const container = document.getElementById('FamilyChart');
  container.querySelectorAll('.f3-path-to-main').forEach(el => {
    el.classList.remove('f3-path-to-main');
    el.classList.remove('f3-trace-endpoint');
  });
}

function createChart() {
  const container = document.getElementById('FamilyChart');
  container.innerHTML = '';

  chart = f3.createChart(container, familyData);

  const cardInst = chart.setCardHtml();
  cardInst
    .setCardInnerHtmlCreator(createCardHtml)
    .setMiniTree(true)
    .setStyle('default')
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

  cardInst.onCardMouseenter = (_e, datum) => traceEnter(datum);
  cardInst.onCardMouseleave = () => traceLeave();

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
  setupSearch();
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
      const hasPath = labels.path && labels.path.length > 1;
      const pathHtml = hasPath
        ? labels.path.map(p =>
            p.type === 'hop'
              ? `<span class="path-hop">${p.label}</span>`
              : `<span class="path-state">${p.label}</span>`
          ).join('')
        : '';
      relationHtml = `<div class="card-relation">
        <span class="relation-te">${labels.te}</span>
        ${pathHtml ? `<span class="relation-path">${pathHtml}</span>` : ''}
      </div>`;
    }
  }

  const gender = data.gender === 'M' ? 'male' : 'female';
  const avatarColor = data.gender === 'M' ? 'rgb(120, 159, 172)' : 'rgb(196, 138, 146)';
  const fallbackSvg = `<svg viewBox="0 0 64 64" class="card-avatar"><circle cx="32" cy="24" r="14" fill="${avatarColor}"/><ellipse cx="32" cy="56" rx="22" ry="16" fill="${avatarColor}"/></svg>`;
  const avatarSrc = data.avatar && avatarUrlCache.get(data.avatar);
  const avatarHtml = avatarSrc
    ? `<img src="${avatarSrc}" alt="${name}" class="card-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" /><span style="display:none">${fallbackSvg}</span>`
    : fallbackSvg;

  const birthdayHtml = data.birthday
    ? `<div class="card-birthday">${formatBirthday(data.birthday)}</div>`
    : '';

  return `<div class="card-inner${highlightClass}" data-gender="${gender}" data-person-id="${personId}">
    <div class="card-avatar-wrap">${avatarHtml}</div>
    <div class="card-info">
      <div class="card-name">${name}</div>
      ${birthdayHtml}
      ${relationHtml}
    </div>
  </div>`;
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

export function findRootOf(startId, data) {
  const personMap = new Map((data || familyData).map(p => [p.id, p]));
  let current = startId;
  const visited = new Set();

  while (current && !visited.has(current)) {
    visited.add(current);
    const person = personMap.get(current);
    if (!person || !person.rels.parents || person.rels.parents.length === 0) {
      return current;
    }
    current = person.rels.parents[0];
  }

  return startId;
}

function findRootAncestor() {
  return findRootOf(currentPrincipalId);
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

function setupSearch() {
  const btn = document.getElementById('searchBtn');
  const panel = document.getElementById('searchPanel');
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  const shortcutEl = document.getElementById('searchShortcut');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (shortcutEl) shortcutEl.textContent = isMac ? '⌘F' : 'Ctrl+F';

  function open() {
    panel.style.display = '';
    input.value = '';
    results.innerHTML = '';
    results.classList.remove('has-results');
    requestAnimationFrame(() => input.focus());
  }

  function close() {
    panel.style.display = 'none';
    input.value = '';
    results.innerHTML = '';
    results.classList.remove('has-results');
  }

  function search(query) {
    const q = query.toLowerCase().trim();
    results.innerHTML = '';
    if (!q) { results.classList.remove('has-results'); return; }

    const matches = familyData.filter(p => {
      const name = (p.data['first name'] || '') + ' ' + (p.data['last name'] || '');
      return name.toLowerCase().includes(q);
    }).slice(0, 10);

    if (matches.length === 0) { results.classList.remove('has-results'); return; }

    matches.forEach(person => {
      const name = person.data['first name'] + (person.data['last name'] ? ' ' + person.data['last name'] : '');
      const labels = relationshipLabels.get(person.id);
      const li = document.createElement('li');
      li.innerHTML = name + (labels ? `<span class="search-result-relation">${labels.te}</span>` : '');
      li.addEventListener('click', () => {
        close();
        panToCard(person.id);
      });
      results.appendChild(li);
    });
    results.classList.add('has-results');
  }

  btn.addEventListener('click', () => {
    panel.style.display === 'none' ? open() : close();
  });

  input.addEventListener('input', () => {
    if (shortcutEl) shortcutEl.style.display = input.value ? 'none' : '';
    search(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') {
      const first = results.querySelector('li');
      if (first) first.click();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      open();
    }
  });

  document.getElementById('FamilyChart').addEventListener('click', () => {
    if (panel.style.display !== 'none') close();
  });
}

function panToCard(personId) {
  const container = document.getElementById('FamilyChart');
  const card = container.querySelector(`.card-inner[data-person-id="${personId}"]`);

  if (card) {
    smoothPanTo(card);
    highlightCard(personId);
    return;
  }

  if (!isFullTreeView) {
    isFullTreeView = true;
    updateToggleButton();
  }

  const targetRoot = findRootOf(personId);
  chart.updateMainId(targetRoot);
  chart.updateTree({ tree_position: 'fit' });

  setTimeout(() => {
    const found = container.querySelector(`.card-inner[data-person-id="${personId}"]`);
    if (found) {
      smoothPanTo(found);
      highlightCard(personId);
    } else {
      chart.updateMainId(personId);
      chart.updateTree({ tree_position: 'main_to_middle' });
      setTimeout(() => highlightCard(personId), 900);
    }
  }, 1000);
}

function smoothPanTo(card) {
  const container = document.getElementById('FamilyChart');
  const svg = container.querySelector('svg');
  const svgView = svg.querySelector('.view');
  const htmlView = container.querySelector('#htmlSvg .cards_view');

  const cardCont = card.closest('.card_cont');
  if (!cardCont) return;

  const style = cardCont.style.transform || getComputedStyle(cardCont).transform;
  let cx, cy;
  const txMatch = style.match(/translate\(([-\d.e]+)px,?\s*([-\d.e]+)px\)/);
  if (txMatch) {
    cx = parseFloat(txMatch[1]);
    cy = parseFloat(txMatch[2]);
  } else {
    const mMatch = style.match(/matrix\(([^)]+)\)/);
    if (!mMatch) return;
    const parts = mMatch[1].split(',').map(Number);
    cx = parts[4];
    cy = parts[5];
  }

  cx += 110;
  cy += 50;

  const zoomListener = svg.__zoomObj ? svg : svg.parentNode;
  let fromK = 1, fromX = 0, fromY = 0;
  if (zoomListener?.__zoom) {
    fromK = zoomListener.__zoom.k;
    fromX = zoomListener.__zoom.x;
    fromY = zoomListener.__zoom.y;
  }

  const toK = Math.max(fromK, 1);
  const rect = container.getBoundingClientRect();
  const toX = rect.width / 2 - cx * toK;
  const toY = rect.height / 2 - cy * toK;

  const duration = 600;
  const startTime = performance.now();

  function frame(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const curK = fromK + (toK - fromK) * ease;
    const x = fromX + (toX - fromX) * ease;
    const y = fromY + (toY - fromY) * ease;
    const css = `translate(${x}px, ${y}px) scale(${curK})`;
    svgView.style.transform = css;
    htmlView.style.transform = css;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else if (zoomListener?.__zoom) {
      const proto = Object.getPrototypeOf(zoomListener.__zoom);
      const synced = Object.create(proto);
      synced.k = toK;
      synced.x = toX;
      synced.y = toY;
      zoomListener.__zoom = synced;
    }
  }

  requestAnimationFrame(frame);
}

let highlightCleanup = null;

function highlightCard(personId) {
  if (highlightCleanup) highlightCleanup();

  const container = document.getElementById('FamilyChart');
  const card = container.querySelector(`.card-inner[data-person-id="${personId}"]`);
  if (!card) return;

  card.classList.remove('card-highlight');
  void card.offsetWidth;
  card.classList.add('card-highlight');

  function stop() {
    card.classList.remove('card-highlight');
    card.removeEventListener('mouseenter', stop);
    clearTimeout(timer);
    highlightCleanup = null;
  }

  card.addEventListener('mouseenter', stop);
  const timer = setTimeout(stop, 60_000);
  highlightCleanup = stop;
}

export function refreshViewer() {
  recomputeRelationships();
  updateMemberCount();
  if (chart) {
    chart.updateData(familyData);
    chart.updateMainId(currentPrincipalId);
    chart.updateTree({ tree_position: 'main_to_middle' });
  }
  populatePrincipalDropdown();
}
