/**
 * Contract tests.
 *
 * The fail-closed resolver gets the most coverage here on purpose: it is the
 * one function whose failure mode is granting access nobody granted, and every
 * other check in this package is a supporting act.
 */
import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  EFFECTS,
  MAX_CHECKS_PER_REQUEST,
  RESOURCE_KINDS,
  buildSnapshot,
  isAllowed,
  isCapability,
  isUuid,
  parseEntitlementRequest,
  parseEntitlementResponse,
  resolveDecisions,
  snapshotApplies,
  type CapabilityCheck,
  type Decision,
  type EntitlementResponse,
} from "../src/index.js";

// Hex letters on purpose: an all-digit fixture makes the lower-case assertion
// below vacuous, because toUpperCase() is a no-op on it.
const SUBJECT = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER_SUBJECT = "9f8e7d6c-5b4a-4392-8817-06f5e4d3c2b1";
const SPACE = { kind: "space", id: "arcanada" } as const;

const okResponse = (decisions: Decision[]): EntitlementResponse => ({
  decisions,
  policyVersion: "v1",
  evaluatedAt: "2026-07-30T00:00:00.000Z",
});

describe("vocabulary", () => {
  it("is closed and free of duplicates", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
    expect(isCapability("spaces.read")).toBe(true);
    expect(isCapability("spaces.write")).toBe(false);
    expect(isCapability("")).toBe(false);
    expect(isCapability(undefined)).toBe(false);
    // Matching is exact, not prefix-based.
    expect(isCapability("spaces.read.extra")).toBe(false);
  });

  it("keeps resource kinds and effects closed", () => {
    expect([...RESOURCE_KINDS]).toEqual(["space"]);
    expect([...EFFECTS]).toEqual(["allow", "deny", "unavailable"]);
  });

  it("rejects the uuid shapes that look close enough to slip through", () => {
    expect(isUuid(SUBJECT)).toBe(true);
    expect(isUuid(SUBJECT.slice(0, -1))).toBe(false);
    expect(isUuid(SUBJECT.toUpperCase())).toBe(false);
    expect(isUuid(` ${SUBJECT} `)).toBe(false);
    expect(isUuid(`${SUBJECT}\n`)).toBe(false);
  });
});

describe("request validation", () => {
  it("accepts a well-formed batch", () => {
    const r = parseEntitlementRequest({
      subject: SUBJECT,
      checks: [
        { capability: "spaces.read" },
        { capability: "dev_agents.operate", resource: SPACE },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects unknown fields rather than dropping them", () => {
    const outer = parseEntitlementRequest({
      subject: SUBJECT,
      checks: [{ capability: "spaces.read" }],
      extra: true,
    });
    expect(outer.ok).toBe(false);
    const inner = parseEntitlementRequest({
      subject: SUBJECT,
      checks: [{ capability: "spaces.read", scope: "everything" }],
    });
    expect(inner.ok).toBe(false);
  });

  it("rejects bad subjects, unknown capabilities and unknown resource kinds", () => {
    expect(
      parseEntitlementRequest({
        subject: "nope",
        checks: [{ capability: "spaces.read" }],
      }).ok,
    ).toBe(false);
    expect(
      parseEntitlementRequest({
        subject: SUBJECT,
        checks: [{ capability: "root.all" }],
      }).ok,
    ).toBe(false);
    expect(
      parseEntitlementRequest({
        subject: SUBJECT,
        checks: [
          { capability: "spaces.read", resource: { kind: "server", id: "x" } },
        ],
      }).ok,
    ).toBe(false);
  });

  it("enforces the batch bound at the boundary, not one past it", () => {
    const check = { capability: "spaces.read" };
    expect(
      parseEntitlementRequest({
        subject: SUBJECT,
        checks: Array.from({ length: MAX_CHECKS_PER_REQUEST }, () => check),
      }).ok,
    ).toBe(true);
    expect(
      parseEntitlementRequest({
        subject: SUBJECT,
        checks: Array.from({ length: MAX_CHECKS_PER_REQUEST + 1 }, () => check),
      }).ok,
    ).toBe(false);
    expect(parseEntitlementRequest({ subject: SUBJECT, checks: [] }).ok).toBe(
      false,
    );
  });
});

describe("response validation", () => {
  it("requires a policy version and a parseable timestamp", () => {
    expect(parseEntitlementResponse(okResponse([])).ok).toBe(true);
    expect(
      parseEntitlementResponse({
        decisions: [],
        policyVersion: "",
        evaluatedAt: "2026-07-30T00:00:00Z",
      }).ok,
    ).toBe(false);
    expect(
      parseEntitlementResponse({
        decisions: [],
        policyVersion: "v1",
        evaluatedAt: "never",
      }).ok,
    ).toBe(false);
  });

  it("rejects unknown effects and unknown capabilities", () => {
    expect(
      parseEntitlementResponse({
        ...okResponse([]),
        decisions: [{ capability: "spaces.read", effect: "maybe" }],
      }).ok,
    ).toBe(false);
    expect(
      parseEntitlementResponse({
        ...okResponse([]),
        decisions: [{ capability: "root.all", effect: "allow" }],
      }).ok,
    ).toBe(false);
  });
});

describe("fail-closed resolution", () => {
  it("turns an omitted decision into unavailable, never allow", () => {
    const requested: CapabilityCheck[] = [
      { capability: "spaces.read" },
      { capability: "content.write" },
    ];
    const resolved = resolveDecisions(
      requested,
      okResponse([{ capability: "spaces.read", effect: "allow" }]),
    );
    expect(resolved[1]?.effect).toBe("unavailable");
  });

  it("turns no usable response at all into unavailable for every check", () => {
    const resolved = resolveDecisions(
      [{ capability: "spaces.read" }, { capability: "content.read" }],
      null,
    );
    expect(resolved.every((d) => d.effect === "unavailable")).toBe(true);
    expect(resolved.every((d) => !isAllowed(d))).toBe(true);
  });

  it("cannot be made to allow a capability nobody requested", () => {
    // Iterating the response instead of the request is exactly how that leaks.
    const resolved = resolveDecisions(
      [{ capability: "spaces.read" }],
      okResponse([
        { capability: "control.authorization.manage", effect: "allow" },
        { capability: "spaces.read", effect: "deny" },
      ]),
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.effect).toBe("deny");
  });

  it("resolves conflicting duplicate answers to the most restrictive", () => {
    expect(
      resolveDecisions(
        [{ capability: "spaces.read" }],
        okResponse([
          { capability: "spaces.read", effect: "allow" },
          { capability: "spaces.read", effect: "deny" },
        ]),
      )[0]?.effect,
    ).toBe("deny");
    expect(
      resolveDecisions(
        [{ capability: "spaces.read" }],
        okResponse([
          { capability: "spaces.read", effect: "allow" },
          { capability: "spaces.read", effect: "unavailable" },
        ]),
      )[0]?.effect,
    ).toBe("unavailable");
  });

  it("does not let a resource-scoped allow widen or cross resources", () => {
    expect(
      resolveDecisions(
        [{ capability: "dev_agents.operate" }],
        okResponse([
          {
            capability: "dev_agents.operate",
            resource: SPACE,
            effect: "allow",
          },
        ]),
      )[0]?.effect,
    ).toBe("unavailable");
    expect(
      resolveDecisions(
        [
          {
            capability: "dev_agents.operate",
            resource: { kind: "space", id: "aether" },
          },
        ],
        okResponse([
          {
            capability: "dev_agents.operate",
            resource: SPACE,
            effect: "allow",
          },
        ]),
      )[0]?.effect,
    ).toBe("unavailable");
  });
});

describe("browser snapshot", () => {
  it("carries only unscoped allows, deduplicated", () => {
    const snapshot = buildSnapshot({
      subject: SUBJECT,
      sessionId: "session-1",
      policyVersion: "v1",
      evaluatedAt: "2026-07-30T00:00:00.000Z",
      decisions: [
        { capability: "spaces.read", effect: "allow" },
        { capability: "spaces.read", effect: "allow" },
        { capability: "content.write", effect: "deny" },
        { capability: "infrastructure.read", effect: "unavailable" },
        { capability: "dev_agents.operate", resource: SPACE, effect: "allow" },
      ],
    });
    expect([...snapshot.allowed]).toEqual(["spaces.read"]);
  });

  it("does not apply across a subject or session boundary", () => {
    const snapshot = buildSnapshot({
      subject: SUBJECT,
      sessionId: "session-1",
      policyVersion: "v1",
      evaluatedAt: "2026-07-30T00:00:00.000Z",
      decisions: [{ capability: "spaces.read", effect: "allow" }],
    });
    expect(snapshotApplies(snapshot, SUBJECT, "session-1")).toBe(true);
    expect(snapshotApplies(snapshot, SUBJECT, "session-2")).toBe(false);
    expect(snapshotApplies(snapshot, OTHER_SUBJECT, "session-1")).toBe(false);
  });

  it("exposes no policy internals", () => {
    const snapshot = buildSnapshot({
      subject: SUBJECT,
      sessionId: "session-1",
      policyVersion: "v1",
      evaluatedAt: "2026-07-30T00:00:00.000Z",
      decisions: [{ capability: "content.write", effect: "deny" }],
    });
    // A new field here is a disclosure decision and must be made deliberately.
    expect(Object.keys(snapshot).sort()).toEqual([
      "allowed",
      "evaluatedAt",
      "policyVersion",
      "sessionId",
      "subject",
    ]);
  });
});
