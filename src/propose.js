import { decryptFamilyData, encryptData, sha256Hex } from './crypto.js';
import { importPrivateKey, createJWT, getInstallationToken, getFileContent, createPR, findOpenBotPR } from './github.js';
import { getFamilyData, normalizeData } from './viewer.js';
import { showToast } from './ui.js';
import { cacheGet, cacheSet, cacheRemove } from './storage.js';

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

export async function proposeChanges() {
  if (cacheGet(PROPOSED_KEY)) {
    showToast('Changes already proposed — edit further to propose again', 'error');
    return;
  }

  const localData = getBaseData();
  if (!localData) {
    showToast('No local edits to propose', 'error');
    return;
  }

  // Pre-flight: check if app.enc exists before prompting for anything
  const appExists = await checkAppConfigExists();
  if (!appExists) {
    showToast('Propose is not available', 'error');
    return;
  }

  // In dev mode, try loading plaintext app.json first (no password needed)
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
    const viewPw = cacheGet(VIEW_PW_KEY);
    const cleaned = cleanData(localData);
    const jsonStr = JSON.stringify(cleaned, null, 2);
    const encryptedBase64 = await encryptData(jsonStr, viewPw);
    const encHash = await sha256Hex(encryptedBase64);
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
    manifest['public/data/family.enc'] = encHash;
    const manifestJson = JSON.stringify(manifest, null, 2) + '\n';

    const original = normalizeData(await fetchOriginalData(viewPw));
    const added = cleaned.filter(p => !original.find(o => o.id === p.id));
    const removed = original.filter(o => !cleaned.find(p => p.id === o.id));
    const modified = cleaned.filter(p => {
      const orig = original.find(o => o.id === p.id);
      return orig && JSON.stringify(orig) !== JSON.stringify(p);
    });

    if (!added.length && !removed.length && !modified.length) {
      updateProgress(stepEls, 2, 'done');
      resultEl.innerHTML = '<span class="propose-success">No meaningful changes detected — nothing to propose.</span>';
      finish();
      return;
    }

    abort.signal.throwIfAborted();
    const summaryParts = [];
    if (added.length) summaryParts.push(`Added ${added.length} person(s): ${added.map(p => p.data['first name']).join(', ')}`);
    if (removed.length) summaryParts.push(`Removed ${removed.length} person(s): ${removed.map(p => p.data['first name']).join(', ')}`);
    if (modified.length) summaryParts.push(`Modified ${modified.length} person(s): ${modified.map(p => p.data['first name']).join(', ')}`);

    const prTitle = `Family tree update by ${proposerName}`;
    const prBody = `## Changes proposed by ${proposerName}\n\n${summaryParts.join('\n')}\n\n_Created from the Family Tree editor_`;

    const pr = await createPR({
      token,
      owner: appConfig.owner,
      repo: appConfig.repo,
      title: prTitle,
      body: prBody,
      files: [
        { path: 'public/data/family.enc', content: encryptedBase64, encoding: 'utf-8' },
        { path: 'public/data/.manifest', content: manifestJson, encoding: 'utf-8' },
      ],
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
