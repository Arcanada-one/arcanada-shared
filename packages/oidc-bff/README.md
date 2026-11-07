# OIDC browser identity BFF

Server-side authorization-code login through the configured Auth Arcana issuer.
The package uses openid-client 6.8.8 for discovery, S256, token validation and
explicit JWKS signature verification. It never implements account registration,
passwords, provider federation or personal data authorization.

`BrowserIdentity.connect(options, store)` returns a Fetch Request/Response
handler for `/api/auth/login`, `/api/auth/callback`, `/api/auth/session` and
POST `/api/auth/logout`. Mount it behind the application's HTTPS origin;
construct request URLs from trusted server configuration, never an unchecked
Host or Forwarded header. Preserve every Set-Cookie header. Add the ecosystem's
HTTP security headers and apply per-IP/session rate limiting at ingress.

Configuration is server-only. Supply the client secret from protected host
storage. Measure the active issuer via Auth-owner discovery (do not copy an
unverified README hostname): Live Lab rematch measured both
`https://auth.arcanada.ai` and `https://auth.arcanada.one` discovery documents;
mandate + Control prod compose name `.ai`. Site clients are distinct —
Organize Me (`arganize_me_prod` / `https://arganize.me`) is a reference
consumer, not a Live Lab client to copy. For Live Lab use
`loadLiveLabSiteOptions('contract-place' | 'arcanada-ai', env)` which fails
closed until Auth-owner env keys are bound. Identity scopes remain
`openid profile`.

`authorizeScoped` enforces project/object/action grants for lab commands,
snapshots, event subscriptions and downloads. An authenticated subject with
zero grants is denied (`grant_required`). Cross-project access is refused with
a redacted reason that does not disclose foreign object existence.
Revocation/logout uses `revokePrincipal`.

The mandatory store has no permissive or in-memory default. Implement all
atomic transaction consumption, cancellation and finalization rules before
mounting. Bound transaction/session counts and TTLs, encrypt token storage,
protect its connection and implement crash recovery. Cancellation must cover
consumed but unfinished transactions so logout fences an in-flight callback.
Store failures deny access. Only synthetic tests use the included test store.

Opaque Secure HttpOnly host cookies identify server records. ID/access tokens
never go to browser storage. Every session query checks current provider
userinfo and exact subject, then checks the local record again. Session lifetime
is capped at 15 minutes and token expiry. Local logout invalidates the cabinet
session and pending login; it does not terminate the user's ecosystem account
or every other product session. No refresh token is requested.

## Delivery boundary

This is an unpublished private package candidate. A production durable store,
actual HTTPS mount, bounded ingress, Auth client provisioning and synthetic
browser proof against the actual provider are still required. Its subject-only
response is identity evidence, never a personal record/storage/graph grant.
Other product endpoints must use their current Auth authorization boundary.

Source API reference: https://github.com/panva/openid-client/tree/main/docs
