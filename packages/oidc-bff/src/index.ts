import { createHash, randomBytes } from "node:crypto";
import * as oidc from "openid-client";
import type { SessionStore } from "./store.js";
export type {
  SessionStore,
  LoginTransaction,
  IdentitySession,
} from "./store.js";

export interface BrowserIdentityOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  origin: string;
  returnPaths: readonly string[];
}
const SESSION = "__Host-arcana-session";
const LOGIN = "__Host-arcana-login";
const random = () => randomBytes(32).toString("base64url");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const validHandle = (value: string | null): value is string =>
  value !== null && /^[A-Za-z0-9_-]{43}$/.test(value);

function cookie(request: Request, name: string): string | null {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : null;
}
function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
function response(
  status: number,
  body: object | null,
  cookies: string[] = [],
  location?: string,
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  if (location) headers.set("Location", location);
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers,
  });
}
function secureOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.href !== `${url.origin}/`
  ) {
    throw new Error("An exact HTTPS origin is required");
  }
  return url;
}

/** No authentication bypass, password storage, implicit grants, or memory store fallback. */
export class BrowserIdentity {
  private constructor(
    private readonly config: oidc.Configuration,
    private readonly options: BrowserIdentityOptions,
    private readonly store: SessionStore,
  ) {}

  static async connect(
    options: BrowserIdentityOptions,
    store: SessionStore,
  ): Promise<BrowserIdentity> {
    const issuer = secureOrigin(options.issuer);
    const origin = secureOrigin(options.origin);
    if (
      !options.clientId ||
      !options.clientSecret ||
      !options.returnPaths.length
    )
      throw new Error("Missing identity configuration");
    for (const path of options.returnPaths) {
      const target = new URL(path, origin);
      if (
        !path.startsWith("/") ||
        path.startsWith("//") ||
        target.origin !== origin.origin ||
        target.pathname !== path
      ) {
        throw new Error("Return paths must be exact same-origin paths");
      }
    }
    const config = await oidc.discovery(
      issuer,
      options.clientId,
      undefined,
      oidc.ClientSecretBasic(options.clientSecret),
      { timeout: 10 },
    );
    const metadata = config.serverMetadata();
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.jwks_uri,
      metadata.userinfo_endpoint,
    ]) {
      if (!endpoint || new URL(endpoint).origin !== issuer.origin)
        throw new Error("Unexpected identity endpoint");
    }
    if (!metadata.code_challenge_methods_supported?.includes("S256"))
      throw new Error("S256 is required");
    // Code-flow ID tokens require explicit signature validation as well as TLS.
    oidc.enableNonRepudiationChecks(config);
    return new BrowserIdentity(
      config,
      {
        ...options,
        origin: origin.origin,
        returnPaths: [...options.returnPaths],
      },
      store,
    );
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== this.options.origin)
      return response(400, { error: "invalid_origin" });
    try {
      if (url.pathname === "/api/auth/login" && request.method === "GET")
        return await this.login(request, url);
      if (url.pathname === "/api/auth/callback" && request.method === "GET")
        return await this.callback(request, url);
      if (url.pathname === "/api/auth/session" && request.method === "GET")
        return await this.session(request);
      if (url.pathname === "/api/auth/logout" && request.method === "POST")
        return await this.logout(request);
      return response(404, { error: "not_found" });
    } catch {
      // Upstream responses, tokens, authorization codes and exception text never enter browser output.
      return response(503, { error: "identity_unavailable" });
    }
  }

  private async login(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return response(403, { error: "invalid_origin" });
    const returnPath =
      url.searchParams.get("return") ?? this.options.returnPaths[0]!;
    if (!this.options.returnPaths.includes(returnPath))
      return response(400, { error: "invalid_return" });
    // Presentation hint only: never a return URL, audience, scope or authority.
    const locales = url.searchParams.getAll("locale");
    if (
      locales.length > 1 ||
      locales.some((value) => value !== "en" && value !== "ru")
    )
      return response(400, { error: "invalid_locale" });
    const locale = locales[0] ?? "en";
    const previousBrowser = cookie(request, LOGIN);
    if (validHandle(previousBrowser))
      await this.store.cancelBrowserLogin(hash(previousBrowser));
    const browser = random();
    const transaction = {
      state: random(),
      browserHash: hash(browser),
      verifier: oidc.randomPKCECodeVerifier(),
      nonce: oidc.randomNonce(),
      returnPath,
      expiresAt: Date.now() + 300_000,
    };
    await this.store.putTransaction(transaction);
    const target = oidc.buildAuthorizationUrl(this.config, {
      redirect_uri: `${this.options.origin}/api/auth/callback`,
      scope: "openid profile",
      ui_locales: locale,
      response_type: "code",
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(
        transaction.verifier,
      ),
      code_challenge_method: "S256",
    });
    return response(303, null, [setCookie(LOGIN, browser, 300)], target.href);
  }

  private async callback(request: Request, url: URL): Promise<Response> {
    const state = url.searchParams.get("state");
    const browser = cookie(request, LOGIN);
    const clear = setCookie(LOGIN, "", 0);
    if (
      !validHandle(state) ||
      !validHandle(browser) ||
      url.searchParams.getAll("state").length !== 1
    ) {
      return response(400, { error: "invalid_login" }, [clear]);
    }
    const transaction = await this.store.consumeTransaction(
      state,
      hash(browser),
      Date.now(),
    );
    if (
      !transaction ||
      transaction.state !== state ||
      transaction.browserHash !== hash(browser) ||
      transaction.expiresAt <= Date.now()
    ) {
      return response(400, { error: "invalid_login" }, [clear]);
    }
    try {
      const tokens = await oidc.authorizationCodeGrant(this.config, url, {
        pkceCodeVerifier: transaction.verifier,
        expectedState: state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (
        !claims ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          claims.sub,
        )
      ) {
        throw new Error("Invalid canonical subject");
      }
      const now = Date.now();
      const lifetime = Math.min(
        900,
        tokens.expires_in ?? 300,
        claims.exp - Math.floor(now / 1000),
      );
      if (!Number.isFinite(lifetime) || lifetime <= 0)
        throw new Error("Expired identity");
      const id = random();
      const previous = cookie(request, SESSION);
      const completed = await this.store.finishLogin(
        state,
        hash(browser),
        Date.now(),
        validHandle(previous) ? previous : null,
        id,
        {
          subject: claims.sub,
          accessToken: tokens.access_token,
          expiresAt: now + lifetime * 1000,
        },
      );
      if (!completed) throw new Error("Login cancelled");
      return response(
        303,
        null,
        [clear, setCookie(SESSION, id, Math.floor(lifetime))],
        transaction.returnPath,
      );
    } catch {
      return response(400, { error: "invalid_login" }, [clear]);
    }
  }

  private async session(request: Request): Promise<Response> {
    const id = cookie(request, SESSION);
    if (!validHandle(id)) return response(401, { authenticated: false });
    const current = await this.store.getSession(id, Date.now());
    if (!current || current.expiresAt <= Date.now())
      return response(401, { authenticated: false }, [
        setCookie(SESSION, "", 0),
      ]);
    try {
      await oidc.fetchUserInfo(
        this.config,
        current.accessToken,
        current.subject,
      );
    } catch {
      await this.store.deleteSession(id);
      return response(401, { authenticated: false }, [
        setCookie(SESSION, "", 0),
      ]);
    }
    const rechecked = await this.store.getSession(id, Date.now());
    if (
      !rechecked ||
      rechecked.subject !== current.subject ||
      rechecked.expiresAt <= Date.now()
    )
      return response(401, { authenticated: false });
    return response(200, { authenticated: true, subject: current.subject });
  }

  private async logout(request: Request): Promise<Response> {
    if (request.headers.get("origin") !== this.options.origin)
      return response(403, { error: "invalid_origin" });
    const id = cookie(request, SESSION);
    const browser = cookie(request, LOGIN);
    if (validHandle(browser))
      await this.store.cancelBrowserLogin(hash(browser));
    if (validHandle(id)) await this.store.deleteSession(id);
    return response(200, { authenticated: false }, [
      setCookie(SESSION, "", 0),
      setCookie(LOGIN, "", 0),
    ]);
  }
}
