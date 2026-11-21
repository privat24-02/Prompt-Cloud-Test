# Cloudflare OAuth backend (not deployed)

This is an **opt-in prototype**, isolated from the currently deployed GitHub Pages app.
The current browser Google Drive mode remains active; the frontend has **not** been switched to this backend.

## Intended free-tier stack
- Cloudflare Workers with static assets on the **same origin** as API routes.
- Cloudflare D1 for OAuth flow state and encrypted refresh-token/session records.
- Google OAuth Web application (authorization code + PKCE).

## Before any deployment
1. Review Cloudflare Workers and D1 free-plan quotas, limits, data processing terms, and whether account setup requires a payment method.
2. Create a D1 database; add its actual ID to `wrangler.toml` and apply `schema.sql`.
3. Configure Worker secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (32 random bytes encoded as base64). Set `PUBLIC_ORIGIN` to the **exact** HTTPS origin of the deployed Worker.
4. Add the exact redirect `https://YOUR-WORKER-ORIGIN/api/auth/google/callback` to the Google Cloud OAuth Web client.
5. Test on a separate preview origin and explicitly enable server mode in the frontend only after the integration is implemented and tested. **No secrets belong in GitHub.**
6. The current Google Drive sync library still uses browser tokens. A future guarded frontend integration must translate its Drive operations to the allowlisted `/api/drive` proxy, bind sync baselines to verified Google account identity, and test concurrent edits before activation.

## Security notes / limitations
- Session is a Secure HttpOnly SameSite=Lax cookie, expires after 30 days; OAuth state is single-use in D1.
- Google refresh token encrypted at rest via AES-GCM; encryption key must remain in Worker secrets.
- The backend rejects cross-origin POST/PATCH, unknown Drive operations, and malformed OAuth state.
- **Not production-ready** until independent security review and automated negative tests. Current proxy has a 20 MiB request limit, so large image backups need chunking or a different upload design.
- A session does not guarantee indefinite access: user revocation, Google token policy, account changes, and expired sessions require reauthorization.
- No payment, backend deployment, DNS change, or merge to main was performed by adding these files.
