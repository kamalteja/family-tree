import { initViewer } from './viewer.js';
import { initEditor } from './editor.js';
import { computeDiff } from './diff.js';
import './styles.css';

function initTheme() {
  const saved = localStorage.getItem('family-tree-theme');
  const theme = saved || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);

  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('family-tree-theme', next);
    updateThemeIcon(next);
  });
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('themeToggle');
  btn.innerHTML = theme === 'dark' ? '&#9788;' : '&#9790;';
  btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

function initResetButton() {
  document.getElementById('resetDataBtn').addEventListener('click', () => {
    if (!confirm('Reset to the original family.json data? This will clear all localStorage edits.')) return;
    localStorage.removeItem('family-tree-data');
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

  fetch(import.meta.env.BASE_URL + 'data/family.json')
    .then(r => r.json())
    .then(data => { baseJson = JSON.stringify(data, null, 2); })
    .catch(() => { baseJson = '[]'; });

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
    const stored = localStorage.getItem('family-tree-data');
    let raw = stored || baseJson || '[]';
    try { raw = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* show as-is */ }
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
      localStorage.setItem('family-tree-data', JSON.stringify(parsed));
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

async function main() {
  initTheme();
  initResetButton();
  initJsonEditor();
  initInfoModal();
  await initViewer();
  initEditor();
}

main();
