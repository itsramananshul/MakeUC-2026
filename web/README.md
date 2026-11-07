# AFTERMAP web

AFTERMAP combines reports from people in a simulated disaster zone into a shared map that changes as they learn what can be traversed. The Mexico Beach aerial base is historical NOAA imagery. All checkpoints, passage conditions, people, and routes in this drill are simulated.

## Run the command view

Use Node 22.13 or later.

```sh
npm ci
npm run dev
```

Open http://localhost:3000 on the laptop. Other devices use a reachable server URL and the drill code `WESTHALL`. For a rehearsal over the internet, run `npm run build` and `npm start` on a single Node server with a persistent writable volume. The phones and browser request the same versioned snapshot about once per second. Use HTTPS for browser camera scanning.

Configuration goes in `.env.local`. Copy `.env.example` for the available options. SQLite defaults to `.aftermap/drill.sqlite`. Set `AFTERMAP_DB_PATH` to the file on your persistent volume. Treat the drill URL as a temporary exercise link and use nicknames and fictional reports.

## Run the live demo

1. Project the laptop and open **Drone View** to show historical aerial imagery. To demonstrate import, choose **Import imagery**, select the two prepared overlapping Mexico Beach GeoTIFFs and wait for the aerial layer. Return to **Field Map**.
2. Join `WESTHALL` on three iPhones or open three separate browser tabs. Open **Checkpoint codes** on the laptop to save or print QR codes. The compatible payload format is `aftermap:WESTHALL:<checkpoint ID>`.
3. Phone A scans `ATRIUM` (Coastal junction) and reports that Harbor Road toward `CENTRAL` (Harbor junction) is **Open**. A can type or dictate “Harbor Road is open,” use **Interpret**, review the suggested target and condition, then confirm.
4. Phone B scans `EXIT` (East assembly) and submits an **Assembly point** report at `EXIT`. The first candidate route appears.
5. Phone C scans `EAST-S` (Service junction) and confirms a new **Open** passage to `EAST` (East crossing). The laptop adds the previously unmapped link.
6. Phone A reports Harbor Road toward `CENTRAL` as **Blocked**. The old route becomes dashed and the route moves to the new link. Select the closure to see the reports behind it.

For another rehearsal, use a fresh database or reset the current rehearsal database with `npm run drill:reset -- --confirm`. Set the same `AFTERMAP_DB_PATH` you used to start the server. This clears reports, participants, and imported imagery from the specified drill. Rejoin on the phones after a reset.

## Imagery and interpretation

- **GeoTIFF mosaic** imports up to eight north-up images in WGS 84, Web Mercator, or WGS 84 UTM. The server places and merges the images by coordinates. The Mexico Beach drill graph only appears over its own coverage. Imagery from another area opens separately.
- **Drone photos** submits overlapping, geotagged JPEGs or PNGs to NodeODM. Start the worker using the example below and set `NODEODM_URL=http://127.0.0.1:3111`. The server imports the generated orthomosaic when processing finishes. Keep the import dialog open while the job runs.
- **Interpret** uses a server-side `GEMINI_API_KEY` for photo or language suggestions. A local Ollama vision model is supported by setting `OLLAMA_URL=http://127.0.0.1:11434` and `OLLAMA_MODEL=qwen3.5:4b`. The text fallback matches a small set of explicit drill phrases when a model is unavailable. A suggestion only updates the draft. The person must confirm it to update the map.

```sh
docker run --rm --name aftermap-nodeodm -p 127.0.0.1:3111:3000 opendronemap/nodeodm:latest
```

## Shared API

All session requests use `/api/sessions/{code}`. GET returns a versioned snapshot. POST `/join` creates or resumes a participant, `/position` records a checkpoint, `/interpret` returns an unpublished suggestion, and `/observations` accepts an explicitly confirmed report. Stable observation IDs make retries idempotent. See `lib/world.ts` and `lib/validation.ts` for the exact field definitions.

The first candidate route uses only open links to a reported assembly point. A recent disagreement between two different observers marks a passage disputed and keeps it out of the route. The map retains the evidence and shows the last route alongside the updated one.

Aerial imagery from the [NOAA National Geodetic Survey Hurricane Michael dataset](https://www.fisheries.noaa.gov/inport/item/57759). It was captured on October 11, 2018.
