import { decryptFamilyData, encryptData, sha256Hex } from './crypto.js';
import { importPrivateKey, createJWT, getInstallationToken, getFileContent, createPR, findOpenBotPR } from './github.js';
import { getFamilyData, normalizeData, getKinshipRules, getAvatarUrl } from './viewer.js';
import { showToast } from './ui.js';
import { cacheGet, cacheSet, cacheRemove } from './storage.js';
import { getAllAvatars } from './avatar-store.js';

const PROPOSE_PW_KEY = 'family-tree-propose-pw';
const VIEW_PW_KEY = 'family-tree-password';
const PROPOSED_KEY = 'family-tree-proposed';

async function loadAppConfig(proposePw) {
  if (import.meta.env.DEV) {
    const res = await fetch(import.meta.env.BASE_URL + 'data/app.json');
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
      return res.json();
    }
  }
  const res = await fetch(import.meta.env.BASE_URL + 'data/app.enc');
  if (!res.ok) return null;
  const encrypted = await res.text();
  const decrypted = await decryptFamilyData(encrypted, proposePw);
  return JSON.parse(decrypted);
}

function getBaseData() {
  const stored = cacheGet('family-tree-data');
  if (!stored) return null;
  return JSON.parse(stored);
}

async function fetchOriginalData(viewPw) {
  if (import.meta.env.DEV) {
    const res = await fetch(import.meta.env.BASE_URL + 'data/family.json');
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
      return res.json();
    }
  }
  const res = await fetch(import.meta.env.BASE_URL + 'data/family.enc');
  if (!res.ok) throw new Error('Could not fetch original data');
  const encrypted = await res.text();
  const decrypted = await decryptFamilyData(encrypted, viewPw);
  return JSON.parse(decrypted);
}

function getLocalKinship() {
  const stored = cacheGet('family-tree-kinship');
  if (!stored) return null;
  return JSON.parse(stored);
}

async function fetchOriginalKinship(viewPw) {
  if (import.meta.env.DEV) {
    const res = await fetch(import.meta.env.BASE_URL + 'data/kinship-rules.json');
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
      return res.json();
    }
  }
  const res = await fetch(import.meta.env.BASE_URL + 'data/kinship-rules.enc');
  if (!res.ok) throw new Error('Could not fetch original kinship rules');
  const encrypted = await res.text();
  const decrypted = await decryptFamilyData(encrypted, viewPw);
  return JSON.parse(decrypted);
}

function diffKinship(originalRules, localRules) {
  const changes = { states: [], transitions: [], equivalences: [] };

  const origStates = originalRules.states || {};
  const localStates = localRules.states || {};
  const allStateKeys = new Set([...Object.keys(origStates), ...Object.keys(localStates)]);

  for (const key of allStateKeys) {
    const orig = origStates[key];
    const local = localStates[key];
    if (!orig && local) {
      changes.states.push({ type: 'added', key, state: local });
    } else if (orig && !local) {
      changes.states.push({ type: 'removed', key, state: orig });
    } else if (JSON.stringify(orig) !== JSON.stringify(local)) {
      changes.states.push({ type: 'modified', key, from: orig, to: local });
    }
  }

  const origTrans = originalRules.transitions || [];
  const localTrans = localRules.transitions || [];
  const transKey = t => `${t.from}|${t.to}|${t.hop}|${t.sex || ''}`;

  const origTransMap = new Map(origTrans.map(t => [transKey(t), t]));
  const localTransMap = new Map(localTrans.map(t => [transKey(t), t]));

  for (const [k, t] of localTransMap) {
    if (!origTransMap.has(k)) changes.transitions.push({ type: 'added', transition: t });
  }
  for (const [k, t] of origTransMap) {
    if (!localTransMap.has(k)) changes.transitions.push({ type: 'removed', transition: t });
  }

  const origEquiv = originalRules.equivalences || {};
  const localEquiv = localRules.equivalences || {};
  const allEquivKeys = new Set([...Object.keys(origEquiv), ...Object.keys(localEquiv)]);

  for (const key of allEquivKeys) {
    if (!origEquiv[key] && localEquiv[key]) {
      changes.equivalences.push({ type: 'added', key, value: localEquiv[key] });
    } else if (origEquiv[key] && !localEquiv[key]) {
      changes.equivalences.push({ type: 'removed', key, value: origEquiv[key] });
    } else if (origEquiv[key] !== localEquiv[key]) {
      changes.equivalences.push({ type: 'modified', key, from: origEquiv[key], to: localEquiv[key] });
    }
  }

  return changes;
}

function cleanData(data) {
  const stripped = data
    .filter(p => !p.to_add)
    .map(p => ({
      id: p.id,
      data: { ...p.data },
      rels: {
        spouses: [...(p.rels.spouses || [])],
        parents: [...(p.rels.parents || [])],
        children: [...(p.rels.children || [])],
      },
    }));
  return normalizeData(stripped);
}

function updateProgress(stepEls, index, status) {
  const el = stepEls[index];
  if (!el) return;
  el.classList.remove('step-pending', 'step-active', 'step-done', 'step-error');
  el.classList.add(`step-${status}`);
  const icon = el.querySelector('.step-icon');
  if (icon) {
    if (status === 'active') icon.textContent = '⏳';
    else if (status === 'done') icon.textContent = '✓';
    else if (status === 'error') icon.textContent = '✗';
    else icon.textContent = '○';
  }
}

async function checkAppConfigExists() {
  if (import.meta.env.DEV) {
    const res = await fetch(import.meta.env.BASE_URL + 'data/app.json');
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) return true;
  }
  const res = await fetch(import.meta.env.BASE_URL + 'data/app.enc');
  if (!res.ok) return false;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('html')) return false;
  const text = await res.text();
  return text.length > 0 && !text.trimStart().startsWith('<');
}

function personLabel(p) {
  const name = [p.data['first name'], p.data['last name']].filter(Boolean).join(' ');
  return `**${name}** (\`${p.id}\`)`;
}

function formatValue(v) {
  if (Array.isArray(v)) return v.length ? v.join(', ') : '_(empty)_';
  return v == null || v === '' ? '_(empty)_' : String(v);
}

function buildPRBody(proposerName, added, removed, modified, original, avatarCount = 0, hasKinshipChanges = false) {
  const sections = [];
  sections.push(`## Changes proposed by ${proposerName}\n`);

  if (added.length) {
    sections.push(`### Added (${added.length})\n`);
    for (const p of added) {
      const lines = [personLabel(p)];
      for (const [key, val] of Object.entries(p.data)) {
        if (val != null && val !== '') lines.push(`- ${key}: ${val}`);
      }
      for (const [rel, ids] of Object.entries(p.rels)) {
        if (ids.length) lines.push(`- ${rel}: ${ids.join(', ')}`);
      }
      sections.push(lines.join('\n') + '\n');
    }
  }

  if (removed.length) {
    sections.push(`### Removed (${removed.length})\n`);
    for (const p of removed) {
      sections.push(personLabel(p) + '\n');
    }
  }

  if (modified.length) {
    sections.push(`### Modified (${modified.length})\n`);
    for (const p of modified) {
      const orig = original.find(o => o.id === p.id);
      const lines = [personLabel(p)];
      for (const key of new Set([...Object.keys(orig.data), ...Object.keys(p.data)])) {
        const oldVal = orig.data[key];
        const newVal = p.data[key];
        if (oldVal !== newVal) {
          lines.push(`- ${key}: \`${formatValue(oldVal)}\` → \`${formatValue(newVal)}\``);
        }
      }
      for (const rel of ['spouses', 'parents', 'children']) {
        const oldIds = orig.rels[rel] || [];
        const newIds = p.rels[rel] || [];
        if (JSON.stringify(oldIds) !== JSON.stringify(newIds)) {
          lines.push(`- ${rel}: \`${formatValue(oldIds)}\` → \`${formatValue(newIds)}\``);
        }
      }
      sections.push(lines.join('\n') + '\n');
    }
  }

  if (hasKinshipChanges) {
    sections.push(`### Kinship Rules\n\nKinship rules updated.\n`);
  }

  if (avatarCount > 0) {
    sections.push(`### Avatars\n\n${avatarCount} avatar image${avatarCount > 1 ? 's' : ''} uploaded.\n`);
  }

  sections.push('---\n_Created from the Family Tree editor_');
  return sections.join('\n');
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildReviewHtml(added, removed, modified, original, avatarEntries, kinshipDiff) {
  const categories = [];

  // --- Family People ---
  const hasPeopleChanges = added.length || removed.length || modified.length;
  if (hasPeopleChanges) {
    const items = [];

    for (const p of modified) {
      const orig = original.find(o => o.id === p.id);
      const name = [p.data['first name'], p.data['last name']].filter(Boolean).join(' ');
      const lines = [];
      for (const key of new Set([...Object.keys(orig.data), ...Object.keys(p.data)])) {
        const oldVal = orig.data[key];
        const newVal = p.data[key];
        if (oldVal !== newVal) {
          lines.push(`<li><span class="review-field">${escHtml(key)}:</span> <span class="review-old">${escHtml(formatValue(oldVal))}</span> → <span class="review-new">${escHtml(formatValue(newVal))}</span></li>`);
        }
      }
      for (const rel of ['spouses', 'parents', 'children']) {
        const oldIds = orig.rels[rel] || [];
        const newIds = p.rels[rel] || [];
        if (JSON.stringify(oldIds) !== JSON.stringify(newIds)) {
          lines.push(`<li><span class="review-field">${escHtml(rel)}:</span> <span class="review-old">${escHtml(formatValue(oldIds))}</span> → <span class="review-new">${escHtml(formatValue(newIds))}</span></li>`);
        }
      }
      items.push(`<details class="propose-review-file" open>
        <summary>${escHtml(name)} <span class="review-badge review-badge-modified">modified</span></summary>
        <ul class="propose-review-changes">${lines.join('')}</ul>
      </details>`);
    }

    for (const p of added) {
      const name = [p.data['first name'], p.data['last name']].filter(Boolean).join(' ');
      const lines = [];
      for (const [key, val] of Object.entries(p.data)) {
        if (val != null && val !== '') {
          lines.push(`<li><span class="review-field">${escHtml(key)}:</span> <span class="review-new">${escHtml(val)}</span></li>`);
        }
      }
      for (const [rel, ids] of Object.entries(p.rels)) {
        if (ids.length) {
          lines.push(`<li><span class="review-field">${escHtml(rel)}:</span> <span class="review-new">${escHtml(ids.join(', '))}</span></li>`);
        }
      }
      items.push(`<details class="propose-review-file" open>
        <summary>${escHtml(name)} <span class="review-badge review-badge-added">added</span></summary>
        <ul class="propose-review-changes">${lines.join('')}</ul>
      </details>`);
    }

    for (const p of removed) {
      const name = [p.data['first name'], p.data['last name']].filter(Boolean).join(' ');
      items.push(`<details class="propose-review-file">
        <summary>${escHtml(name)} <span class="review-badge review-badge-removed">removed</span></summary>
        <ul class="propose-review-changes"><li><span class="review-old">${escHtml(p.id)}</span></li></ul>
      </details>`);
    }

    const count = added.length + removed.length + modified.length;
    categories.push(`<div class="review-category">
      <h4 class="review-category-title">Family Members <span class="review-category-count">${count}</span></h4>
      ${items.join('')}
    </div>`);
  }

  // --- Kinship Rules ---
  if (kinshipDiff) {
    const { states, transitions, equivalences } = kinshipDiff;
    const totalChanges = states.length + transitions.length + equivalences.length;
    if (totalChanges > 0) {
      const lines = [];

      for (const s of states) {
        if (s.type === 'added') {
          lines.push(`<li><span class="review-new">+ state</span> <strong>${escHtml(s.key)}</strong> — ${escHtml(s.state.en)} (${escHtml(s.state.te)})</li>`);
        } else if (s.type === 'removed') {
          lines.push(`<li><span class="review-old">− state</span> <strong>${escHtml(s.key)}</strong> — ${escHtml(s.state.en)} (${escHtml(s.state.te)})</li>`);
        } else {
          lines.push(`<li><span class="review-field">state</span> <strong>${escHtml(s.key)}</strong>: <span class="review-old">${escHtml(s.from.en)} (${escHtml(s.from.te)})</span> → <span class="review-new">${escHtml(s.to.en)} (${escHtml(s.to.te)})</span></li>`);
        }
      }

      for (const t of transitions) {
        const desc = `${t.transition.from} → ${t.transition.to} [${t.transition.hop}${t.transition.sex ? ', ' + t.transition.sex : ''}]`;
        if (t.type === 'added') {
          lines.push(`<li><span class="review-new">+ transition</span> ${escHtml(desc)}</li>`);
        } else {
          lines.push(`<li><span class="review-old">− transition</span> ${escHtml(desc)}</li>`);
        }
      }

      for (const eq of equivalences) {
        if (eq.type === 'added') {
          lines.push(`<li><span class="review-new">+ equivalence</span> ${escHtml(eq.key)} = ${escHtml(eq.value)}</li>`);
        } else if (eq.type === 'removed') {
          lines.push(`<li><span class="review-old">− equivalence</span> ${escHtml(eq.key)} = ${escHtml(eq.value)}</li>`);
        } else {
          lines.push(`<li><span class="review-field">equivalence</span> ${escHtml(eq.key)}: <span class="review-old">${escHtml(eq.from)}</span> → <span class="review-new">${escHtml(eq.to)}</span></li>`);
        }
      }

      categories.push(`<div class="review-category">
        <h4 class="review-category-title">Kinship Rules <span class="review-category-count">${totalChanges}</span></h4>
        <details class="propose-review-file" open>
          <summary>States, Transitions &amp; Equivalences <span class="review-badge review-badge-modified">${totalChanges} change${totalChanges > 1 ? 's' : ''}</span></summary>
          <ul class="propose-review-changes">${lines.join('')}</ul>
        </details>
      </div>`);
    }
  }

  // --- Avatars ---
  const previewUrls = [];

  const allPeople = [...original, ...added, ...modified];
  const personNameById = new Map();
  for (const p of allPeople) {
    const name = [p.data['first name'], p.data['last name']].filter(Boolean).join(' ');
    personNameById.set(p.id, name || p.id);
  }

  const avatarChanges = [];

  for (const p of modified) {
    const orig = original.find(o => o.id === p.id);
    if (!orig) continue;
    const oldAvatar = orig.data.avatar || '';
    const newAvatar = p.data.avatar || '';
    if (oldAvatar === newAvatar) continue;

    if (oldAvatar && !newAvatar) {
      avatarChanges.push({ personId: p.id, type: 'removed', filename: oldAvatar });
    } else if (!oldAvatar && newAvatar) {
      avatarChanges.push({ personId: p.id, type: 'added', filename: newAvatar });
    } else {
      avatarChanges.push({ personId: p.id, type: 'removed', filename: oldAvatar });
      avatarChanges.push({ personId: p.id, type: 'added', filename: newAvatar });
    }
  }

  for (const p of added) {
    if (p.data.avatar) {
      avatarChanges.push({ personId: p.id, type: 'added', filename: p.data.avatar });
    }
  }

  for (const p of removed) {
    if (p.data.avatar) {
      avatarChanges.push({ personId: p.id, type: 'removed', filename: p.data.avatar });
    }
  }

  const uploadedFilenames = new Set(avatarEntries.map(a => a.filename));
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

  if (avatarChanges.length || avatarEntries.length) {
    const lines = [];

    for (const change of avatarChanges) {
      const personName = personNameById.get(change.personId) || change.personId;
      let thumbHtml = '';

      if (change.type === 'added' && uploadedFilenames.has(change.filename)) {
        const entry = avatarEntries.find(a => a.filename === change.filename);
        if (entry) {
          const ext = change.filename.split('.').pop().toLowerCase();
          const mime = MIME[ext] || 'application/octet-stream';
          const url = URL.createObjectURL(new Blob([entry.data], { type: mime }));
          previewUrls.push(url);
          thumbHtml = `<img src="${url}" class="review-avatar-thumb" alt="${escHtml(personName)}" />`;
        }
      } else {
        const cachedUrl = getAvatarUrl(change.filename);
        if (cachedUrl) {
          thumbHtml = `<img src="${cachedUrl}" class="review-avatar-thumb" alt="${escHtml(personName)}" />`;
        }
      }

      const badge = change.type === 'added'
        ? '<span class="review-badge review-badge-added">added</span>'
        : '<span class="review-badge review-badge-removed">removed</span>';
      lines.push(`<li class="review-avatar-item">${thumbHtml}<span>${escHtml(personName)}</span> ${badge}</li>`);
    }

    // Show any IndexedDB uploads that weren't already covered by person-level changes
    for (const a of avatarEntries) {
      if (avatarChanges.some(c => c.filename === a.filename)) continue;
      const ext = a.filename.split('.').pop().toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([a.data], { type: mime }));
      previewUrls.push(url);
      const personId = a.filename.replace(/\.[^.]+$/, '');
      const personName = personNameById.get(personId) || personId;
      lines.push(`<li class="review-avatar-item"><img src="${url}" class="review-avatar-thumb" alt="${escHtml(personName)}" /><span>${escHtml(personName)}</span> <span class="review-badge review-badge-added">added</span></li>`);
    }

    const totalCount = lines.length;
    categories.push(`<div class="review-category">
      <h4 class="review-category-title">Avatars <span class="review-category-count">${totalCount}</span></h4>
      <details class="propose-review-file" open>
        <summary>${totalCount} change${totalCount > 1 ? 's' : ''} <span class="review-badge review-badge-avatar">avatar</span></summary>
        <ul class="propose-review-changes">${lines.join('')}</ul>
      </details>
    </div>`);
  }

  return { html: categories.join(''), previewUrls };
}

function showReviewModal({ html, previewUrls }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('proposeReviewModal');
    const body = document.getElementById('proposeReviewBody');
    const confirmBtn = document.getElementById('proposeReviewConfirm');
    const cancelBtn = document.getElementById('proposeReviewCancel');

    body.innerHTML = html;
    modal.style.display = 'flex';

    function cleanup(result) {
      modal.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      previewUrls.forEach(u => URL.revokeObjectURL(u));
      resolve(result);
    }

    function onConfirm() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === modal) cleanup(false); }
    function onKey(e) { if (e.key === 'Escape') cleanup(false); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);

    confirmBtn.focus();
  });
}

export async function proposeChanges() {
  if (cacheGet(PROPOSED_KEY)) {
    showToast('Changes already proposed — edit further to propose again', 'error');
    return;
  }

  const localData = getBaseData();
  const localKinship = getLocalKinship();

  if (!localData && !localKinship) {
    showToast('No local edits to propose', 'error');
    return;
  }

  // Compute diff first so the user can review before entering any credentials
  const viewPw = cacheGet(VIEW_PW_KEY);

  let original = [];
  let cleaned = [];
  let added = [], removed = [], modified = [];

  if (localData) {
    cleaned = cleanData(localData);
    try {
      original = normalizeData(await fetchOriginalData(viewPw));
    } catch {
      showToast('Could not load original data for comparison', 'error');
      return;
    }
    added = cleaned.filter(p => !original.find(o => o.id === p.id));
    removed = original.filter(o => !cleaned.find(p => p.id === o.id));
    modified = cleaned.filter(p => {
      const orig = original.find(o => o.id === p.id);
      return orig && JSON.stringify(orig) !== JSON.stringify(p);
    });
  }

  let kinshipDiff = null;
  let originalKinship = null;
  if (localKinship) {
    try {
      originalKinship = await fetchOriginalKinship(viewPw);
      kinshipDiff = diffKinship(originalKinship, localKinship);
    } catch {
      showToast('Could not load original kinship rules for comparison', 'error');
      return;
    }
  }

  let avatarEntries = [];
  try { avatarEntries = await getAllAvatars(); } catch { /* no avatars */ }

  const hasKinshipChanges = kinshipDiff && (kinshipDiff.states.length + kinshipDiff.transitions.length + kinshipDiff.equivalences.length) > 0;

  if (!added.length && !removed.length && !modified.length && !avatarEntries.length && !hasKinshipChanges) {
    showToast('No meaningful changes detected — nothing to propose', 'error');
    return;
  }

  const reviewData = buildReviewHtml(added, removed, modified, original, avatarEntries, kinshipDiff);
  const confirmed = await showReviewModal(reviewData);
  if (!confirmed) return;

  // After review confirmation, check if propose is available and authenticate
  const appExists = await checkAppConfigExists();
  if (!appExists) {
    showToast('Propose is not available', 'error');
    return;
  }

  let appConfig = null;
  if (import.meta.env.DEV) {
    try {
      appConfig = await loadAppConfig(null);
    } catch { /* fall through to password flow */ }
  }

  if (!appConfig) {
    let proposePw = cacheGet(PROPOSE_PW_KEY);
    if (!proposePw) {
      proposePw = await promptForPassword();
      if (!proposePw) return;
    }

    try {
      appConfig = await loadAppConfig(proposePw);
    } catch {
      cacheRemove(PROPOSE_PW_KEY);
      showToast('Invalid propose password', 'error');
      return;
    }

    if (!appConfig) {
      showToast('Propose not configured — app.enc could not be loaded', 'error');
      return;
    }

    cacheSet(PROPOSE_PW_KEY, proposePw);
  }

  const proposerName = await promptForName();
  if (!proposerName) return;

  // Now show progress modal for the actual work
  const progressModal = document.getElementById('proposeProgressModal');
  const stepEls = progressModal.querySelectorAll('.propose-step');
  const resultEl = document.getElementById('proposeResult');
  const closeBtn = document.getElementById('proposeProgressCloseBtn');
  const cancelBtn = document.getElementById('proposeProgressCancelBtn');

  const abort = new AbortController();
  cancelBtn.onclick = () => abort.abort();

  stepEls.forEach((el, i) => updateProgress(stepEls, i, 'pending'));
  resultEl.innerHTML = '';
  closeBtn.style.display = 'none';
  cancelBtn.style.display = '';
  progressModal.style.display = 'flex';

  function finish() {
    cancelBtn.style.display = 'none';
    closeBtn.style.display = '';
  }

  try {
    // Step 0: encrypt data
    updateProgress(stepEls, 0, 'active');
    abort.signal.throwIfAborted();

    let encryptedBase64 = null;
    let encHash = null;
    if (localData) {
      const jsonStr = JSON.stringify(cleaned, null, 2);
      encryptedBase64 = await encryptData(jsonStr, viewPw);
      encHash = await sha256Hex(encryptedBase64);
    }

    let encryptedKinship = null;
    let kinshipHash = null;
    if (localKinship && hasKinshipChanges) {
      const kinshipStr = JSON.stringify(localKinship, null, 2);
      encryptedKinship = await encryptData(kinshipStr, viewPw);
      kinshipHash = await sha256Hex(encryptedKinship);
    }

    updateProgress(stepEls, 0, 'done');

    // Step 1: authenticate with GitHub & check for existing PR
    updateProgress(stepEls, 1, 'active');
    abort.signal.throwIfAborted();
    const privateKey = await importPrivateKey(appConfig.privateKey);
    const jwt = await createJWT(appConfig.appId, privateKey);
    const token = await getInstallationToken(jwt, appConfig.installationId);

    abort.signal.throwIfAborted();
    const existingPR = await findOpenBotPR(token, appConfig.owner, appConfig.repo);
    if (existingPR) {
      const prBranch = existingPR.head.ref;
      try {
        const prFile = await getFileContent(token, appConfig.owner, appConfig.repo, 'public/data/family.enc', prBranch);
        const prEncrypted = atob(prFile.content.replace(/\n/g, ''));
        const prDecrypted = await decryptFamilyData(prEncrypted, viewPw);
        const prData = normalizeData(JSON.parse(prDecrypted));
        if (JSON.stringify(prData) === JSON.stringify(cleaned)) {
          updateProgress(stepEls, 1, 'done');
          updateProgress(stepEls, 2, 'done');
          resultEl.innerHTML = `<span class="propose-error">An open proposal with identical changes already exists.</span> <a href="${existingPR.html_url}" target="_blank" rel="noopener">${existingPR.html_url}</a>`;
          finish();
          cacheSet(PROPOSED_KEY, '1');
          const proposeBtn = document.getElementById('proposeBtn');
          if (proposeBtn) proposeBtn.style.display = 'none';
          return;
        }
      } catch {
        // Can't compare — proceed with new PR
      }
    }
    updateProgress(stepEls, 1, 'done');

    // Step 2: create PR
    updateProgress(stepEls, 2, 'active');
    abort.signal.throwIfAborted();

    let manifest;
    try {
      const manifestFile = await getFileContent(token, appConfig.owner, appConfig.repo, 'public/data/.manifest');
      manifest = JSON.parse(atob(manifestFile.content.replace(/\n/g, '')));
    } catch {
      manifest = {};
    }
    const files = [];

    if (encryptedBase64) {
      manifest['public/data/family.enc'] = encHash;
      files.push({ path: 'public/data/family.enc', content: encryptedBase64, encoding: 'utf-8' });
    }

    if (encryptedKinship) {
      manifest['public/data/kinship-rules.enc'] = kinshipHash;
      files.push({ path: 'public/data/kinship-rules.enc', content: encryptedKinship, encoding: 'utf-8' });
    }

    for (const { filename, data: buf } of avatarEntries) {
      abort.signal.throwIfAborted();
      const encAvatar = await encryptData(new Uint8Array(buf), viewPw);
      const avatarHash = await sha256Hex(encAvatar);
      manifest[`public/avatars/${filename}.enc`] = avatarHash;
      files.push({ path: `public/avatars/${filename}.enc`, content: encAvatar, encoding: 'utf-8' });
    }

    const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
    files.push({ path: 'public/data/.manifest', content: manifestJson, encoding: 'utf-8' });

    abort.signal.throwIfAborted();
    const prTitle = `Family tree update by ${proposerName}`;
    const prBody = buildPRBody(proposerName, added, removed, modified, original, avatarEntries.length, hasKinshipChanges);

    const pr = await createPR({
      token,
      owner: appConfig.owner,
      repo: appConfig.repo,
      title: prTitle,
      body: prBody,
      files,
      onProgress: () => {},
    });

    updateProgress(stepEls, 2, 'done');
    resultEl.innerHTML = `<span class="propose-success">PR created!</span> <a href="${pr.html_url}" target="_blank" rel="noopener">${pr.html_url}</a>`;
    finish();

    cacheSet(PROPOSED_KEY, '1');
    const proposeBtn = document.getElementById('proposeBtn');
    if (proposeBtn) proposeBtn.style.display = 'none';

  } catch (err) {
    if (err.name === 'AbortError') {
      progressModal.style.display = 'none';
      return;
    }
    console.error('Propose failed:', err);
    const activeStep = [...stepEls].findIndex(el => el.classList.contains('step-active'));
    if (activeStep >= 0) updateProgress(stepEls, activeStep, 'error');
    resultEl.innerHTML = `<span class="propose-error">${err.message || 'Unknown error — check browser console'}</span>`;
    finish();
  }
}

function promptForPassword() {
  return new Promise((resolve) => {
    const modal = document.getElementById('proposePwModal');
    const input = document.getElementById('proposePwInput');
    const submitBtn = document.getElementById('proposePwSubmit');
    const cancelBtn = document.getElementById('proposePwCancel');
    const errorEl = document.getElementById('proposePwError');

    input.value = '';
    errorEl.textContent = '';
    modal.style.display = 'flex';
    requestAnimationFrame(() => input.focus());

    function cleanup(result) {
      modal.style.display = 'none';
      submitBtn.removeEventListener('click', onSubmit);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      modal.removeEventListener('click', onBackdrop);
      resolve(result);
    }

    function onSubmit() {
      const pw = input.value;
      if (!pw) { errorEl.textContent = 'Password required.'; return; }
      cleanup(pw);
    }

    function onCancel() { cleanup(null); }
    function onBackdrop(e) { if (e.target === modal) cleanup(null); }
    function onKey(e) {
      if (e.key === 'Enter') onSubmit();
      if (e.key === 'Escape') cleanup(null);
    }

    submitBtn.addEventListener('click', onSubmit);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
    modal.addEventListener('click', onBackdrop);
  });
}

function promptForName() {
  return new Promise((resolve) => {
    const modal = document.getElementById('proposeNameModal');
    const input = document.getElementById('proposeNameInput');
    const submitBtn = document.getElementById('proposeNameSubmit');
    const cancelBtn = document.getElementById('proposeNameCancel');

    input.value = cacheGet('family-tree-proposer-name') || '';
    modal.style.display = 'flex';
    requestAnimationFrame(() => input.focus());

    function cleanup(result) {
      modal.style.display = 'none';
      submitBtn.removeEventListener('click', onSubmit);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      modal.removeEventListener('click', onBackdrop);
      resolve(result);
    }

    function onSubmit() {
      const name = input.value.trim();
      if (!name) return;
      cacheSet('family-tree-proposer-name', name);
      cleanup(name);
    }

    function onCancel() { cleanup(null); }
    function onBackdrop(e) { if (e.target === modal) cleanup(null); }
    function onKey(e) {
      if (e.key === 'Enter') onSubmit();
      if (e.key === 'Escape') cleanup(null);
    }

    submitBtn.addEventListener('click', onSubmit);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
    modal.addEventListener('click', onBackdrop);
  });
}
