import { getKinshipRules, setKinshipRules } from './viewer.js';
import { cacheSet, cacheRemove } from './storage.js';
import { confirmModal } from './ui.js';
import { select } from 'd3-selection';
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';

const HOP_COLORS = {
  parent:  '#60a5fa',
  child:   '#34d399',
  spouse:  '#f87171',
  sibling: '#fbbf24',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_W = 120;
const NODE_H = 52;
const MIN_RADIUS = 180;

let selectedState = 'self';
let isEditMode = false;
let editingTransition = null;
let editingStateKey = null;

let resizeTimer;

export function initKinshipViewer() {
  document.getElementById('kinshipBtn').addEventListener('click', openKinshipPanel);
  document.getElementById('kinshipBackBtn').addEventListener('click', closeKinshipPanel);
  document.getElementById('kinshipSearch').addEventListener('input', filterStates);
  document.getElementById('kinshipEditBtn').addEventListener('click', enterEditMode);
  document.getElementById('kinshipViewBtn').addEventListener('click', exitEditMode);
  document.getElementById('addStateBtn').addEventListener('click', openAddState);
  document.getElementById('stateEditForm').addEventListener('submit', handleStateSave);
  document.getElementById('stateEditCancel').addEventListener('click', closeStateEdit);
  document.getElementById('stateDeleteBtn').addEventListener('click', handleStateDelete);
  document.getElementById('addTransitionBtn').addEventListener('click', openAddTransition);
  document.getElementById('transitionEditForm').addEventListener('submit', handleTransitionSave);
  document.getElementById('transEditCancel').addEventListener('click', closeTransitionPopover);
  document.getElementById('transDeleteBtn').addEventListener('click', handleTransitionDelete);
  document.getElementById('fitViewBtn').addEventListener('click', () => {
    if (document.getElementById('kinshipPanel').style.display !== 'none') resetZoom();
  });

  initSvgPanZoom();

  window.addEventListener('resize', () => {
    if (document.getElementById('kinshipPanel').style.display === 'none') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const rules = getKinshipRules();
      if (rules?.states) renderFocusedView(rules, selectedState);
    }, 150);
  });
}

const VIEWER_TOOLBAR_IDS = [
  'principalSelector', 'memberCount', 'searchBtn',
  'toggleViewBtn', 'editModeBtn', 'kinshipBtn',
  'resetDataBtn', 'editJsonBtn', 'infoBtn',
];

const EDITOR_TOOLBAR_IDS = [
  'viewModeBtn', 'exportBtn', 'proposeBtn',
];

async function openKinshipPanel() {
  const rules = getKinshipRules();
  if (!rules || !rules.states) return;

  if (document.getElementById('personForm').style.display === 'block') {
    const ok = await confirmModal('Unsaved changes', 'You have an unsaved person edit. Switching to Kinship will discard it. Continue?');
    if (!ok) return;
  }

  document.getElementById('editorPanel').style.display = 'none';
  document.getElementById('qualityPanel').style.display = 'none';

  document.getElementById('viewerMode').style.display = 'none';
  document.getElementById('kinshipPanel').style.display = 'flex';

  for (const id of [...VIEWER_TOOLBAR_IDS, ...EDITOR_TOOLBAR_IDS]) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  document.getElementById('kinshipBackBtn').style.display = 'inline-block';
  document.getElementById('kinshipEditBtn').style.display = 'inline-block';
  document.getElementById('kinshipViewBtn').style.display = 'none';
  document.getElementById('appSubtitle').textContent = '- Kinship';

  isEditMode = false;
  document.querySelectorAll('.kinship-edit-only').forEach(el => { el.style.display = 'none'; });
  document.getElementById('kinshipSvg').classList.remove('edit-mode');
  document.getElementById('stateEditPanel').style.display = 'none';
  document.getElementById('transitionEditPanel').style.display = 'none';
  editingStateKey = null;
  editingTransition = null;

  selectedState = 'self';
  renderStatesIndex(rules);
  requestAnimationFrame(() => {
    renderFocusedView(rules, selectedState);
    renderEquivalences(rules, selectedState);
  });
}

async function closeKinshipPanel() {
  if (hasUnsavedKinshipEdit()) {
    const ok = await confirmModal('Unsaved changes', 'You have an unsaved kinship edit. Leaving will discard it. Continue?');
    if (!ok) return;
  }

  if (isEditMode) resetEditMode();

  document.getElementById('kinshipPanel').style.display = 'none';
  document.getElementById('viewerMode').style.display = '';

  document.getElementById('kinshipBackBtn').style.display = 'none';
  document.getElementById('kinshipEditBtn').style.display = 'none';
  document.getElementById('kinshipViewBtn').style.display = 'none';
  document.getElementById('appSubtitle').textContent = '';

  document.getElementById('principalSelector').style.display = 'flex';
  document.getElementById('memberCount').style.display = '';
  document.getElementById('searchBtn').style.display = '';
  document.getElementById('fitViewBtn').style.display = '';
  document.getElementById('resetDataBtn').style.display = '';
  document.getElementById('editJsonBtn').style.display = '';
  document.getElementById('infoBtn').style.display = '';
  document.getElementById('kinshipBtn').style.display = 'inline-block';
  document.getElementById('editModeBtn').style.display = 'inline-block';
}

function filterStates() {
  const query = document.getElementById('kinshipSearch').value.toLowerCase();
  const items = document.querySelectorAll('.kinship-state-card');
  items.forEach(card => {
    const te = card.dataset.te || '';
    const en = card.dataset.en || '';
    const key = card.dataset.key || '';
    card.style.display = (te.includes(query) || en.includes(query) || key.includes(query)) ? '' : 'none';
  });
}

function renderStatesIndex(rules) {
  const list = document.getElementById('kinshipStateList');
  const stateKeys = Object.keys(rules.states);
  document.getElementById('kinshipStateCount').textContent = `States (${stateKeys.length})`;
  list.innerHTML = '';

  const reverseEquiv = buildReverseEquivalences(rules);

  for (const key of stateKeys) {
    const state = rules.states[key];
    const card = document.createElement('div');
    card.className = 'kinship-state-card' + (key === selectedState ? ' selected' : '');
    card.dataset.key = key;
    card.dataset.te = state.te.toLowerCase();
    card.dataset.en = (state.en || '').toLowerCase();

    let html = `<span class="kinship-card-te">${state.te}</span>`;
    if (state.en) html += `<span class="kinship-card-en">${state.en}</span>`;

    if (rules.equivalences && rules.equivalences[key]) {
      html += `<span class="kinship-card-equiv">= ${rules.equivalences[key]}</span>`;
    } else if (reverseEquiv.has(key)) {
      const children = reverseEquiv.get(key);
      html += `<span class="kinship-card-equiv-base">${children.join(', ')}</span>`;
    }

    if (isEditMode) {
      html += `<button class="kinship-card-edit" data-key="${key}" title="Edit state">&#9998;</button>`;
    }
    card.innerHTML = html;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.kinship-card-edit')) return;
      selectState(key);
      if (isEditMode) openTransitionPopover(null);
    });
    const editBtn = card.querySelector('.kinship-card-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectState(key);
        openStateEdit(key);
      });
    }
    list.appendChild(card);
  }
}

function selectState(key) {
  closeTransitionPopover();
  const rules = getKinshipRules();
  selectedState = key;

  document.querySelectorAll('.kinship-state-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.key === key);
  });

  const selectedCard = document.querySelector(`.kinship-state-card[data-key="${key}"]`);
  if (selectedCard) selectedCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  renderFocusedView(rules, key);
  renderEquivalences(rules, key);
}

function buildReverseEquivalences(rules) {
  const map = new Map();
  if (!rules.equivalences) return map;
  for (const [child, base] of Object.entries(rules.equivalences)) {
    if (!map.has(base)) map.set(base, []);
    map.get(base).push(child);
  }
  return map;
}

function getOutgoingTransitions(rules, stateKey) {
  if (!rules.transitions) return [];
  return rules.transitions.filter(t => t.from === stateKey);
}

function groupTransitionsByTarget(transitions) {
  const map = new Map();
  for (const t of transitions) {
    if (!map.has(t.to)) map.set(t.to, []);
    map.get(t.to).push(t);
  }
  return map;
}

function formatEdgeLabel(transition) {
  const parts = [transition.hop];
  if (transition.gender) parts.push(transition.gender);
  if (transition.age) parts.push(transition.age);
  return parts.join(' ');
}

const TRANSITION_MS = 800;
const STAGGER_MS = 60;

let svgZoom;

function initSvgPanZoom() {
  const svg = select('#kinshipSvg');
  svgZoom = d3Zoom()
    .scaleExtent([0.3, 4])
    .on('zoom', (event) => {
      svg.select('.kinship-content').attr('transform', event.transform);
    });
  svg.call(svgZoom);
}

function resetZoom() {
  const svg = select('#kinshipSvg');
  svg.call(svgZoom.transform, zoomIdentity);
}

function renderFocusedView(rules, stateKey) {
  const svg = document.getElementById('kinshipSvg');
  svg.innerHTML = '';
  svg.classList.toggle('edit-mode', isEditMode);

  const rect = svg.parentElement.getBoundingClientRect();
  const width = rect.width || 600;
  const height = rect.height || 500;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);

  const defs = document.createElementNS(SVG_NS, 'defs');
  for (const [hop, color] of Object.entries(HOP_COLORS)) {
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', `arrow-${hop}`);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('orient', 'auto-start-reverse');
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('points', '0,1 10,5 0,9');
    polygon.setAttribute('fill', color);
    marker.appendChild(polygon);
    defs.appendChild(marker);
  }
  svg.appendChild(defs);

  const contentG = document.createElementNS(SVG_NS, 'g');
  contentG.setAttribute('class', 'kinship-content');
  svg.appendChild(contentG);

  resetZoom();

  const cx = width / 2;
  const cy = height / 2;

  const transitions = getOutgoingTransitions(rules, stateKey);
  const grouped = groupTransitionsByTarget(transitions);
  grouped.delete(stateKey);
  const targets = Array.from(grouped.keys());

  const radius = Math.max(MIN_RADIUS, Math.min(width, height) / 2 - NODE_H - 30);

  const satellitePositions = [];
  const n = targets.length;
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    satellitePositions.push({
      key: targets[i],
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }

  const edgeGroups = [];

  for (let si = 0; si < satellitePositions.length; si++) {
    const sat = satellitePositions[si];
    const tGroup = grouped.get(sat.key);
    const hopTypes = [...new Set(tGroup.map(t => t.hop))];
    const hopType = hopTypes[0];
    const color = HOP_COLORS[hopType] || '#888';

    const dx = sat.x - cx;
    const dy = sat.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / dist;
    const uy = dy / dist;

    const startX = cx + ux * (NODE_W / 2 + 4);
    const startY = cy + uy * (NODE_H / 2 + 4);
    const endX = sat.x - ux * (NODE_W / 2 + 12);
    const endY = sat.y - uy * (NODE_H / 2 + 12);

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', startX);
    line.setAttribute('y1', startY);
    line.setAttribute('x2', endX);
    line.setAttribute('y2', endY);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('marker-end', `url(#arrow-${hopType})`);
    contentG.appendChild(line);

    const labelX = (startX + endX) / 2;
    const labelY = (startY + endY) / 2;
    const labels = tGroup.map(formatEdgeLabel);

    const labelG = document.createElementNS(SVG_NS, 'g');

    const textEl = document.createElementNS(SVG_NS, 'text');
    textEl.setAttribute('x', labelX);
    textEl.setAttribute('y', labelY);
    textEl.setAttribute('text-anchor', 'middle');
    textEl.setAttribute('dominant-baseline', 'middle');
    textEl.setAttribute('class', 'kinship-edge-label');

    if (labels.length === 1) {
      textEl.textContent = labels[0];
    } else {
      labels.forEach((l, idx) => {
        const tspan = document.createElementNS(SVG_NS, 'tspan');
        tspan.setAttribute('x', labelX);
        tspan.setAttribute('dy', idx === 0 ? `${-(labels.length - 1) * 6}` : '13');
        tspan.textContent = l;
        textEl.appendChild(tspan);
      });
    }

    labelG.appendChild(textEl);
    contentG.appendChild(labelG);

    const bbox = textEl.getBBox();
    const bgRect = document.createElementNS(SVG_NS, 'rect');
    bgRect.setAttribute('x', bbox.x - 4);
    bgRect.setAttribute('y', bbox.y - 2);
    bgRect.setAttribute('width', bbox.width + 8);
    bgRect.setAttribute('height', bbox.height + 4);
    bgRect.setAttribute('rx', '3');
    bgRect.setAttribute('class', 'kinship-edge-label-bg');
    labelG.insertBefore(bgRect, textEl);

    if (isEditMode) {
      const tGroupCopy = [...tGroup];
      const clickHandler = () => openTransitionPopover(tGroupCopy[0]);
      line.addEventListener('click', clickHandler);
      labelG.addEventListener('click', clickHandler);
    }

    edgeGroups.push({ line, labelG, idx: si });
  }

  const centerG = drawNode(contentG, cx, cy, stateKey, rules.states[stateKey], true);

  centerG.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: TRANSITION_MS * 0.4, easing: 'ease', fill: 'backwards',
  });

  for (let si = 0; si < satellitePositions.length; si++) {
    const sat = satellitePositions[si];
    const state = rules.states[sat.key];
    const g = drawNode(contentG, sat.x, sat.y, sat.key, state, false);
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => selectState(sat.key));

    const dx = cx - sat.x;
    const dy = cy - sat.y;
    g.animate([
      { opacity: 0, transform: `translate(${dx}px, ${dy}px)` },
      { opacity: 1, transform: 'translate(0, 0)' },
    ], { duration: TRANSITION_MS, easing: 'cubic-bezier(0.42,0,0.58,1)', fill: 'backwards', delay: si * STAGGER_MS });
  }

  for (const eg of edgeGroups) {
    eg.line.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: TRANSITION_MS, easing: 'ease', fill: 'backwards', delay: eg.idx * STAGGER_MS,
    });
    eg.labelG.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: TRANSITION_MS * 0.5, easing: 'ease', fill: 'backwards', delay: eg.idx * STAGGER_MS + TRANSITION_MS * 0.4,
    });
  }

  renderLegend(svg, width);
}

function drawNode(svg, x, y, key, state, isCenter) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', isCenter ? 'kinship-node kinship-node-center' : 'kinship-node');

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('rx', '8');
  rect.setAttribute('class', isCenter ? 'kinship-node-rect-center' : 'kinship-node-rect');
  g.appendChild(rect);

  const teName = document.createElementNS(SVG_NS, 'text');
  teName.setAttribute('x', x);
  teName.setAttribute('y', y - 6);
  teName.setAttribute('text-anchor', 'middle');
  teName.setAttribute('dominant-baseline', 'middle');
  teName.setAttribute('class', isCenter ? 'kinship-node-te-center' : 'kinship-node-te');
  teName.textContent = state ? state.te : key;
  g.appendChild(teName);

  if (state && state.en) {
    const enName = document.createElementNS(SVG_NS, 'text');
    enName.setAttribute('x', x);
    enName.setAttribute('y', y + 12);
    enName.setAttribute('text-anchor', 'middle');
    enName.setAttribute('dominant-baseline', 'middle');
    enName.setAttribute('class', isCenter ? 'kinship-node-en-center' : 'kinship-node-en');
    enName.textContent = state.en;
    g.appendChild(enName);
  }

  svg.appendChild(g);

  const bbox = g.getBBox();
  const padX = 16;
  const padY = 10;
  const w = Math.max(NODE_W, bbox.width + padX * 2);
  const h = Math.max(NODE_H, bbox.height + padY * 2);
  rect.setAttribute('x', x - w / 2);
  rect.setAttribute('y', y - h / 2);
  rect.setAttribute('width', w);
  rect.setAttribute('height', h);

  return g;
}

function renderLegend(svg, width) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', `translate(${width - 10}, 16)`);

  const hops = Object.entries(HOP_COLORS);
  const itemW = 80;
  const totalW = hops.length * itemW;
  const startX = -totalW;

  hops.forEach(([hop, color], i) => {
    const x = startX + i * itemW;

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', x + 22);
    line.setAttribute('y2', 0);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '3');
    g.appendChild(line);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', x + 26);
    text.setAttribute('y', 0);
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('class', 'kinship-legend-text');
    text.textContent = hop;
    g.appendChild(text);
  });

  svg.appendChild(g);
}

function renderEquivalences(rules, stateKey) {
  const container = document.getElementById('kinshipEquiv');
  container.innerHTML = '';

  const parts = [];

  const selfTransitions = (rules.transitions || []).filter(t => t.from === stateKey && t.to === stateKey);
  if (selfTransitions.length > 0) {
    const labels = selfTransitions.map(formatEdgeLabel).join(', ');
    parts.push(`<span class="kinship-equiv-label">Self-loop:</span><span class="kinship-equiv-tag">${labels}</span>`);
  }

  const reverseEquiv = buildReverseEquivalences(rules);

  if (rules.equivalences && rules.equivalences[stateKey]) {
    const base = rules.equivalences[stateKey];
    const baseLabel = rules.states[base]?.te || base;
    parts.push(`<span class="kinship-equiv-label">Inherits from:</span><button class="kinship-equiv-tag kinship-equiv-link" data-key="${base}">${baseLabel} (${base})</button>`);
  } else if (reverseEquiv.has(stateKey)) {
    const children = reverseEquiv.get(stateKey);
    const tags = children.map(c => {
      const label = rules.states[c]?.te || c;
      return `<button class="kinship-equiv-tag kinship-equiv-link" data-key="${c}">${label} (${c})</button>`;
    }).join('');
    parts.push(`<span class="kinship-equiv-label">Inherited by:</span>${tags}`);
  }

  container.innerHTML = parts.join('<span class="kinship-equiv-sep">|</span>');
  container.querySelectorAll('.kinship-equiv-link').forEach(btn => {
    btn.addEventListener('click', () => selectState(btn.dataset.key));
  });
}

/* ─── Edit mode toggle ─── */

function enterEditMode() {
  isEditMode = true;
  document.getElementById('kinshipEditBtn').style.display = 'none';
  document.getElementById('kinshipViewBtn').style.display = 'inline-block';
  document.getElementById('appSubtitle').textContent = '- Kinship (editing)';
  document.querySelectorAll('.kinship-edit-only').forEach(el => { el.style.display = ''; });
  document.getElementById('kinshipSvg').classList.add('edit-mode');

  const rules = getKinshipRules();
  renderStatesIndex(rules);
  renderFocusedView(rules, selectedState);
  renderEquivalences(rules, selectedState);
  openAddTransition();
}

function hasUnsavedKinshipEdit() {
  return document.getElementById('stateEditPanel').style.display !== 'none'
    || document.getElementById('transitionEditPanel').style.display !== 'none';
}

function resetEditMode() {
  isEditMode = false;
  document.getElementById('kinshipEditBtn').style.display = 'inline-block';
  document.getElementById('kinshipViewBtn').style.display = 'none';
  document.getElementById('appSubtitle').textContent = '- Kinship';
  document.querySelectorAll('.kinship-edit-only').forEach(el => { el.style.display = 'none'; });
  document.getElementById('kinshipSvg').classList.remove('edit-mode');

  closeStateEdit();
  closeTransitionPopover();

  const rules = getKinshipRules();
  renderStatesIndex(rules);
  renderFocusedView(rules, selectedState);
  renderEquivalences(rules, selectedState);
}

async function exitEditMode() {
  if (hasUnsavedKinshipEdit()) {
    const ok = await confirmModal('Unsaved changes', 'You have an unsaved kinship edit. Exiting edit mode will discard it. Continue?');
    if (!ok) return;
  }
  resetEditMode();
}

/* ─── Persistence helper ─── */

function saveRules(rules) {
  setKinshipRules(rules);
  cacheSet('family-tree-kinship', JSON.stringify(rules));
  cacheRemove('family-tree-proposed');
}

function refreshView(rules) {
  renderStatesIndex(rules);
  renderFocusedView(rules, selectedState);
  renderEquivalences(rules, selectedState);
}

/* ─── State edit panel ─── */

function openStateEdit(key) {
  const rules = getKinshipRules();
  const state = rules.states[key];
  if (!state) return;

  closeTransitionPopover();
  editingStateKey = key;

  document.getElementById('stateEditTitle').textContent = 'Edit State';
  document.getElementById('stateKeyInput').value = key;
  document.getElementById('stateKeyInput').readOnly = true;
  document.getElementById('stateTeInput').value = state.te || '';
  document.getElementById('stateEnInput').value = state.en || '';
  document.getElementById('stateDeleteBtn').style.display = '';

  document.getElementById('stateEditPanel').style.display = '';
  document.getElementById('stateTeInput').focus();
}

function openAddState() {
  closeTransitionPopover();
  editingStateKey = null;

  document.getElementById('stateEditTitle').textContent = 'Add State';
  document.getElementById('stateKeyInput').value = '';
  document.getElementById('stateKeyInput').readOnly = false;
  document.getElementById('stateTeInput').value = '';
  document.getElementById('stateEnInput').value = '';
  document.getElementById('stateDeleteBtn').style.display = 'none';

  document.getElementById('stateEditPanel').style.display = '';
  document.getElementById('stateKeyInput').focus();
}

function closeStateEdit() {
  document.getElementById('stateEditPanel').style.display = 'none';
  editingStateKey = null;
}

function handleStateSave(e) {
  e.preventDefault();
  const rules = structuredClone(getKinshipRules());
  const key = document.getElementById('stateKeyInput').value.trim();
  const te = document.getElementById('stateTeInput').value.trim();
  const en = document.getElementById('stateEnInput').value.trim();

  if (!key || !te) return;

  if (editingStateKey) {
    rules.states[editingStateKey].te = te;
    rules.states[editingStateKey].en = en || undefined;
  } else {
    if (rules.states[key]) {
      alert(`State key "${key}" already exists.`);
      return;
    }
    rules.states[key] = { te, en: en || undefined };
  }

  saveRules(rules);
  closeStateEdit();
  selectedState = key;
  refreshView(rules);
}

function handleStateDelete() {
  if (!editingStateKey) return;
  const key = editingStateKey;
  if (!confirm(`Delete state "${key}"? This will also remove all transitions referencing it.`)) return;

  const rules = structuredClone(getKinshipRules());
  delete rules.states[key];

  if (rules.transitions) {
    rules.transitions = rules.transitions.filter(t => t.from !== key && t.to !== key);
  }

  if (rules.equivalences) {
    delete rules.equivalences[key];
    for (const [child, base] of Object.entries(rules.equivalences)) {
      if (base === key) delete rules.equivalences[child];
    }
  }

  saveRules(rules);
  closeStateEdit();
  selectedState = Object.keys(rules.states)[0] || 'self';
  refreshView(rules);
}

/* ─── Transition popover ─── */

function populateToDropdown() {
  const rules = getKinshipRules();
  const select = document.getElementById('transToInput');
  select.innerHTML = '';
  for (const k of Object.keys(rules.states)) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = `${rules.states[k].te} (${k})`;
    select.appendChild(opt);
  }
}

function openTransitionPopover(transition) {
  closeStateEdit();
  editingTransition = transition ? { ...transition } : null;
  populateToDropdown();

  document.getElementById('transFromInput').value = transition ? transition.from : selectedState;
  document.getElementById('transToInput').value = transition ? transition.to : '';
  document.getElementById('transHopInput').value = transition ? transition.hop : 'parent';
  document.getElementById('transGenderInput').value = transition ? transition.gender : 'M';
  document.getElementById('transAgeInput').value = transition?.age || '';
  document.getElementById('transDeleteBtn').style.display = transition ? '' : 'none';
  document.getElementById('transitionPopTitle').textContent = transition ? 'Edit Transition' : 'Add Transition';

  document.getElementById('transitionEditPanel').style.display = '';
  document.getElementById('transToInput').focus();
}

function openAddTransition() {
  openTransitionPopover(null);
}

function closeTransitionPopover() {
  document.getElementById('transitionEditPanel').style.display = 'none';
  editingTransition = null;
}

function handleTransitionSave(e) {
  e.preventDefault();
  const rules = structuredClone(getKinshipRules());
  if (!rules.transitions) rules.transitions = [];

  const from = document.getElementById('transFromInput').value;
  const to = document.getElementById('transToInput').value;
  const hop = document.getElementById('transHopInput').value;
  const gender = document.getElementById('transGenderInput').value;
  const age = document.getElementById('transAgeInput').value || null;

  if (editingTransition) {
    const idx = rules.transitions.findIndex(t =>
      t.from === editingTransition.from &&
      t.to === editingTransition.to &&
      t.hop === editingTransition.hop &&
      t.gender === editingTransition.gender &&
      (t.age || null) === (editingTransition.age || null)
    );
    if (idx >= 0) {
      rules.transitions[idx] = { from, to, hop, gender, age };
    }
  } else {
    rules.transitions.push({ from, to, hop, gender, age });
  }

  saveRules(rules);
  closeTransitionPopover();
  refreshView(rules);
}

function handleTransitionDelete() {
  if (!editingTransition) return;
  const rules = structuredClone(getKinshipRules());
  if (!rules.transitions) return;

  rules.transitions = rules.transitions.filter(t =>
    !(t.from === editingTransition.from &&
      t.to === editingTransition.to &&
      t.hop === editingTransition.hop &&
      t.gender === editingTransition.gender &&
      (t.age || null) === (editingTransition.age || null))
  );

  saveRules(rules);
  closeTransitionPopover();
  refreshView(rules);
}
