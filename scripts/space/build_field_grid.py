"""Tabulate McIlwain L and B/B0 from IGRF/DGRF on a geodetic grid.

The browser radiation tool interpolates this grid to get the (L, B/B0)
coordinates that AE8/AP8 are organised in. Uses the same `radbelt` IGRF
routine (SHELLG field-line tracing) that the radbelt AE8/AP8 wrapper uses.

    /tmp/rb/bin/python scripts/space/build_field_grid.py 1970 OUT.npz

Grid: geodetic latitude -90..90 in 3 deg steps, longitude -180..174 in 6 deg
steps (wraps), and 92 geodetic heights from 100 km to 60,000 km, densest in
low Earth orbit where the South Atlantic Anomaly lives.
"""
from __future__ import annotations

import sys
import time
from multiprocessing import Pool

import numpy as np

LATS = np.arange(-90.0, 90.001, 3.0)
LONS = np.arange(-180.0, 180.0, 6.0)
ALTS = np.round(np.r_[np.arange(100, 1500, 50), np.arange(1500, 3000, 100), np.arange(3000, 8000, 250),
                      np.arange(8000, 20000, 1000), np.arange(20000, 60001, 2500)], 1).astype(float)


def level(args):
    from radbelt import igrf
    year, ai = args
    lat, lon = np.meshgrid(LATS, LONS, indexing="ij")
    L, b = igrf(lon.ravel(), lat.ravel(), np.full(lat.size, ALTS[ai]), float(year))
    L = np.asarray(L, float).reshape(lat.shape)
    b = np.asarray(b, float).reshape(lat.shape)
    bad = ~np.isfinite(L) | (L <= 0) | (L > 60)
    L[bad] = 60.0
    b[bad | ~np.isfinite(b)] = 1e6
    return ai, L, np.maximum(b, 1.0)


def main(year, out):
    t0 = time.time()
    Lg = np.zeros((len(ALTS), len(LATS), len(LONS)))
    bg = np.zeros_like(Lg)
    with Pool() as pool:
        for ai, L, b in pool.imap_unordered(level, [(year, i) for i in range(len(ALTS))]):
            Lg[ai], bg[ai] = L, b
            print(f"alt {ALTS[ai]:.0f} km done, {time.time() - t0:.0f} s", flush=True)
    np.savez_compressed(out, year=year, lats=LATS, lons=LONS, alts=ALTS, L=Lg, bb0=bg)
    print("wrote", out)


if __name__ == "__main__":
    main(float(sys.argv[1]), sys.argv[2])
