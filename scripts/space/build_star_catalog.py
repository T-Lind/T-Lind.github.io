"""Compile the HYG v4.1 CSV into the browser tracker's magnitude-limited catalog."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

SOURCE_SHA256 = "d9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd"
DESTINATION = Path(__file__).resolve().parents[2] / "space/data/stars.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    source = parser.parse_args().csv
    with source.open("rb") as file:
        checksum = hashlib.file_digest(file, "sha256").hexdigest()
    if checksum != SOURCE_SHA256:
        parser.error("Input must be the pinned HYG v4.1 CSV listed in space/data/stars.LICENSE.md.")
    with source.open(encoding="utf-8", newline="") as file:
        rows = [
            [
                int(star["hip"]), round(15 * float(star["ra"]), 6), float(star["dec"]),
                float(star["mag"]), float(star["pmra"] or 0), float(star["pmdec"] or 0),
                star["proper"], float(star["ci"]) if star["ci"] else None,
            ]
            for star in csv.DictReader(file) if star["hip"] and float(star["mag"]) <= 7.5
        ]
    rows.sort(key=lambda star: (star[3], star[0]))
    catalog = {
        "source": "Astronexus HYG v4.1 (Hipparcos entries, V ≤ 7.5)",
        "epoch": 2000,
        "fields": ["hip", "ra_deg", "dec_deg", "v_mag", "pm_ra_cos_dec_mas_yr", "pm_dec_mas_yr", "name", "b_v"],
        "stars": rows,
    }
    DESTINATION.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows):,} stars to {DESTINATION}")


if __name__ == "__main__":
    main()
