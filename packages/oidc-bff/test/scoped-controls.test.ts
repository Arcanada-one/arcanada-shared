import { describe, expect, it } from "vitest";
import {
  authorizeScoped,
  redactedRefusal,
  revokePrincipal,
  type ScopedPrincipal,
} from "../src/scoped-controls.js";
import {
  LIVE_LAB_SITE_PROFILES,
  loadLiveLabSiteOptions,
  liveLabSiteInventory,
} from "../src/live-lab-sites.js";

const subject = "019926d0-0000-7000-8000-000000000001";

const owned: ScopedPrincipal = {
  subject,
  grants: [
    {
      projectId: "proj-alpha",
      objectId: "run-1",
      actions: ["command", "snapshot", "event_subscribe", "download"],
    },
    {
      projectId: "proj-alpha",
      objectId: "art-1",
      actions: ["download", "snapshot"],
    },
  ],
};

describe("scoped controls — identity is not a grant", () => {
  it("denies when principal is missing", () => {
    expect(
      authorizeScoped(null, {
        action: "command",
        projectId: "proj-alpha",
        objectId: "run-1",
      }),
    ).toEqual({ allow: false, code: "unauthenticated" });
  });

  it("denies authenticated subject with empty grants (identity alone)", () => {
    expect(
      authorizeScoped(
        { subject, grants: [] },
        { action: "command", projectId: "proj-alpha", objectId: "run-1" },
      ),
    ).toEqual({ allow: false, code: "grant_required" });
  });

  it("allows owned command/snapshot/event/download within grant", () => {
    for (const action of [
      "command",
      "snapshot",
      "event_subscribe",
      "download",
    ] as const) {
      const decision = authorizeScoped(owned, {
        action,
        projectId: "proj-alpha",
        objectId: "run-1",
      });
      expect(decision.allow).toBe(true);
      if (decision.allow) {
        expect(decision.grant.objectId).toBe("run-1");
      }
    }
  });

  it("rejects unauthorized cross-project reads and commands without disclosing existence", () => {
    const denied = authorizeScoped(owned, {
      action: "download",
      projectId: "proj-foreign",
      objectId: "secret-run",
    });
    expect(denied).toEqual({ allow: false, code: "cross_project_forbidden" });
    expect(JSON.stringify(redactedRefusal("cross_project_forbidden"))).not.toContain(
      "secret-run",
    );
  });

  it("rejects object outside grant in same project and action not granted", () => {
    expect(
      authorizeScoped(owned, {
        action: "command",
        projectId: "proj-alpha",
        objectId: "art-1",
      }),
    ).toEqual({ allow: false, code: "action_forbidden" });
    expect(
      authorizeScoped(owned, {
        action: "download",
        projectId: "proj-alpha",
        objectId: "missing-obj",
      }),
    ).toEqual({ allow: false, code: "object_forbidden" });
  });

  it("rejects unsafe mutation on non-command actions", () => {
    expect(
      authorizeScoped(owned, {
        action: "download",
        projectId: "proj-alpha",
        objectId: "art-1",
        mutates: true,
      }),
    ).toEqual({ allow: false, code: "unsafe_mutation" });
  });

  it("revocation/logout clears grants and refuses subsequent access", () => {
    const revoked = revokePrincipal(owned);
    expect(revoked.grants).toEqual([]);
    expect(revoked.revoked).toBe(true);
    expect(
      authorizeScoped(revoked, {
        action: "snapshot",
        projectId: "proj-alpha",
        objectId: "run-1",
      }),
    ).toEqual({ allow: false, code: "revoked" });
  });
});

describe("Live Lab site profiles — no invented clients", () => {
  it("exposes both programme sites with env key inventory only", () => {
    expect(LIVE_LAB_SITE_PROFILES.map((p) => p.siteId)).toEqual([
      "contract-place",
      "arcanada-ai",
    ]);
    const inventory = liveLabSiteInventory();
    expect(inventory).toHaveLength(2);
    for (const row of inventory) {
      expect(row.envKeys.clientId).toMatch(/^LIVE_LAB_/);
      expect(JSON.stringify(row)).not.toMatch(/secret_value|sk_|client_secret":"[^"]+/i);
    }
  });

  it("loadLiveLabSiteOptions fails closed when Auth-owner env is absent", () => {
    const result = loadLiveLabSiteOptions("contract-place", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing_env");
      expect(result.missing.length).toBe(4);
    }
  });

  it("loadLiveLabSiteOptions accepts complete HTTPS env without inventing ids", () => {
    const result = loadLiveLabSiteOptions("arcanada-ai", {
      LIVE_LAB_ARCANADA_AI_AUTH_ISSUER_URL: "https://auth.arcanada.ai/",
      LIVE_LAB_ARCANADA_AI_AUTH_CLIENT_ID: "owner-confirmed-client",
      LIVE_LAB_ARCANADA_AI_AUTH_CLIENT_SECRET: "from-secret-store-not-repo",
      LIVE_LAB_ARCANADA_AI_AUTH_ORIGIN: "https://acceptance.example/",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.issuer).toBe("https://auth.arcanada.ai");
      expect(result.options.origin).toBe("https://acceptance.example");
      expect(result.options.clientId).toBe("owner-confirmed-client");
      expect(result.options.returnPaths).toContain("/en/lab/agent-runs");
    }
  });
});
