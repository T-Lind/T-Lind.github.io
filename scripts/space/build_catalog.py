"""Compact a public GP/OMM catalog snapshot for the debris visualizer.

Input is either a plain JSON array of OMM records (Space-Track or CelesTrak
`FORMAT=json`) or a {metadata, objects} bundle such as the skyhook snapshot.

    python3 scripts/space/build_catalog.py SNAPSHOT.json space/data/catalog.json

Each row keeps only what SGP4 and the browser filters need. Mean elements
are copied unchanged; nothing is re-fitted.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

KINDS = {"PAYLOAD": 0, "ROCKET BODY": 1, "DEBRIS": 2}
FIELDS = ["id", "name", "intl", "kind", "country", "launch", "status", "rcsClass", "rcs",
          "epoch", "n", "e", "i", "raan", "argp", "M", "bstar", "ndot", "nddot", "rev"]


def main(src, dst):
    document = json.loads(Path(src).read_text(encoding="utf-8-sig"))
    records = document["objects"] if isinstance(document, dict) else document
    meta = dict(document.get("metadata", {})) if isinstance(document, dict) else {}
    rows = []
    for r in sorted(records, key=lambda r: int(r["NORAD_CAT_ID"])):
        rcs = r.get("rcs")
        rows.append([
            int(r["NORAD_CAT_ID"]), r.get("OBJECT_NAME") or "", r.get("OBJECT_ID") or "",
            KINDS.get(r.get("OBJECT_TYPE"), 3), r.get("COUNTRY_CODE") or r.get("owner") or "",
            r.get("LAUNCH_DATE") or r.get("launch") or "", r.get("status") or "",
            (r.get("RCS_SIZE") or r.get("rcsClass") or "")[:1], None if rcs is None else round(float(rcs), 4),
            r["EPOCH"].rstrip("Z"), float(r["MEAN_MOTION"]), float(r["ECCENTRICITY"]),
            float(r["INCLINATION"]), float(r["RA_OF_ASC_NODE"]), float(r["ARG_OF_PERICENTER"]),
            float(r["MEAN_ANOMALY"]), float(r["BSTAR"]), float(r["MEAN_MOTION_DOT"]),
            float(r["MEAN_MOTION_DDOT"]), int(r.get("REV_AT_EPOCH") or 0),
        ])
    out = {
        "metadata": {
            "title": meta.get("title", "Public GP catalog snapshot"),
            "provider": meta.get("provider", ""),
            "retrievedAt": meta.get("retrievedAt", ""),
            "referenceEpoch": meta.get("referenceEpoch", ""),
            "epochRange": meta.get("epochRange", []),
            "coverage": meta.get("coverage", ""),
            "attribution": "USSPACECOM / 18th & 19th Space Defense Squadrons basic SSA data via Space-Track.org; "
                           "object metadata from CelesTrak SATCAT.",
            "count": len(rows),
        },
        "kinds": ["payload", "rocket body", "debris", "unknown"],
        "fields": FIELDS,
        "rows": rows,
    }
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    Path(dst).write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(rows)} objects to {dst} ({Path(dst).stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
