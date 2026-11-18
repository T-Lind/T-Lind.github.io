"""Reference points for tests/space.test.cjs: direct radbelt IGRF + AE8/AP8 calls.

    /tmp/rb/bin/python scripts/space/make_radiation_fixture.py tests/fixtures/radiation-reference.json

The JavaScript model (grid interpolation of L, B/B0 and of the flux tables) is checked
against these direct Fortran evaluations at random positions it was not tabulated on.
"""
import json
import sys

import numpy as np
from radbelt import aep8, igrf

rng = np.random.default_rng(20261118)
N = 600
h = np.r_[rng.uniform(250, 2000, N // 2), np.exp(rng.uniform(np.log(2000), np.log(40000), N - N // 2))]
lat = np.degrees(np.arcsin(rng.uniform(-1, 1, N)))
lon = rng.uniform(-180, 180, N)
YEAR = 1970.0
L, b = igrf(lon, lat, h, YEAR)
L = np.asarray(L, float); b = np.asarray(b, float)
cases = {"e": [0.1, 0.5, 1.0, 2.2, 3.0], "p": [1.0, 10.0, 12.0, 30.0, 100.0]}
points = []
for k in range(N):
    row = {"lat": round(float(lat[k]), 4), "lon": round(float(lon[k]), 4), "h": round(float(h[k]), 3),
           "L": float(L[k]), "bb0": float(b[k]), "flux": {}}
    for part, energies in cases.items():
        for solar in ("min", "max"):
            row["flux"][f"{part}_{solar}"] = [float(aep8(E, L[k], b[k], part, solar)) for E in energies]
    points.append(row)
json.dump({"year": YEAR, "energies": cases, "points": points}, open(sys.argv[1], "w"), separators=(",", ":"))
print("wrote", len(points), "points")
