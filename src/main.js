import { loadData, renderChart, getChart, setFamilyData, getFamilyData, normalizeData } from './viewer.js';
import { initEditor } from './editor.js';
import { initKinshipViewer } from './kinship-viewer.js';
import { computeDiff } from './diff.js';
import { decryptFamilyData } from './crypto.js';
import { confirmModal } from './ui.js';
import { cacheGet, cacheSet, cacheRemove } from './storage.js';
import './styles.css';

const PASSWORD_KEY = 'family-tree-password';

function initTheme() {
  const saved = cacheGet('family-tree-theme');
  const theme = saved || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);

  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    cacheSet('family-tree-theme', next);
    updateThemeIcon(next);
  });
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('themeToggle');
  btn.innerHTML = theme === 'dark' ? '&#9788;' : '&#9790;';
  btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

function initResetButton() {
  document.getElementById('resetDataBtn').addEventListener('click', async () => {
    const ok = await confirmModal('Reset data', 'Reset to the original data? This will clear all localStorage edits.');
    if (!ok) return;
    cacheRemove('family-tree-data');
    cacheRemove('family-tree-kinship');
    location.reload();
  });
}

function initJsonEditor() {
  const btn = document.getElementById('editJsonBtn');
  const modal = document.getElementById('jsonEditorModal');
  const closeBtn = document.getElementById('jsonEditorCloseBtn');
  const cancelBtn = document.getElementById('jsonEditorCancelBtn');
  const saveBtn = document.getElementById('jsonEditorSaveBtn');
  const previewBtn = document.getElementById('jsonPreviewDiffBtn');
  const textarea = document.getElementById('jsonEditorArea');
  const diffView = document.getElementById('jsonDiffView');
  const errorEl = document.getElementById('jsonEditorError');

  let baseJson = '';
  let showingDiff = false;

  async function loadBaseJson() {
    try {
      async function fetchDataFile(name) {
        if (import.meta.env.DEV) {
          const res = await fetch(import.meta.env.BASE_URL + `data/${name}.json`);
          if (res.ok && (res.headers.get('content-type') || '').includes('json')) return res.json();
        }
        const res = await fetch(import.meta.env.BASE_URL + `data/${name}.enc`);
        const encrypted = await res.text();
        const password = cacheGet(PASSWORD_KEY) || '';
        return JSON.parse(await decryptFamilyData(encrypted, password));
      }
      const data = normalizeData(await fetchDataFile('family'));
      baseJson = JSON.stringify(data, null, 2);
    } catch {
      baseJson = '[]';
    }
  }
  loadBaseJson();

  function renderDiff() {
    const oldLines = baseJson.split('\n');
    const newLines = textarea.value.split('\n');
    const diff = computeDiff(oldLines, newLines);
    let firstChangeId = '';
    diffView.innerHTML = diff.map((entry, i) => {
      const prefix = entry.type === 'add' ? '+' : entry.type === 'remove' ? '-' : ' ';
      const escaped = entry.line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const id = entry.type !== 'same' && !firstChangeId ? (firstChangeId = `diff-first-${i}`, firstChangeId) : '';
      return `<div ${id ? `id="${id}"` : ''} class="diff-line diff-line-${entry.type}">${prefix} ${escaped}</div>`;
    }).join('');

    if (firstChangeId) {
      requestAnimationFrame(() => {
        const el = document.getElementById(firstChangeId);
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
  }

  btn.addEventListener('click', () => {
    const stored = cacheGet('family-tree-data');
    let raw = stored || baseJson || '[]';
    try { raw = JSON.stringify(normalizeData(JSON.parse(raw)), null, 2); } catch { /* show as-is */ }
    textarea.value = raw;
    errorEl.textContent = '';
    showingDiff = true;
    textarea.style.display = 'none';
    diffView.style.display = 'block';
    previewBtn.textContent = 'Edit JSON';
    renderDiff();
    modal.style.display = 'flex';
  });

  const close = () => {
    modal.style.display = 'none';
    showingDiff = true;
    textarea.style.display = 'none';
    diffView.style.display = 'block';
    previewBtn.textContent = 'Edit JSON';
  };
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  previewBtn.addEventListener('click', () => {
    if (showingDiff) {
      showingDiff = false;
      textarea.style.display = 'block';
      diffView.style.display = 'none';
      previewBtn.textContent = 'Preview Changes';
    } else {
      renderDiff();
      showingDiff = true;
      textarea.style.display = 'none';
      diffView.style.display = 'block';
      previewBtn.textContent = 'Edit JSON';
    }
  });

  saveBtn.addEventListener('click', () => {
    const source = textarea.value;
    try {
      const parsed = JSON.parse(source);
      if (!Array.isArray(parsed)) throw new Error('Data must be a JSON array');
      cacheSet('family-tree-data', JSON.stringify(parsed));
      modal.style.display = 'none';
      location.reload();
    } catch (err) {
      if (showingDiff) {
        showingDiff = false;
        textarea.style.display = 'block';
        diffView.style.display = 'none';
        previewBtn.textContent = 'Preview Changes';
      }

      errorEl.textContent = 'Invalid JSON: ' + err.message;
    }
  });
}

function initInfoModal() {
  const btn = document.getElementById('infoBtn');
  const modal = document.getElementById('infoModal');
  const closeBtn = document.getElementById('infoCloseBtn');

  btn.addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
}

function showApp() {
  document.getElementById('passwordModal').style.display = 'none';
  document.getElementById('app').style.display = '';
  const toolbar = document.getElementById('toolbar');
  document.documentElement.style.setProperty('--toolbar-height', toolbar.offsetHeight + 'px');
}

function initProposeProgressClose() {
  document.getElementById('proposeProgressCloseBtn').addEventListener('click', () => {
    document.getElementById('proposeProgressModal').style.display = 'none';
  });
}

function lockApp() {
  cacheRemove(PASSWORD_KEY);
  cacheRemove('family-tree-data');
  cacheRemove('family-tree-kinship');
  cacheRemove('family-tree-propose-pw');
  cacheRemove('family-tree-proposed');
  setFamilyData([]);
  document.getElementById('FamilyChart').innerHTML = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('passwordModal').style.display = '';
  const input = document.getElementById('passwordInput');
  input.value = '';
  document.getElementById('passwordError').textContent = '';
  input.focus();
}

function initLockButton() {
  document.getElementById('lockBtn').addEventListener('click', async () => {
    if (cacheGet('family-tree-data') || cacheGet('family-tree-kinship')) {
      const ok = await confirmModal('Lock with unsaved edits', 'You have local edits that haven\'t been exported. Locking will discard them. Continue?');
      if (!ok) return;
    }
    lockApp();
  });
}

async function tryUnlock(password) {
  await loadData(password);
  cacheSet(PASSWORD_KEY, password);
  showApp();
  renderChart();
  initEditor();
  initKinshipViewer();
  document.getElementById('kinshipBtn').style.display = 'inline-block';
}

function initPasswordModal() {
  const modal = document.getElementById('passwordModal');
  const input = document.getElementById('passwordInput');
  const submitBtn = document.getElementById('passwordSubmit');
  const errorEl = document.getElementById('passwordError');

  async function submit() {
    const password = input.value;
    if (!password) { errorEl.textContent = 'Please enter a password.'; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Decrypting…';
    errorEl.textContent = '';
    try {
      await tryUnlock(password);
    } catch {
      errorEl.textContent = 'Wrong password. Please try again.';
      input.value = '';
      input.focus();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Unlock';
    }
  }

  submitBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

async function main() {
  const homeLink = document.getElementById('appHomeLink');
  if (homeLink) homeLink.href = import.meta.env.BASE_URL;

  initTheme();
  initResetButton();
  initJsonEditor();
  initInfoModal();
  initLockButton();
  initPasswordModal();
  initProposeProgressClose();

  if (import.meta.env.DEV) {
    try {
      await loadData();
      showApp();
      renderChart();
      initEditor();
      initKinshipViewer();
      document.getElementById('kinshipBtn').style.display = 'inline-block';
      return;
    } catch { /* family.json missing/invalid, fall through to password flow */ }
  }

  const cached = cacheGet(PASSWORD_KEY);
  if (cached) {
    try {
      await tryUnlock(cached);
      return;
    } catch {
      cacheRemove(PASSWORD_KEY);
    }
  }

  document.getElementById('passwordInput').focus();
}

main();
