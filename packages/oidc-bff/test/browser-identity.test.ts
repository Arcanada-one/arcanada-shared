import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserIdentity,
  type IdentitySession,
  type LoginTransaction,
  type SessionStore,
} from "../src/index.js";

// Synthetic test store only. Shipping code has no in-memory fallback.
class TestStore implements SessionStore {
  transactions = new Map<
    string,
    LoginTransaction & { used?: boolean; cancelled?: boolean }
  >();
  sessions = new Map<string, IdentitySession>();
  async putTransaction(t: LoginTransaction) {
    this.transactions.set(t.state, { ...t });
  }
  async consumeTransaction(state: string, browserHash: string, now: number) {
    const t = this.transactions.get(state);
    if (
      !t ||
      t.used ||
      t.cancelled ||
      t.browserHash !== browserHash ||
      t.expiresAt <= now
    )
      return null;
    t.used = true;
    return { ...t };
  }
  async finishLogin(
    state: string,
    browserHash: string,
    now: number,
    previousId: string | null,
    id: string,
    session: IdentitySession,
  ) {
    const t = this.transactions.get(state);
    if (
      !t ||
      !t.used ||
      t.cancelled ||
      t.browserHash !== browserHash ||
      t.expiresAt <= now ||
      this.sessions.has(id)
    )
      return false;
    this.transactions.delete(state);
    if (previousId) this.sessions.delete(previousId);
    this.sessions.set(id, session);
    return true;
  }
  async cancelBrowserLogin(browserHash: string) {
    for (const t of this.transactions.values())
      if (t.browserHash === browserHash) t.cancelled = true;
  }
  async getSession(id: string, now: number) {
    const s = this.sessions.get(id);
    return s && s.expiresAt > now ? { ...s } : null;
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
}
const issuer = "https://identity.example";
const origin = "https://cabinet.example";
const subject = "019926d0-0000-7000-8000-000000000001";
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...key.publicKey.export({ format: "jwk" }),
  kid: "synthetic-signing-key",
  alg: "RS256",
  use: "sig",
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
let nonce = "";
let challenge = "";
let fault = "";
let store: TestStore;
let client: BrowserIdentity;
let afterExchange: (() => Promise<void>) | undefined;
const cookiePair = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))!
    .split(";")[0]!;
const req = (
  path: string,
  cookie?: string,
  method = "GET",
  requestOrigin?: string,
) =>
  new Request(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(requestOrigin ? { origin: requestOrigin } : {}),
    },
  });

beforeEach(async () => {
  nonce = "";
  challenge = "";
  fault = "";
  afterExchange = undefined;
  store = new TestStore();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.includes(".well-known"))
        return json({
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          userinfo_endpoint: `${issuer}/userinfo`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        });
      if (url.pathname === "/jwks") return json({ keys: [jwk] });
      if (url.pathname === "/userinfo") {
        if (fault === "revoked") return new Response("", { status: 401 });
        return json({
          sub:
            fault === "foreign-userinfo"
              ? "019926d0-0000-7000-8000-000000000002"
              : subject,
        });
      }
      if (url.pathname === "/token") {
        const body = new URLSearchParams(String(init?.body));
        expect(
          createHash("sha256")
            .update(body.get("code_verifier")!)
            .digest("base64url"),
        ).toBe(challenge);
        expect(body.get("redirect_uri")).toBe(`${origin}/api/auth/callback`);
        expect(new Headers(init?.headers).get("authorization")).toMatch(
          /^Basic /,
        );
        const now = Math.floor(Date.now() / 1000);
        const payload = {
          iss: issuer,
          aud: "cabinet-test",
          sub: subject,
          iat: now,
          exp: now + 600,
          nonce: fault === "nonce" ? "wrong" : nonce,
        };
        const data = `${b64({ alg: "RS256", kid: jwk.kid })}.${b64(payload)}`;
        const signature = sign(
          "RSA-SHA256",
          Buffer.from(data),
          key.privateKey,
        ).toString("base64url");
        if (afterExchange) await afterExchange();
        return json({
          access_token: "synthetic-access-token",
          token_type: "Bearer",
          expires_in: 600,
          id_token: `${data}.${fault === "signature" ? signature.slice(0, -8) + "AAAAAAAA" : signature}`,
        });
      }
      throw new Error("Unexpected synthetic endpoint");
    }),
  );
  client = await BrowserIdentity.connect(
    {
      issuer,
      origin,
      clientId: "cabinet-test",
      clientSecret: "synthetic-client-secret",
      returnPaths: ["/en/", "/ru/"],
    },
    store,
  );
});
afterEach(() => vi.unstubAllGlobals());

async function begin() {
  const start = await client.handle(req("/api/auth/login?return=/ru/"));
  expect(start.status).toBe(303);
  const authorization = new URL(start.headers.get("location")!);
  nonce = authorization.searchParams.get("nonce")!;
  challenge = authorization.searchParams.get("code_challenge")!;
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  const callback = `/api/auth/callback?code=synthetic-code&state=${authorization.searchParams.get("state")}`;
  return { callback, browser: cookiePair(start, "__Host-arcana-login") };
}

describe("real openid-client code and browser session boundary with synthetic signed issuer", () => {
  it.each([
    ["", "en"],
    ["&locale=en", "en"],
    ["&locale=ru", "ru"],
  ])(
    "forwards only the supported presentation hint %s",
    async (query, locale) => {
      const result = await client.handle(
        req("/api/auth/login?return=/ru/" + query),
      );
      expect(result.status).toBe(303);
      const authorization = new URL(result.headers.get("location")!);
      expect(authorization.searchParams.get("ui_locales")).toBe(locale);
      expect(authorization.searchParams.get("scope")).toBe("openid");
    },
  );
  it.each(["fr", "", "https://foreign.example/", "ru&locale=en"])(
    "rejects unsupported or ambiguous browser locale %s",
    async (locale) => {
      const result = await client.handle(
        req("/api/auth/login?return=/ru/&locale=" + locale),
      );
      expect(result.status).toBe(400);
      expect(await result.json()).toEqual({ error: "invalid_locale" });
      expect(result.headers.get("location")).toBeNull();
    },
  );
  it("completes code/S256/signature validation and exposes only canonical subject", async () => {
    const login = await begin();
    const done = await client.handle(req(login.callback, login.browser));
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/ru/");
    const sessionCookie = cookiePair(done, "__Host-arcana-session");
    expect(done.headers.getSetCookie().join(";")).toContain(
      "Secure; HttpOnly; SameSite=Lax",
    );
    const session = await client.handle(
      req("/api/auth/session", sessionCookie),
    );
    expect(await session.json()).toEqual({ authenticated: true, subject });
    expect(session.headers.get("cache-control")).toBe("no-store");
    expect(
      await (await client.handle(req("/api/auth/session"))).json(),
    ).toEqual({ authenticated: false });
  });
  it.each(["nonce", "signature"])(
    "rejects an invalid %s through the actual OIDC verifier",
    async (mode) => {
      const login = await begin();
      fault = mode;
      expect(
        (await client.handle(req(login.callback, login.browser))).status,
      ).toBe(400);
      expect(store.sessions.size).toBe(0);
    },
  );
  it("rejects callback replay and a different initiating browser", async () => {
    const login = await begin();
    expect(
      (
        await client.handle(
          req(login.callback, "__Host-arcana-login=" + "x".repeat(43)),
        )
      ).status,
    ).toBe(400);
    expect(
      (await client.handle(req(login.callback, login.browser))).status,
    ).toBe(303);
    expect(
      (await client.handle(req(login.callback, login.browser))).status,
    ).toBe(400);
  });
  it("rejects expired state before token exchange", async () => {
    const login = await begin();
    for (const value of store.transactions.values())
      value.expiresAt = Date.now() - 1;
    expect(
      (await client.handle(req(login.callback, login.browser))).status,
    ).toBe(400);
    expect(store.sessions.size).toBe(0);
  });
  it("fences callback finalization when logout occurs during token exchange", async () => {
    const login = await begin();
    afterExchange = async () => {
      expect(
        (
          await client.handle(
            req("/api/auth/logout", login.browser, "POST", origin),
          )
        ).status,
      ).toBe(200);
    };
    expect(
      (await client.handle(req(login.callback, login.browser))).status,
    ).toBe(400);
    expect(store.sessions.size).toBe(0);
  });
  it.each(["revoked", "foreign-userinfo"])(
    "denies and clears a %s session",
    async (mode) => {
      const login = await begin();
      const done = await client.handle(req(login.callback, login.browser));
      fault = mode;
      expect(
        (
          await client.handle(
            req("/api/auth/session", cookiePair(done, "__Host-arcana-session")),
          )
        ).status,
      ).toBe(401);
      expect(store.sessions.size).toBe(0);
    },
  );
  it("rejects foreign logout and an open redirect", async () => {
    expect(
      (
        await client.handle(
          req("/api/auth/logout", undefined, "POST", "https://foreign.example"),
        )
      ).status,
    ).toBe(403);
    expect(
      (await client.handle(req("/api/auth/login?return=//foreign.example/")))
        .status,
    ).toBe(400);
  });
  it("rejects duplicate callback state", async () => {
    const login = await begin();
    expect(
      (
        await client.handle(
          req(login.callback + "&state=duplicate", login.browser),
        )
      ).status,
    ).toBe(400);
  });
});
