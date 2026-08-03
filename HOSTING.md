# Host: GitHub Pages + samsoncyber.com

Static Vite build. No backend.

## Live URLs

- Custom domain: https://samsoncyber.com/
- GitHub Pages fallback: https://samsoncyber.github.io/
- Repo: https://github.com/SamsonCyber/SamsonCyber.github.io

Deploy is automatic on push to `main` (`.github/workflows/pages.yml`).

## Local build

```bash
cd portfolio
npm install
npm test
npm run build
npx vite preview --host 127.0.0.1 --port 4173
```

Do not open `dist/index.html` via `file://`.

## DNS (GoDaddy or registrar)

Apex currently parks on GoDaddy IPs until you change records.

Set these for `samsoncyber.com`:

| Type  | Name | Value                 | TTL  |
|-------|------|-----------------------|------|
| A     | @    | 185.199.108.153       | 600  |
| A     | @    | 185.199.109.153       | 600  |
| A     | @    | 185.199.110.153       | 600  |
| A     | @    | 185.199.111.153       | 600  |
| CNAME | www  | SamsonCyber.github.io | 600  |

Optional IPv6 (AAAA @):

- `2606:50c0:8000::153`
- `2606:50c0:8001::153`
- `2606:50c0:8002::153`
- `2606:50c0:8003::153`

Remove old A records pointing at `3.33.130.190` / `15.197.148.33` (parking).

After DNS propagates:

1. Repo → Settings → Pages → Custom domain: `samsoncyber.com`
2. Wait for DNS check to pass
3. Enable **Enforce HTTPS**

`public/CNAME` ships `samsoncyber.com` into every build.

## Do not commit

- `secrets/`, `.env*`, `exports/`, `.agent-canary/`, `node_modules/`, `dist/`
