# Persistent Google Drive sync — implementation plan (draft)

Status: DESIGN ONLY. Do not deploy a backend or switch the live app until credentials, domains, consent and tests are approved.

## Existing implementation
- React/Vite static GitHub Pages frontend, Dexie IndexedDB.
- GIS browser token client obtains short-lived access token in memory; no refresh token.
- Drive scope: `https://www.googleapis.com/auth/drive.file`.
- Existing sync engine compares local/remote SHA-256 snapshot with a browser-local baseline; creates recovery copies before remote replacement.
- Browser refresh loses token; silent GIS request opened an account chooser in Firefox.

## Architecture and prerequisites
1. Deploy a server-side OAuth 2.0 **authorization code** flow with PKCE and a confidential Google Web client. The client secret must be a server secret only, never in Vite, GitHub, workflow logs or public repository.
2. Backend stores per-user Google refresh tokens encrypted at rest using an authenticated encryption key from a managed secret store. Rotate tokens atomically on refresh and revoke/delete on disconnect.
3. Browser receives a narrowly scoped opaque application session cookie, HttpOnly, Secure. Use CSRF protection, strict origin validation, OAuth state and PKCE verification, session expiry and rotation, and explicit account identity binding.
4. **Cross-site cookies caveat:** a GitHub Pages origin (`privat24-02.github.io`) and an unrelated API domain are cross-site. Firefox and Safari may block third-party cookies even with SameSite=None. Prefer serving app and API under the **same registrable custom domain** (e.g. app.example.com and api.example.com) with CORS allowlist and SameSite=Lax where feasible. Do not promise background login until verified on Firefox and iOS Safari. An alternative is a same-origin reverse proxy / app host.
5. Backend exposes minimal authenticated endpoints: `GET /auth/google/start`, `GET /auth/google/callback`, `GET /session`, `POST /session/logout`, `POST /drive/sync` or narrowly scoped Drive file operations. Never return Google refresh tokens to JavaScript. Rate limit and audit security-relevant operations.
6. Choose a backend host and durable encrypted session/token storage after pricing and availability review; no provider has been selected. GitHub Pages alone cannot safely hold a confidential OAuth client or refresh tokens.

## Safe migration
- Keep current browser-token mode working until the new backend passes tests.
- Add an opt-in `VITE_SYNC_AUTH_MODE=server` feature flag (not yet enabled); no automatic switch.
- Before any cloud write, preserve current backup and validate ownership/account identity. Existing per-browser baseline is **not** a cross-device lock; add server-side optimistic concurrency (Drive revision/ETag or equivalent) to avoid lost updates.
- Do not auto-replace an existing local library when account changes. Require explicit confirmation for destructive conflict resolution.
- Provide JSON export and a recovery plan before switching modes.

## Security and acceptance tests
- No client secret or refresh token in repo, frontend bundles, localStorage, logs, URLs, or network responses to browser.
- OAuth state mismatch, PKCE failure, CSRF, expired session, revoked token, different account and third-party-cookie-blocking fail safely.
- Firefox desktop and Safari iOS: reload, close/reopen, session renewal, logout, token revocation, two-device edits, offline edits, concurrent writes, Drive recovery copies.
- Browser and CI tests must pass before enabling `server` mode.
- Never merge to main or deploy changes to production without user approval.

## Setup inputs required from owner
- Hosting/provider preference and approved budget (including possible custom domain).
- A server-side Google OAuth Web client with authorized redirect URI once backend URL is known.
- Server secret and encryption key configured directly in provider dashboard; **never send secrets in chat**.
- Approval for any paid service or DNS changes.

## Costs
- Current GitHub Pages static frontend can remain free under applicable GitHub limits.
- Backend, durable token/session store and custom domain may incur charges. Exact cost depends on provider, usage and plan; do not assume free hosting or quote unverified prices.
