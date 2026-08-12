# `@arcanada/access-contracts`

The shared access and capability contract for Arcanada product surfaces: the
closed capability vocabulary, the request and response validators, and the
fail-closed decision resolver.

## Why it lives here

Two independent systems have to agree on it — the authorization service that
evaluates capabilities, and the backend-for-frontend that enforces the answer.
A contract duplicated in both is a contract that will eventually disagree, and
the disagreement surfaces as an authorization bug rather than a type error.

It sits in the public shared repository rather than alongside the design system
because it is a clean-room utility: no dependencies, and no content derived from
any licensed template. That is the class this repository is for.

## The part that matters

`resolveDecisions` iterates the **requested** checks, never the returned
decisions. A responder that omits a check, returns a decision nobody asked for,
or answers the same check twice with conflicting effects cannot produce an
`allow` for something unanswered.

An implementation that walked the response instead would pass every test that
only feeds it well-formed responses, and fail in production exactly when the
authorization service is degraded — which is when it matters.

`unavailable` is deliberately distinct from `deny`. Both refuse, and a gate must
treat them identically, but only one of them means the system actually answered.
Collapsing them loses the difference between "you may not" and "we do not know",
which is what an operator needs when a surface goes dark.

## Deliberately dependency-free

A shared contract package is imported by everything, so every dependency it
takes is taken by every consumer. A schema library in this position is a
supply-chain decision wearing the clothes of a convenience; the validators here
are hand-written and total.
