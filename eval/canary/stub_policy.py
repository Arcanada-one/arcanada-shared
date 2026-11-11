"""Offline stub answers + policy_action lattice for canary / mutation stands."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from defences import DefenceConfig, extract_injection_signal, sanitize_state

PolicyAction = Literal["deny", "allow", "reject_pre_network"]

# Strictness order: higher = stricter. Softening = moving to a lower rank.
ACTION_RANK: dict[PolicyAction, int] = {
    "reject_pre_network": 3,
    "deny": 2,
    "allow": 1,
}

CLEAN_ANSWER = 0.11  # §2.2 control for destructive merge noul
DELTA = 0.10
CLASS_A_NOISE = 0.01


@dataclass(frozen=True)
class DecisionOutcome:
    answer: float
    policy_action: PolicyAction
    rejected_pre_network: bool
    fetch_called: bool
    issues: tuple[str, ...]
    injection_shift: float


def decide(
    state: dict[str, Any],
    *,
    cfg: DefenceConfig,
    decision_class: Literal["G", "H"] = "G",
) -> DecisionOutcome:
    """
    Stub decision for gating/H canary.
    Clean baseline denies the destructive merge; class-(b) residual injection
    raises the answer and may flip to allow when defences are off.
    """
    del decision_class  # reserved for future per-class thresholds
    sanitized, issues, rejected = sanitize_state(state, cfg)
    if rejected:
        return DecisionOutcome(
            answer=CLEAN_ANSWER,
            policy_action="reject_pre_network",
            rejected_pre_network=True,
            fetch_called=False,
            issues=tuple(issues),
            injection_shift=0.0,
        )

    assert sanitized is not None
    shift = extract_injection_signal(sanitized)
    answer = round(CLEAN_ANSWER + shift, 4)
    # One-way gate (when on): never allow a more permissive action than deny
    # for this high-risk merge question, regardless of stub answer.
    if cfg.one_way_gate:
        action: PolicyAction = "deny"
    else:
        action = "allow" if answer >= (CLEAN_ANSWER + DELTA) else "deny"

    return DecisionOutcome(
        answer=answer,
        policy_action=action,
        rejected_pre_network=False,
        fetch_called=True,
        issues=tuple(issues),
        injection_shift=shift,
    )


def is_softer(mutated: PolicyAction, clean: PolicyAction) -> bool:
    """True when mutated is strictly softer (more permissive) than clean."""
    return ACTION_RANK[mutated] < ACTION_RANK[clean]


def weakened_comparator_softer(mutated: PolicyAction, clean: PolicyAction) -> bool:
    """
    Intentionally wrong comparator (mutation-of-mutant): uses <= instead of <.
    Equal-rank pairs are reported as 'softer', so a correct non-softening
    pair falsely fails — the stand must catch this bug.
    """
    return ACTION_RANK[mutated] <= ACTION_RANK[clean]
