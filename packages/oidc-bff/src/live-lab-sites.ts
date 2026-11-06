/**
 * Live Lab site client profiles (KCLIVE-02).
 *
 * Rematches Auth Arcana + external-sites standard + existing BrowserIdentity BFF.
 * Client IDs, secrets and exact HTTPS acceptance mounts are NOT invented here —
 * they must be supplied from Auth-owner confirmed registration (env / secret store).
 */

/** Mirrors BrowserIdentityOptions without importing the session class (cycle-free). */
export interface LiveLabBrowserIdentityOptions {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly origin: string;
  readonly returnPaths: readonly string[];
}

export const LIVE_LAB_SITES = ["contract-place", "arcanada-ai"] as const;
export type LiveLabSiteId = (typeof LIVE_LAB_SITES)[number];

export interface LiveLabSiteProfile {
  readonly siteId: LiveLabSiteId;
  /** Public product origin once registered (exact HTTPS, trailing slash only as origin `/`). */
  readonly productOriginHint: string;
  /** Native lab route(s) for return-path allowlist once the site mounts the BFF. */
  readonly labReturnPaths: readonly string[];
  /** Env keys the integrator must bind — values never committed. */
  readonly env: {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly origin: string;
  };
}

/**
 * Non-secret integration skeleton for both Live Lab site clients.
 * Product origins are programme targets; acceptance-mount origin may differ until KCLIVE-19.
 */
export const LIVE_LAB_SITE_PROFILES: readonly LiveLabSiteProfile[] = [
  {
    siteId: "contract-place",
    productOriginHint: "https://contract.place/",
    labReturnPaths: [
      "/en/lab/knowledge-journey/",
      "/ru/lab/knowledge-journey/",
      "/zh-Hans/lab/knowledge-journey/",
    ],
    env: {
      issuer: "LIVE_LAB_CONTRACT_PLACE_AUTH_ISSUER_URL",
      clientId: "LIVE_LAB_CONTRACT_PLACE_AUTH_CLIENT_ID",
      clientSecret: "LIVE_LAB_CONTRACT_PLACE_AUTH_CLIENT_SECRET",
      origin: "LIVE_LAB_CONTRACT_PLACE_AUTH_ORIGIN",
    },
  },
  {
    siteId: "arcanada-ai",
    productOriginHint: "https://arcanada.ai/",
    labReturnPaths: ["/en/lab/agent-runs", "/ru/lab/agent-runs"],
    env: {
      issuer: "LIVE_LAB_ARCANADA_AI_AUTH_ISSUER_URL",
      clientId: "LIVE_LAB_ARCANADA_AI_AUTH_CLIENT_ID",
      clientSecret: "LIVE_LAB_ARCANADA_AI_AUTH_CLIENT_SECRET",
      origin: "LIVE_LAB_ARCANADA_AI_AUTH_ORIGIN",
    },
  },
] as const;

export interface LiveLabSiteEnv {
  readonly [key: string]: string | undefined;
}

export type LoadLiveLabSiteResult =
  | {
      readonly ok: true;
      readonly options: LiveLabBrowserIdentityOptions;
      readonly siteId: LiveLabSiteId;
    }
  | {
      readonly ok: false;
      readonly siteId: LiveLabSiteId;
      readonly missing: readonly string[];
      readonly reason: "missing_env";
    };

function requireHttpsOrigin(raw: string, label: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.href !== `${url.origin}/`
  ) {
    throw new Error(`${label} must be an exact HTTPS origin`);
  }
  return url.origin;
}

/**
 * Load BrowserIdentity options for one Live Lab site from env.
 * Returns missing_env (not invented defaults) when Auth-owner registration is absent.
 */
export function loadLiveLabSiteOptions(
  siteId: LiveLabSiteId,
  env: LiveLabSiteEnv = process.env,
): LoadLiveLabSiteResult {
  const profile = LIVE_LAB_SITE_PROFILES.find((p) => p.siteId === siteId);
  if (!profile) {
    throw new Error(`Unknown Live Lab site: ${siteId}`);
  }
  const missing: string[] = [];
  const issuerRaw = env[profile.env.issuer]?.trim();
  const clientId = env[profile.env.clientId]?.trim();
  const clientSecret = env[profile.env.clientSecret]?.trim();
  const originRaw = env[profile.env.origin]?.trim();
  if (!issuerRaw) missing.push(profile.env.issuer);
  if (!clientId) missing.push(profile.env.clientId);
  if (!clientSecret) missing.push(profile.env.clientSecret);
  if (!originRaw) missing.push(profile.env.origin);
  if (missing.length > 0) {
    return { ok: false, siteId, missing, reason: "missing_env" };
  }
  const issuer = requireHttpsOrigin(issuerRaw!, profile.env.issuer);
  const origin = requireHttpsOrigin(originRaw!, profile.env.origin);
  return {
    ok: true,
    siteId,
    options: {
      issuer,
      clientId: clientId!,
      clientSecret: clientSecret!,
      origin,
      returnPaths: [...profile.labReturnPaths],
    },
  };
}

/** Non-secret inventory for receipts (never includes secrets or invented client ids). */
export function liveLabSiteInventory(): readonly {
  siteId: LiveLabSiteId;
  productOriginHint: string;
  labReturnPaths: readonly string[];
  envKeys: LiveLabSiteProfile["env"];
}[] {
  return LIVE_LAB_SITE_PROFILES.map((p) => ({
    siteId: p.siteId,
    productOriginHint: p.productOriginHint,
    labReturnPaths: p.labReturnPaths,
    envKeys: p.env,
  }));
}
