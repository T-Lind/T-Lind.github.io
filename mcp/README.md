# Space Tools MCP

Use `https://t-lind-space-mcp.vercel.app/mcp` as a **Streamable HTTP** MCP server. No API key or login is required. The server supports both the 2026-07-28 and 2025-era protocol versions.

| Tool | What it returns |
| --- | --- |
| `screen_orbital_debris` | Closest approaches within a 1–6 hour window, ranked by miss distance, with relative velocity and radial, in-track, and cross-track separation. |
| `estimate_van_allen_radiation` | Electron and proton fluence and total ionizing dose in rad(Si) behind an idealized aluminum shield, using AE8/AP8 and IGRF. |

Both accept one TLE, one OMM record, or classical orbital elements. Debris screening uses the catalog snapshot bundled with the deployment. The default start is the catalog reference epoch, and a requested start must be within 30 days of both that reference and the input orbit epoch. Wide scans can exceed the 20-second screening budget. Use a shorter window or the browser visualizer to run a longer scan or load a newer catalog.

## Example tool arguments

The example starts at the bundled catalog’s reference epoch. Use the same `orbit` for the radiation tool and supply `missionDays` in place of the debris settings.

```json
{
  "orbit": {
    "kind": "elements",
    "epoch": "2026-10-22T15:43:48.036Z",
    "perigee": 400,
    "apogee": 420,
    "inc": 51.6
  },
  "hours": 1,
  "missDistanceKm": 10
}
```

## Test and deploy

Run these checks from the repository root with Node 22.

```sh
npm --prefix mcp ci
npm --prefix mcp test
MCP_TEST_URL=https://t-lind-space-mcp.vercel.app/mcp npm --prefix mcp test
```

The stage command prints a temporary directory with the MCP package, shared calculation code, and public model data. Deploy that directory to the `t-lind-space-mcp` Vercel project. GitHub Pages continues to serve the site from the repository root.

```sh
mcp_stage=$(npm --silent --prefix mcp run stage)
vercel link --cwd "$mcp_stage" --project t-lind-space-mcp --scope tiernan-lindauers-projects --yes
vercel deploy --cwd "$mcp_stage" --prod
```
