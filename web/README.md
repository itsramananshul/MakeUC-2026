# AFTERMAP web

AFTERMAP opens to a worldwide, interactive map. Search a place, request walking directions, or create an incident to collect aerial surveys and field reports in that area.

## Use the app

1. Open [AFTERMAP](https://aftermap-makeuc.vercel.app). Search for a place or move the map to the affected area.
2. Choose **New incident**, enter a name, and set the center and area size. The live deployment requires a workspace operator key to create incidents.
3. Copy the incident access key and share it privately with authorized reporters. Use **Import roads** to load OpenStreetMap streets and footpaths. Imported segments start unverified.
4. Choose **Add imagery** to upload georeferenced GeoTIFFs or a set of overlapping geotagged drone photos. Uploaded imagery is shown at its real coordinates, with transparent gaps over the underlying map. A survey that does not overlap the incident area is rejected.
5. Select a road on the map or find it by name. Report its observed condition and optionally attach a photo. Use **Report a point** for a location observation or **Add passage** for a connection missing from the street data.
6. Choose **Directions** and pick a start and destination on the map, or use a search result as the destination. Inside an incident, the app computes a candidate through reported open passages. It can return a partial route or no route when the evidence does not connect the endpoints.

## Run locally

Use Node 22.13 or later.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Next.js serves the web app and the shared API. SQLite stores incidents, reports, surveys, and image evidence. Set `AFTERMAP_DB_PATH` to a writable persistent volume for deployment.

Copy `.env.example` to `.env.local` for configuration. Set `AFTERMAP_OPERATOR_KEY` to restrict creation to workspace operators. Each incident has a separate randomly generated key for reports, road imports, surveys, and evidence access. Keep the keys private. Report descriptions and names appear on the shared incident view.

### Imagery and providers

- **Map** uses MapLibre GL JS with OpenFreeMap vector tiles and OpenStreetMap attribution.
- **Place search** uses Photon. Set `PHOTON_URL` to use your own server. The default public service is used for individual searches.
- **Road import** uses Overpass and falls back to the OpenStreetMap API for bounded requests. Set `OVERPASS_URL` to configure an instance.
- **Walking outside incidents** uses OSRM. Set `OSRM_FOOT_URL` to your walking router for sustained traffic. The public fallback is throttled to one request per second. Available routes crossing a known incident are excluded.
- **Walking inside incidents** uses Graphology on the reported passage graph. Blocked, hazardous, disputed, and unverified passages are excluded.
- **Aerial imagery** uses GeoTIFF.js, Proj4js, and Sharp to align georeferenced tiles and prepare map overlays. Drone photo sets are processed by NodeODM.

```sh
docker run --rm --name aftermap-nodeodm -p 127.0.0.1:3111:3000 opendronemap/nodeodm:latest
```

Set `NODEODM_URL=http://127.0.0.1:3111`. The drone job can be reopened from **Add imagery** while it is processing. Provide overlapping images of the same area. Survey imagery does not change passage conditions by itself.

## Deployment and shared API

Vercel serves the frontend from `web/` on GitHub `main`. Set `AFTERMAP_API_ORIGIN` to the HTTPS origin of the shared Node backend. The Node host runs SQLite and connects to the drone worker. The current Vercel site depends on that host and its tunnel remaining online.

- `GET /api/incidents` lists incidents. `POST /api/incidents` creates an incident and returns its access key.
- `GET /api/incidents/{id}` returns the current incident snapshot, roads, reports, and imagery.
- `POST /api/incidents/{id}/roads` imports streets. `POST /api/incidents/{id}/reports` accepts a confirmed report.
- `POST /api/incidents/{id}/imagery` imports GeoTIFFs. `POST /api/incidents/{id}/imagery/raw` starts a drone job.
- `GET /api/places?q=...` searches for a place. `POST /api/routes` returns a walking route or an explanation of the evidence gap.

See the route handlers under `app/api` and the shared incident types in `lib/incident-types.ts` for the request shapes.
