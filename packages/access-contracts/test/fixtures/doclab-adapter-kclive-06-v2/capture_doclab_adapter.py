"""KCLIVE-01 capture harness: run the REAL Doclab observation adapter against a fresh test database.

Read-only use of doclab-arcana at the locked commit. The database is built through Doclab's own insert path
(db.connect / db.event / db.insert_finished_run), exactly as tests/test_kclive06_observation_adapter.py does.
No production Doclab data is read.  Output bytes = json.dumps(obj, ensure_ascii=False, sort_keys=True) + "\n"
(the adapter itself returns Python dicts and defines no wire serialization).

usage: capture_doclab_adapter.py <doclab-src-dir> <out-dir> <db-path>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

src, out, dbp = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
sys.path.insert(0, str(src))
sys.dont_write_bytecode = True

from doclab import db  # noqa: E402
from doclab.observation_adapter import capture_runtime_snapshot  # noqa: E402

DOC = "d_" + "a" * 64
INSTANCE = "kclive01-capture"


def ser(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


conn = db.connect(dbp)
now = db.iso()
conn.execute("INSERT INTO documents VALUES (?,?,?,?,?,?)", (DOC, "a" * 64, 10, "text/plain", "originals/a", now))
noise = "noise-run"
conn.execute(
    "INSERT INTO runs (run_id, document_id, pipeline_hash, idempotency_key, status, created_at, updated_at,"
    " profile, processing_manifest_json, display_name) VALUES (?,?,?,?,?,?,?,?,?,?)",
    (noise, DOC, "b" * 64, "n" * 64, "RUNNING", now, now, "test", "{}", "Noise"),
)
# Interleave other-run events so the b2-run view has real, legitimate numeric gaps in the database-wide event_id.
db.event(conn, "noise_0", {"i": 0}, run_id=noise)  # 1
db.event(conn, "noise_1", {"i": 1}, run_id=noise)  # 2
db.insert_finished_run(
    conn, run_id="b2-run", document_id=DOC, pipeline_hash="c" * 64, final_relative_path=f"results/{DOC}/b2-run",
    manifest_sha256="d" * 64, units=3, display_name="Converted sample", processing_manifest={"text_source": "conversion"},
)  # 3
db.event(conn, "noise_2", {"i": 2}, run_id=noise)  # 4
db.event(conn, "run_note", {"n": 1}, run_id="b2-run")  # 5
db.event(conn, "noise_3", {"i": 3}, run_id=noise)  # 6
db.event(conn, "run_note", {"n": 2}, run_id="b2-run")  # 7
conn.close()

views = {
    "b2-run": capture_runtime_snapshot(dbp, run_id="b2-run", producer_instance_id=INSTANCE),
    "all-runs": capture_runtime_snapshot(dbp, producer_instance_id=INSTANCE),
}
out.mkdir(parents=True, exist_ok=True)
(out / "events").mkdir(exist_ok=True)
for name, snap in views.items():
    (out / f"snapshot-{name}.json").write_bytes(ser(snap))
    for ev in snap["events"]:
        (out / "events" / f"{name}-event-{ev['producer_event_id']}.json").write_bytes(ser(ev))
    print(name, [e["producer_event_id"] for e in snap["events"]])
