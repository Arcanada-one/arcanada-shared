#!/usr/bin/env python3
"""Record the PINNED checker's verdicts so the TypeScript tests can compare against them without Python.

Usage:  python3 -I generate_checker_verdicts.py <knowledge-contract checkout at e351df0c...> <output.json>

It refuses to run unless the checkout is at the pinned commit and the schema / checker blobs match. It runs the checker's own
`check_package` / `schema_errors` and the KC test helpers' mutation registries (`PACKAGE_MUTATIONS`, `RECORD_MUTATIONS`), and adds
the controls this inspector requires (one changed byte, a broken relation, a missing anchor, hostile JSON/bytes). Mutants are stored as
an overlay over a pinned valid package, so the stored bytes stay small and every mutant is reproducible from vendored bytes.
"""
import base64
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

PIN_COMMIT = "e351df0c28f0b9965a580f45b48a297d1872c3ce"
PIN_SCHEMA = "fd721e6f610547ab5ac3748dcbde76f14c3b0899"
PIN_CHECKER = "0221e4ad301ecccf0868019c4c2575120a71b16c"


def git(kc, *args):
    return subprocess.run(["git", "-C", str(kc), *args], check=True, capture_output=True, text=True).stdout.strip()


def main(kc_path, out_path):
    kc = Path(kc_path).resolve()
    assert git(kc, "rev-parse", "HEAD") == PIN_COMMIT, "checkout is not at the pinned commit"
    assert git(kc, "hash-object", "schemas/book-package.schema.json") == PIN_SCHEMA
    assert git(kc, "hash-object", "tools/check_book_package.py") == PIN_CHECKER
    sys.path.insert(0, str(kc / "tools"))
    import book_package_fixture as fx  # noqa: E402
    import check_book_package as cbp  # noqa: E402
    import test_book_package as tbp  # noqa: E402

    def run(files):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel, data in files.items():
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_bytes(data)
            try:
                return cbp.check_package(root)
            except cbp.PackageError as exc:  # main() prints exactly this single message
                return [str(exc)]

    bases = {"synthetic-rle-primer": fx.build(), "synthetic-public-domain-primer": fx.build_public_domain()}
    out = {"pins": {"commit": PIN_COMMIT, "schema_blob": PIN_SCHEMA, "checker_blob": PIN_CHECKER}, "valid_packages": {}, "valid_records": {},
           "invalid_records": {}, "mutants": {}}

    for name, files in bases.items():
        out["valid_packages"][name] = {"problems": run(files)}
    for p in sorted((kc / "schemas/fixtures/book-package/valid/anchors").glob("*.json")):
        out["valid_records"][p.name] = {"errors": cbp.schema_errors(json.loads(p.read_text()))}
    for p in sorted((kc / "schemas/fixtures/book-package/invalid").glob("*.json")):
        out["invalid_records"][p.name] = {"errors": cbp.schema_errors(json.loads(p.read_text()))}

    def add_mutant(name, base, files, note):
        base_files = bases[base]
        overlay = {}
        for rel, data in files.items():
            if base_files.get(rel) != data:
                overlay[rel] = base64.b64encode(data).decode()
        for rel in base_files:
            if rel not in files:
                overlay[rel] = None
        out["mutants"][name] = {"base": base, "overlay": overlay, "note": note, "problems": run(files)}

    jl = lambda rows: ("\n".join(json.dumps(r, sort_keys=True, separators=(",", ":")) for r in rows) + "\n").encode()  # noqa: E731
    parts = lambda base=None: tbp.load_parts(bases[base or "synthetic-rle-primer"])  # noqa: E731

    # 1. the KC registry of cross-file mutations, unchanged
    for name, (mutate, _fragment) in tbp.PACKAGE_MUTATIONS.items():
        p = parts()
        mutate(p)
        add_mutant("kc_" + name, "synthetic-rle-primer", tbp.materialise(p), "KC PACKAGE_MUTATIONS: " + name)

    # 2. byte flip / missing component, as KC tests do
    for rel in ("document.md", "readable.md", "assets/fig1.svg", "objects.jsonl", "relations.jsonl", "edits.jsonl", "quality.json"):
        files = dict(bases["synthetic-rle-primer"])
        files[rel] = files[rel] + b" "
        add_mutant("kc_append_byte_" + rel.replace("/", "_"), "synthetic-rle-primer", files, "one byte appended to " + rel)
    for rel in ("document.md", "objects.jsonl", "assets/fig1.svg", "readable.md", "quality.json", "edits.jsonl", "relations.jsonl", "manifest.json"):
        files = dict(bases["synthetic-rle-primer"])
        del files[rel]
        add_mutant("kc_missing_" + rel.replace("/", "_"), "synthetic-rle-primer", files, "component absent: " + rel)

    # 3. controls required by KCLIVE-01
    files = dict(bases["synthetic-rle-primer"])
    data = bytearray(files["objects.jsonl"])
    at = data.index(b"Run-length")
    data[at] = ord("r")  # one changed byte inside an object's text; manifest digest NOT updated
    files["objects.jsonl"] = bytes(data)
    add_mutant("ctl_object_one_byte_changed", "synthetic-rle-primer", files, "one byte changed in objects.jsonl, manifest not updated")

    p = parts()
    p["objects"][0]["text"] = p["objects"][0]["text"].replace("Run-length", "run-length", 1)
    add_mutant("ctl_object_one_byte_changed_rehashed", "synthetic-rle-primer", tbp.materialise(p, rehash=True, rebind_review=False),
               "same one-byte change with the manifest digests updated but the review binding left stale")

    p = parts()
    p["relations"][0]["to"] = "obj.does-not-exist"
    add_mutant("ctl_relation_broken_endpoint", "synthetic-rle-primer", tbp.materialise(p), "relation endpoint names no object")

    p = parts()
    p["objects"][0]["evidence"] = []
    add_mutant("ctl_object_anchor_missing", "synthetic-rle-primer", tbp.materialise(p), "object without any evidence anchor")

    p = parts()
    p["relations"][0]["evidence"] = []
    add_mutant("ctl_relation_anchor_missing", "synthetic-rle-primer", tbp.materialise(p), "relation without any evidence anchor")

    p = parts()
    del p["objects"][0]["evidence"][0]["block_id"]
    add_mutant("ctl_anchor_field_missing", "synthetic-rle-primer", tbp.materialise(p), "anchor missing a required field")

    p = parts()
    p["quality"]["semantics"]["review"]["reviewer_id"] = p["quality"]["semantics"]["review"]["producer_id"]
    add_mutant("ctl_review_not_independent", "synthetic-rle-primer", tbp.materialise(p), "reviewer equals producer: stale for knowledge_ready")

    p = parts()
    p["manifest"]["representation"]["completeness"] = "partial"
    add_mutant("ctl_partial_but_declared_ready", "synthetic-rle-primer", tbp.materialise(p), "partial source declared knowledge_ready")

    p = parts()
    p["quality"]["damage"] = {"status": "declared", "places": 2, "declarations": [{"code": "OCR_UNREADABLE", "count": 1, "what": "x"}]}
    add_mutant("ctl_damage_places_differ", "synthetic-rle-primer", tbp.materialise(p), "damage places differ from declaration counts")

    # 4. hostile bytes / JSON
    base = bases["synthetic-rle-primer"]

    def with_objects(raw, rehash=True):
        files = dict(base)
        files["objects.jsonl"] = raw
        m = json.loads(files["manifest.json"])
        m["components"]["objects"]["sha256"] = hashlib.sha256(raw).hexdigest()
        files["manifest.json"] = json.dumps(m, indent=1, sort_keys=True).encode() + b"\n"
        return files

    first, *rest = base["objects.jsonl"].decode().split("\n")
    add_mutant("hostile_duplicate_member", "synthetic-rle-primer", with_objects(('{"object_id":"a","object_id":"b",' + first[1:]).encode() + b"\n" + "\n".join(rest).encode()), "duplicate JSON member in an object line")
    add_mutant("hostile_nan", "synthetic-rle-primer", with_objects(first.replace('"kc2_admission"', '"x":NaN,"kc2_admission"').encode() + b"\n" + "\n".join(rest).encode()), "NaN constant")
    add_mutant("hostile_crlf", "synthetic-rle-primer", with_objects(base["objects.jsonl"].replace(b"\n", b"\r\n")), "CRLF line ends")
    add_mutant("hostile_invalid_utf8", "synthetic-rle-primer", with_objects(b"\xff\xfe" + base["objects.jsonl"]), "invalid UTF-8 prefix")
    add_mutant("hostile_lone_surrogate_escape", "synthetic-rle-primer", with_objects(base["objects.jsonl"].replace(b"Run-length", b"\\ud800Run-length", 1)), "isolated surrogate escape")
    add_mutant("hostile_blank_line", "synthetic-rle-primer", with_objects(base["objects.jsonl"] + b"\n"), "blank trailing line")
    add_mutant("hostile_manifest_bom", "synthetic-rle-primer", {**base, "manifest.json": b"\xef\xbb\xbf" + base["manifest.json"]}, "UTF-8 BOM before manifest")
    add_mutant("hostile_manifest_not_json", "synthetic-rle-primer", {**base, "manifest.json": b"{"}, "truncated manifest")
    add_mutant("hostile_manifest_array", "synthetic-rle-primer", {**base, "manifest.json": b"[]"}, "manifest is an array")
    add_mutant("hostile_manifest_dup_member", "synthetic-rle-primer", {**base, "manifest.json": b'{"schema":"a","schema":"b"}'}, "duplicate member in the manifest")
    add_mutant("hostile_quality_not_json", "synthetic-rle-primer", _requality(base, b"{"), "quality.json is not JSON")
    add_mutant("hostile_object_line_scalar", "synthetic-rle-primer", with_objects(b"42\n" + b"\n".join(base["objects.jsonl"].split(b"\n")[1:])), "an objects line is a bare number")

    # 5. public-domain package variants
    pdp = tbp.load_parts(bases["synthetic-public-domain-primer"])
    pdp["manifest"]["rights"]["license_class"] = "third_party_restricted"
    add_mutant("kc_pd_restricted", "synthetic-public-domain-primer", tbp.materialise(pdp), "public-domain primer re-labelled third_party_restricted")

    Path(out_path).write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(f"valid_packages={len(out['valid_packages'])} valid_records={len(out['valid_records'])} invalid_records={len(out['invalid_records'])} mutants={len(out['mutants'])}")


def _requality(base, raw):
    files = dict(base)
    files["quality.json"] = raw
    m = json.loads(files["manifest.json"])
    m["components"]["quality"]["sha256"] = hashlib.sha256(raw).hexdigest()
    files["manifest.json"] = json.dumps(m, indent=1, sort_keys=True).encode() + b"\n"
    return files


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
