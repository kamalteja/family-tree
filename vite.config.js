import { defineConfig } from 'vite';

/** GitHub Pages: set BASE_URL=/family-tree. Cloudflare Pages / local: omit or BASE_URL=/ */
function publicBase() {
  const raw = process.env.BASE_URL;
  if (raw === undefined || raw === '' || raw === '/') return '/';
  const lead = raw.startsWith('/') ? raw : `/${raw}`;
  return lead.endsWith('/') ? lead : `${lead}/`;
}

export default defineConfig({
  base: publicBase(),
  build: {
    outDir: 'dist',
  },
});
