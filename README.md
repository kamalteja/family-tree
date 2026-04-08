# Family Tree

An interactive family tree viewer and editor with **Telugu kinship labels**. Select any person as the "principal" and every other member's relationship is dynamically computed using a state-machine engine that understands age, gender, maternal/paternal side, and in-law contexts.

Deployed to GitHub Pages as a fully static site — no backend required. All data is AES-256-GCM encrypted at rest; a password is required to view the tree in the browser.

## Features

- **Dynamic Telugu relationship labels** — computed relative to whichever person you select as principal (e.g. anna, mamayya, attaiah, peddamma, bava, maridhi, ...)
- **Kinship traversal path** — each card shows the Telugu derivation path below the relationship name (e.g. `nenu ›parent› nanna ›sibling› anna`)
- **State equivalences** — compound kinship states (e.g. peddananna) inherit transitions from their base state (e.g. nanna), reducing the number of explicit rules needed
- **Two views** — *Principal View* (centered on one person) and *Full Tree* (expands to the oldest ancestor in that lineage)
- **Hidden relatives indicator** — nodes with relatives not shown in the current view display a mini-tree marker
- **Interactive visualization** — zoom, pan, hover-to-trace path to principal, powered by [family-chart](https://github.com/nicehero/family-chart)
- **Search** — floating search bar (`Ctrl+F` / `⌘F`) to find and navigate to any person in the tree
- **Member count** — total family members displayed in the toolbar
- **Dark / light theme** toggle
- **In-browser editor** — add, edit, and delete family members with bidirectional relationship syncing
- **Data quality panel** — highlights people with missing attributes (name, gender, birthday) alongside the editor
- **JSON diff viewer** — inline green/red diff view for inspecting changes before saving
- **Propose Changes** — create a GitHub pull request directly from the editor with local edits, authenticated via a GitHub App
- **Export / Import** — copy or download the current family data as JSON; edit raw JSON directly in a modal
- **localStorage persistence** — editor changes survive page reloads; principal person selection is cached across sessions
- **Avatars** — person photos stored encrypted alongside the data
- **Encryption** — all data files and avatars are encrypted with AES-256-GCM (PBKDF2 key derivation); the browser prompts for a password on load
- **Lock** — clear decrypted data and cached password from the browser with one click
- **Searchable principal dropdown** — custom themed dropdown with type-to-search filtering
- **Themed UI** — custom confirmation modals and toast notifications (no native browser dialogs)

## Project structure

```
family-tree/
├── index.html                  # Single-page app shell
├── package.json
├── vite.config.js              # Vite config (base: /family-tree/)
├── scripts/
│   └── encrypt.js              # Node.js encryption script (AES-256-GCM + PBKDF2)
├── public/
│   ├── avatars/
│   │   └── *.enc               # Encrypted avatar images
│   └── data/
│       ├── *.enc               # Encrypted data files (family, kinship-rules)
│       └── .manifest           # SHA-256 checksums for CI verification
├── src/
│   ├── main.js                 # Entry point, theme, password flow, lock, JSON editor
│   ├── viewer.js               # Chart rendering, principal selector, views
│   ├── editor.js               # Add/edit/delete UI, localStorage, export, propose
│   ├── crypto.js               # Browser-side encrypt/decrypt (Web Crypto API)
│   ├── github.js               # GitHub App JWT auth + Git Data API
│   ├── propose.js              # Propose Changes orchestration (PR creation flow)
│   ├── ui.js                   # Shared UI helpers (confirm modal, toast notifications)
│   ├── kinship.js              # BFS graph traversal, path normalisation, state-machine resolver
│   ├── telugu-terms.js         # Age comparison, fallback label composition
│   ├── diff.js                 # LCS-based line diff algorithm
│   └── styles.css              # All styling, dark/light themes, chart overrides
└── .github/
    └── workflows/
        └── deploy.yml          # CI: verify encryption → build → deploy to Pages
```

## Prerequisites

- **Node.js** >= 24
- **npm**

## Local development

```bash
npm install
npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173/family-tree/`).

In development, if plaintext `.json` files exist in `public/data/`, the app loads them directly without a password. If only `.enc` files exist, the password prompt appears.

## Encryption workflow

All data files (`public/data/*.json`) and avatar images (`public/avatars/*`) are encrypted before commit. Plaintext files are gitignored.

```bash
# Encrypt all data files and avatars (prompts for password)
npm run encrypt
```

This runs `scripts/encrypt.js`, which:

1. Prompts for the **view password** (or uses `ENCRYPT_PASSWORD` env var)
2. Scans `public/data/` for `.json` files (except `app.json`) and `public/avatars/` for images
3. Encrypts each file using AES-256-GCM with a PBKDF2-derived key (100,000 iterations, SHA-256)
4. If `public/data/app.json` exists, prompts for a **propose password** (or uses `PROPOSE_PASSWORD` env var) and encrypts it separately as `app.enc`
5. Writes `.enc` files alongside the originals
6. Generates `public/data/.manifest` with SHA-256 checksums of all encrypted files

Passwords are entered interactively (masked input) or via environment variables.

### Re-encrypting with a new password

Run `npm run encrypt` again — it will overwrite all `.enc` files and the manifest with the new password.

## Production build

```bash
npm run build     # outputs to dist/
npm run preview   # preview the production build locally
```

## Deploy to GitHub Pages

Deployment is automated via GitHub Actions on every push to `main`.

### CI pipeline

The workflow (`.github/workflows/deploy.yml`) runs three jobs:

1. **verify-encryption** — checks that `public/data/` and `public/avatars/` contain only `.enc` files, and verifies SHA-256 checksums against `.manifest`
2. **npm-build** — runs `npm ci` and `npm run build`
3. **deploy-to-github-pages** — deploys the `dist/` artifact (only on `main`)

### One-time GitHub setup

1. Go to **Settings → Pages** in your GitHub repo.
2. Under **Source**, select **GitHub Actions**.
3. Push to `main` — the workflow builds and deploys automatically.
4. Your site will be available at `https://<username>.github.io/family-tree/`.

## Data files

### `public/data/family.json`

Array of person objects:

```json
{
  "id": "kamal_teja_gurramkonda_66kf",
  "data": {
    "first name": "Kamal Teja",
    "last name": "Gurramkonda",
    "gender": "M",
    "birthday": "1993-03-29",
    "avatar": "kamal.png"
  },
  "rels": {
    "spouses": ["tanvi_gurramkonda_a3b2"],
    "parents": ["ramanaiah_gurramkonda_x1y2", "sreedevi_gurramkonda_z3w4"],
    "children": []
  }
}
```

- `id` — unique string in the format `firstname_lastname_4randomchars`
- `gender` — `"M"` or `"F"`
- `birthday` — `YYYY-MM-DD` format (used for age-dependent kinship rules)
- `avatar` — filename in `public/avatars/` (optional); stored encrypted as `filename.enc`
- `rels` — arrays of IDs; all relationships must be **bidirectional** (if A lists B as a parent, B must list A as a child)

### `public/data/kinship-rules.json`

Defines the state machine for relationship resolution:

- **`states`** — each state has Telugu and English labels (e.g. `"mamayya": { "te": "mamayya", "en": "father-in-law" }`)
- **`equivalences`** — maps compound states to their base state for transition inheritance (e.g. `"peddananna": "nanna"` means peddananna inherits nanna's transitions when no explicit rule exists). The resolver follows the equivalence chain up to `MAX_EQUIVALENCE_DEPTH` (5) levels deep.
- **`transitions`** — rules of the form `{ from, hop, gender, age, to }` where:
  - `hop` is `"parent"`, `"child"`, `"spouse"`, or `"sibling"`
  - `gender` is `"M"` or `"F"`
  - `age` is `"elder"`, `"younger"`, or `null` (any)

The engine walks BFS shortest paths, normalises sibling patterns (`parent→child` to `sibling`), and resolves each hop through the state machine. When no direct transition matches, the equivalence chain is consulted. If that also fails, a fallback label is composed (e.g. "mamayya brother").

### Adding new kinship rules

To teach the engine a new relationship:

1. Add a **state** entry with the Telugu and English terms.
2. Add one or more **transition** rules specifying how to reach that state from an existing one.
3. Optionally, add an **equivalence** entry if the new state should inherit transitions from an existing base state (e.g. a new uncle-type state equivalent to `nanna`).
4. Re-encrypt (`npm run encrypt`) and refresh — no code changes needed.

## Avatars

Place image files (PNG, JPG, WebP, GIF) in `public/avatars/`. Set the `avatar` field in `family.json` to the filename. Run `npm run encrypt` to encrypt them. Images are decrypted in the browser and displayed as circular thumbnails on each card.

## Propose Changes (PR from the browser)

Family members with the **propose password** can create a GitHub pull request directly from the editor — no git knowledge needed.

### How it works

1. Click **Propose Changes** in edit mode (button appears when local edits exist).
2. Enter the **propose password** (cached in localStorage, separate from the view password).
3. Enter your **name** for attribution in the PR.
4. The app encrypts the modified data in the browser, authenticates as a GitHub App, creates a branch, and opens a PR.
5. The repo owner reviews and merges the PR.

### Two-password access control

| Password | Decrypts | Who gets it |
|----------|----------|-------------|
| View (A) | Family data, kinship rules, avatars | All family members |
| Propose (B) | GitHub App credentials (`app.enc`) | Trusted editors only |

View-only users can browse the tree and make local edits but cannot create PRs.

## Editor workflow

1. Click **Edit** in the toolbar to open the side panel.
2. Add or edit people using the form; changes are saved to **localStorage** automatically.
3. Click **Data Quality** to open a companion panel listing people with missing attributes (first name, last name, gender, birthday). Click any person to jump to their edit form.
4. Use **Export JSON** to copy or download the current data.
5. Use the **{ }** button to view a diff of your changes vs. the original file, or edit raw JSON directly.
6. Use the **reset** button to discard all localStorage changes and reload from the original encrypted data.
7. Use the **lock** button to clear decrypted data and the cached password, returning to the password prompt. If you have unsaved edits, you'll be asked to confirm.

## License

Private — not open-sourced.
