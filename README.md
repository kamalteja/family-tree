# Family Tree

An interactive family tree viewer and editor with **Telugu kinship labels**. Select any person as the "principal" and every other member's relationship is dynamically computed using a state-machine engine that understands age, gender, maternal/paternal side, and in-law contexts.

Deployed to GitHub Pages as a fully static site — no backend required.

## Features

- **Dynamic Telugu & English relationship labels** — computed relative to whichever person you select as principal (e.g. anna, mamayya, attaiah, peddamma, bava, maridhi, …)
- **Two views** — *Principal View* (centered on one person) and *Full Tree* (expands to the oldest ancestor in that lineage)
- **Interactive visualization** — zoom, pan, hover-to-trace parent lines, powered by [family-chart](https://github.com/nicehero/family-chart)
- **Dark / light theme** toggle
- **In-browser editor** — add, edit, and delete family members with bidirectional relationship syncing
- **JSON diff viewer** — inline green/red diff view for inspecting changes before saving
- **Export / Import** — copy or download the current family data as JSON; edit raw JSON directly in a modal
- **localStorage persistence** — editor changes survive page reloads; reset button to revert to the original data file
- **Avatars** — drop a photo into `public/avatars/` and set the `avatar` field in the JSON

## Project structure

```
family-tree/
├── index.html                  # Single-page app shell
├── package.json
├── vite.config.js              # Vite config (base: /family-tree/)
├── public/
│   ├── avatars/                # Person photos (e.g. kamal.png)
│   └── data/
│       ├── family.json         # Family members and relationships
│       └── kinship-rules.json  # State-machine: states + transitions
├── src/
│   ├── main.js                 # Entry point, theme, info modal, JSON editor
│   ├── viewer.js               # Chart rendering, principal selector, views
│   ├── editor.js               # Add/edit/delete UI, localStorage, export
│   ├── kinship.js              # BFS graph traversal, path normalisation, state-machine resolver
│   ├── telugu-terms.js         # Age comparison, fallback label composition
│   ├── diff.js                 # LCS-based line diff algorithm
│   └── styles.css              # All styling, dark/light themes, chart overrides
└── .github/
    └── workflows/
        └── deploy.yml          # GitHub Actions: build → deploy to Pages
```

## Prerequisites

- **Node.js** ≥ 18 (20 recommended)
- **npm**

## Local development

```bash
# Install dependencies
npm install

# Start the dev server (hot reload)
npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173/family-tree/`).

## Production build

```bash
npm run build     # outputs to dist/
npm run preview   # preview the production build locally
```

## Deploy to GitHub Pages

Deployment is automated via GitHub Actions on every push to `main`.

### One-time GitHub setup

1. Go to **Settings → Pages** in your GitHub repo.
2. Under **Source**, select **GitHub Actions**.
3. Push to `main` — the workflow (`.github/workflows/deploy.yml`) builds and deploys automatically.
4. Your site will be available at `https://<username>.github.io/family-tree/`.

## Data files

### `public/data/family.json`

Array of person objects:

```json
{
  "id": "kamal",
  "data": {
    "first name": "Kamal Teja",
    "last name": "Gurramkonda",
    "gender": "M",
    "birthday": "1993-03-29",
    "avatar": "kamal.png"
  },
  "rels": {
    "spouses": ["tanvi"],
    "parents": ["ramanaiah", "sreedevi"],
    "children": []
  }
}
```

- `id` — unique string identifier
- `gender` — `"M"` or `"F"`
- `birthday` — `YYYY-MM-DD` format (used for age-dependent kinship rules)
- `avatar` — filename in `public/avatars/` (optional)
- `rels` — arrays of IDs; all relationships must be **bidirectional** (if A lists B as a parent, B must list A as a child)

### `public/data/kinship-rules.json`

Defines the state machine for relationship resolution:

- **`states`** — each state has an English and Telugu label (e.g. `"mamayya": { "en": "father-in-law", "te": "mamayya" }`)
- **`transitions`** — rules of the form `{ from, hop, gender, age, to }` where:
  - `hop` is `"parent"`, `"child"`, `"spouse"`, or `"sibling"`
  - `gender` is `"M"` or `"F"`
  - `age` is `"elder"`, `"younger"`, or `null` (any)

The engine walks BFS shortest paths, normalises sibling patterns (`parent→child` to `sibling`), and resolves each hop through the state machine. When no transition matches, a fallback label is composed (e.g. "mamayya brother").

### Adding new kinship rules

To teach the engine a new relationship:

1. Add a **state** entry with the English and Telugu terms.
2. Add one or more **transition** rules specifying how to reach that state from an existing one.
3. Refresh the page — no code changes needed.

## Avatars

Place image files (PNG, JPG) in `public/avatars/`. Set the `avatar` field in `family.json` to the filename. Images are displayed as circular thumbnails on each card.

## Editor workflow

1. Click **Edit** in the toolbar to open the side panel.
2. Add or edit people using the form; changes are saved to **localStorage** automatically.
3. Use **Export JSON** to copy or download the current data.
4. Use the **{ }** button to view a diff of your changes vs. the original file, or edit raw JSON directly.
5. Use the **↻** button to discard all localStorage changes and reload from `family.json`.

## License

Private — not open-sourced.
