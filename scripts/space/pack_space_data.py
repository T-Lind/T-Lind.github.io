"""Pack generated radiation tables into the compact files the browser loads.

    python3 scripts/space/pack_space_data.py TRAPPED.npz FIELD1970.npz FIELD2025.npz NIST_DIR

Writes, under space/data/:
  ae8ap8.json        AE8/AP8 integral flux tables. Each (model, energy, L) row holds
                     round(100*log10(flux)) for B/B0 nodes up to the last nonzero one;
                     nodes beyond a row's end are zero flux.
  field-YEAR.bin     Uint16 little-endian, two arrays of shape [alt][lat][lon]:
                     round(1000*L) (capped at 60) then round(10000*log10(B/B0)).
  field.json         grid axes and the list of field epochs.
  nist.json          NIST PSTAR/ESTAR stopping powers and CSDA ranges for Al and Si.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "space" / "data"


def pack_trapped(path):
    z = np.load(path)
    models = {}
    for key in ("e_min", "e_max", "p_min", "p_max"):
        table, cut = z[key], z[key + "_cut"]
        rows, cuts = [], []
        for e in range(table.shape[0]):
            for li in range(table.shape[1]):
                row = table[e, li]
                empty = cut[e, li] <= 0 or not (row > 0).any()
                cuts.append(0 if empty else max(1, int(round(cut[e, li] * 10000))))
                rows.append([] if empty else np.round(100 * np.log10(np.maximum(row, 1e-4))).astype(int).tolist())
        models[key] = {"cut": cuts, "rows": rows}
    doc = {
        "source": "NASA AE8/AP8 trapped radiation models (NSSDC; Vette 1991, Sawyer & Vette 1976), "
                  "evaluated with radbelt (NASA GSFC, NOSA 1.3) on a node grid",
        "units": "omnidirectional integral flux above E, particles cm^-2 s^-1",
        "encoding": "per (energy, L): cut = round(10000*log10(cutoff B/B0)), 0 = no trapped flux; "
                    "row = round(100*log10(flux)) at u nodes, u = log(B/B0)/log(cutoff)",
        "L": z["L"].round(4).tolist(),
        "u": z["u"].round(6).tolist(),
        "energies": {"e": z["e_energies"].tolist(), "p": z["p_energies"].tolist()},
        "models": models,
    }
    (OUT / "ae8ap8.json").write_text(json.dumps(doc, separators=(",", ":")))


def pack_field(paths):
    meta = None
    years = []
    for path in paths:
        z = np.load(path)
        year = int(round(float(z["year"])))
        years.append(year)
        L = np.minimum(z["L"], 60.0)
        b = np.log10(np.maximum(z["bb0"], 1.0))
        data = np.concatenate([np.round(L * 1000).astype("<u2").ravel(),
                               np.round(np.minimum(b, 6.5) * 10000).astype("<u2").ravel()])
        (OUT / f"field-{year}.bin").write_bytes(data.tobytes())
        meta = {"lats": z["lats"].tolist(), "lons": z["lons"].tolist(), "alts_km": z["alts"].tolist()}
    meta.update(
        years=years,
        source="McIlwain L and B/B0 from IGRF/DGRF via radbelt (SHELLG field-line tracing); geodetic grid",
        encoding="Uint16 LE: [alt][lat][lon] round(1000*L), then [alt][lat][lon] round(10000*log10(B/B0))",
    )
    (OUT / "field.json").write_text(json.dumps(meta, separators=(",", ":")))


def read_csv(path):
    rows = [line for line in path.read_text().splitlines() if line and not line.startswith("#")]
    reader = list(csv.reader(rows))
    head = reader[0]
    return {h: [float(r[i]) for r in reader[1:]] for i, h in enumerate(head)}


def pack_nist(folder):
    folder = Path(folder)
    doc = {"source": "NIST PSTAR and ESTAR (physics.nist.gov/PhysRefData/Star/Text), default energy grids",
           "units": "E MeV, stopping power MeV cm^2/g, CSDA range g/cm^2"}
    for name, key in (("aluminium", "Al"), ("silicon", "Si")):
        p = read_csv(folder / f"nist_pstar_{name}.csv")
        e = read_csv(folder / f"nist_estar_{name}.csv")
        doc[key] = {
            "p": {"E": p["E_MeV"], "S": [a + b for a, b in zip(p["S_elec_MeVcm2g"], p["S_nuc_MeVcm2g"])],
                  "R": p["R_csda_gcm2"]},
            "e": {"E": e["E_MeV"], "S": e["S_coll_MeVcm2g"], "R": e["R_csda_gcm2"],
                  "Y": e["radiation_yield"]},
        }
    (OUT / "nist.json").write_text(json.dumps(doc, separators=(",", ":")))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    pack_trapped(sys.argv[1])
    pack_field(sys.argv[2:4])
    pack_nist(sys.argv[4])
    for f in sorted(OUT.iterdir()):
        print(f"{f.name:22s} {f.stat().st_size / 1e3:9.1f} kB")
