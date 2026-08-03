# Host: GitHub Pages

Static Vite build. No backend.

## Live URL

- https://samsoncyber.github.io/
- Repo: https://github.com/SamsonCyber/SamsonCyber.github.io

Deploy is automatic on push to `main` (`.github/workflows/pages.yml`).

## Local build

```bash
cd portfolio
npm install
npm run build
npx vite preview --host 127.0.0.1 --port 4173
```

Do not open `dist/index.html` via `file://`.

## Do not commit

- `secrets/`, `.env*`, `exports/`, `.agent-canary/`, `node_modules/`, `dist/`
