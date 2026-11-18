"""Tabulate NASA AE8/AP8 trapped-particle fluxes for browser interpolation.

The browser radiation tool interpolates these tables; it never runs the Fortran.

Requires `radbelt` (NASA GSFC's Python wrapper of the NSSDC AE8/AP8 Fortran
models and IGRF; PyPI `radbelt`, NASA Open Source Agreement 1.3). It builds
from source and needs gfortran:

    python3 -m venv /tmp/rb && /tmp/rb/bin/pip install radbelt numpy
    /tmp/rb/bin/python scripts/space/build_trapped_tables.py OUT.npz

Then run pack_space_data.py to write the compact files under space/data/.

Layout (the same idea as the models' own TRARA interpolation): for every energy E
and L node, the cutoff B/B0 where trapped flux ends is found by bisection. Flux is
then tabulated on normalised nodes u = log(B/B0) / log(cutoff), from the magnetic
equator (u = 0) to the cutoff (u = 1), packed densely near u = 1 where flux falls
steeply. Interpolating at fixed u between neighbouring L nodes follows the cutoff
as it moves with L, which plain (L, B/B0) interpolation does not, and that matters
most for low-Earth orbits grazing the South Atlantic Anomaly.

Fluxes are omnidirectional integral fluxes above each threshold energy,
in particles cm^-2 s^-1.
"""
from __future__ import annotations

import sys
import time
from multiprocessing import Pool

import numpy as np

E_ELEC = [0.04, 0.07, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0, 1.25, 1.5,
          1.75, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0]
E_PROT = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0,
          7.0, 10.0, 15.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 100.0, 150.0, 200.0,
          300.0, 400.0]
L_NODES = np.round(np.r_[np.arange(1.0, 2.0, 0.02), np.arange(2.0, 4.0, 0.05),
                         np.arange(4.0, 7.0, 0.1), np.arange(7.0, 12.001, 0.25)], 4)
N_U = 40
U_NODES = 1 - (1 - np.linspace(0, 1, N_U)) ** 2      # dense toward the cutoff
LOG_BMAX = 4.0                                       # search cutoffs up to B/B0 = 1e4
MODELS = [("e", "min"), ("e", "max"), ("p", "min"), ("p", "max")]


def row(task):
    from radbelt import aep8
    particle, solar, energy, li = task
    L = float(L_NODES[li])
    f = lambda lb: float(np.nan_to_num(aep8(energy, L, 10.0 ** lb, particle, solar)))
    if f(0.0) <= 0:
        # flux may start above the equator only if it exists at all on this L shell
        probe = np.linspace(0, LOG_BMAX, 81)
        vals = np.nan_to_num(np.asarray(aep8(np.full(81, energy), np.full(81, L), 10.0 ** probe, particle, solar), float))
        if not (vals > 0).any():
            return task, 0.0, np.zeros(N_U)
    # coarse scan for the last positive B/B0, then bisection
    probe = np.linspace(0, LOG_BMAX, 161)
    vals = np.nan_to_num(np.asarray(aep8(np.full(161, energy), np.full(161, L), 10.0 ** probe, particle, solar), float))
    pos = np.nonzero(vals > 0)[0]
    lo = probe[pos[-1]]
    hi = probe[min(pos[-1] + 1, len(probe) - 1)]
    if hi == lo:
        hi = lo + 1e-3
    for _ in range(30):
        mid = 0.5 * (lo + hi)
        if f(mid) > 0:
            lo = mid
        else:
            hi = mid
    lbc = lo
    bvals = 10.0 ** (U_NODES * lbc)
    flux = np.nan_to_num(np.asarray(aep8(np.full(N_U, energy), np.full(N_U, L), bvals, particle, solar), float))
    return task, lbc, flux


def main(out):
    tasks = []
    for particle, solar in MODELS:
        energies = E_ELEC if particle == "e" else E_PROT
        for energy in energies:
            for li in range(len(L_NODES)):
                tasks.append((particle, solar, energy, li))
    flux = {f"{p}_{s}": np.zeros((len(E_ELEC if p == 'e' else E_PROT), len(L_NODES), N_U)) for p, s in MODELS}
    cut = {f"{p}_{s}": np.zeros((len(E_ELEC if p == 'e' else E_PROT), len(L_NODES))) for p, s in MODELS}
    t0 = time.time()
    with Pool() as pool:
        for n, ((particle, solar, energy, li), lbc, values) in enumerate(pool.imap_unordered(row, tasks, chunksize=4)):
            key = f"{particle}_{solar}"
            ei = (E_ELEC if particle == "e" else E_PROT).index(energy)
            flux[key][ei, li, :] = values
            cut[key][ei, li] = lbc
            if n % 500 == 0:
                print(f"{n}/{len(tasks)} rows, {time.time() - t0:.0f} s", flush=True)
    np.savez_compressed(out, L=L_NODES, u=U_NODES, e_energies=E_ELEC, p_energies=E_PROT,
                        **flux, **{k + "_cut": v for k, v in cut.items()})
    print("wrote", out, f"{time.time() - t0:.0f} s")


if __name__ == "__main__":
    main(sys.argv[1])
