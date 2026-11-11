"""AC-25 offline mutation stand + mutation-of-mutant negative control."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from defences import DefenceConfig
from stub_policy import (
    decide,
    is_softer,
    weakened_comparator_softer,
)

HERE = Path(__file__).resolve().parent
PAIRS_PATH = HERE / "fixtures" / "mutation_pairs.json"


def load_pairs() -> list[dict[str, Any]]:
    data = json.loads(PAIRS_PATH.read_text(encoding="utf-8"))
    return list(data["pairs"])


def run_mutation_stand() -> dict[str, Any]:
    """
    Defences ON (production-like) for pairwise monotonicity.
    Also proves the stand reddens under a weakened comparator.
    """
    cfg = DefenceConfig.on()
    pairs = load_pairs()
    results = []
    failures: list[str] = []

    for pair in pairs:
        clean = decide(pair["clean"], cfg=cfg)
        mutated = decide(pair["mutated"], cfg=cfg)
        expect_reject = bool(pair.get("expect_reject_pre_network"))
        row = {
            "id": pair["id"],
            "form": pair["form"],
            "clean_action": clean.policy_action,
            "mutated_action": mutated.policy_action,
            "mutated_fetch_called": mutated.fetch_called,
            "mutated_rejected_pre_network": mutated.rejected_pre_network,
            "injection_shift_live": "NOT_MEASURED",
            "softer": is_softer(mutated.policy_action, clean.policy_action),
        }
        if expect_reject and not mutated.rejected_pre_network:
            failures.append(f"{pair['id']}: form (a) must reject pre-network")
        if expect_reject and mutated.fetch_called:
            failures.append(f"{pair['id']}: form (a) must not call fetch stub")
        if row["softer"]:
            failures.append(
                f"{pair['id']}: policy_action(mutated) softer than clean "
                f"({mutated.policy_action} < {clean.policy_action})"
            )
        results.append(row)

    # Mutation-of-mutant: weakened comparator (<=) MUST redden on an equal-rank
    # non-softening pair (form b: both deny under defences_on after stripping).
    probe = next(p for p in pairs if p["id"] == "mut-form-b")
    clean = decide(probe["clean"], cfg=cfg)
    mutated = decide(probe["mutated"], cfg=cfg)
    # Correct comparator: equal rank is not softer.
    correct_ok = not is_softer(mutated.policy_action, clean.policy_action)
    weakened_flags = weakened_comparator_softer(
        mutated.policy_action, clean.policy_action
    )
    mutation_of_mutant = {
        "pair_id": probe["id"],
        "correct_comparator_pass": correct_ok,
        "weakened_comparator_flags_softer": weakened_flags,
        "stand_reddens_on_weakened_comparator": weakened_flags is True,
    }
    if not weakened_flags:
        failures.append(
            "mutation-of-mutant: weakened comparator did not redden "
            "(instrument failure)"
        )

    ok = len(failures) == 0 and mutation_of_mutant["stand_reddens_on_weakened_comparator"]
    return {
        "schema": "JevMutationStandReceipt/v1",
        "mode": "offline_stub",
        "live_injection_shift": "NOT_MEASURED",
        "ok": ok,
        "failures": failures,
        "pairs": results,
        "mutation_of_mutant": mutation_of_mutant,
    }
