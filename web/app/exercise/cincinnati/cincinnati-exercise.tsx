"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownUp, ArrowLeft, Footprints, Satellite } from "lucide-react";
import { cincinnatiFloodSurveys } from "@/lib/cincinnati-exercise";
import { incidentRoute } from "@/lib/incident-route";
import { within, type Coordinate, type GeographicBounds, type Incident } from "@/lib/incident-types";
import PlaceFinder from "../../place-finder";
import WorldMap from "../../world-map";

type Stop = Coordinate & { label: string };
type Focus = { point: Coordinate; zoom: number } | { bounds: GeographicBounds };
const origin = { latitude: 39.10736, longitude: -84.50947, label: "Central Parkway access" };
const destination = { latitude: 39.10801, longitude: -84.5086477, label: "Eggleston Avenue access" };
const noop = () => {};

export default function CincinnatiExercise({ incident }: { incident: Incident }) {
  const [aerial, setAerial] = useState(true);
  const [start, setStart] = useState<Stop | null>(origin);
  const [end, setEnd] = useState<Stop | null>(destination);
  const [picking, setPicking] = useState<"start" | "destination" | null>(null);
  const [center, setCenter] = useState<Coordinate>(origin);
  const [error, setError] = useState("");
  const [route, setRoute] = useState<ReturnType<typeof incidentRoute> | null>(null);
  const downtown = incident.imagery?.bounds ?? incident.bounds;
  const [focus, setFocus] = useState<Focus>({ bounds: downtown });
  const mapIncident = useMemo(() => ({ ...incident, imagery: null }), [incident]);
  function updateStop(side: "start" | "destination", point: Stop | null) {
    setRoute(null); setError(""); setPicking(null);
    if (side === "start") setStart(point);
    else setEnd(point);
    if (point && within(point, downtown)) setFocus({ point, zoom: 17.6 });
  }
  function choosePoint(point: Coordinate) {
    if (picking) updateStop(picking, { ...point, label: "Dropped pin" });
  }
  function findRoute() {
    if (!start || !end) { setError("Choose a starting point and a destination."); return; }
    setError(""); setPicking(null);
    const next = incidentRoute(incident, start, end);
    setRoute(next);
    if (next.coordinates.length) {
      const points = [start, end, ...next.coordinates];
      setFocus({ bounds: {
        west: Math.min(...points.map(point => point.longitude)), east: Math.max(...points.map(point => point.longitude)),
        south: Math.min(...points.map(point => point.latitude)), north: Math.max(...points.map(point => point.latitude)),
      } });
    }
  }

  return <main className="world-app with-world-sidebar">
    <aside className="world-sidebar" data-sheet={picking ? 0 : 1} aria-label="Cincinnati flood map">
      <div className="world-tray">
        <div className="world-scroll">
          <Link className="world-text" href="/"><ArrowLeft size={15} /> World map</Link>
          <section className="world-section active-incident">
            <p className="incident-caption">Aerial imagery preview</p>
            <h1>Cincinnati flood</h1>
            <p className="world-hint">Explore the downtown map stitched from five georeferenced images. The red segment shows a reported closure on East Central Parkway.</p>
            <div className="world-action-row">
              <button className="world-secondary" type="button" aria-pressed={aerial} onClick={() => setAerial(!aerial)}><Satellite size={16} /> Flood imagery</button>
              <button className="world-secondary" type="button" onClick={() => setFocus({ bounds: downtown })}>Show downtown</button>
            </div>
            <div className="direction-stops">
              <PlaceFinder label="Starting point" stop="start" initialValue={start?.label}
                onEdit={() => { setStart(null); setRoute(null); }}
                onSelect={place => updateStop("start", { ...place, label: place.name })} />
              <PlaceFinder label="Destination" stop="destination" initialValue={end?.label}
                onEdit={() => { setEnd(null); setRoute(null); }}
                onSelect={place => updateStop("destination", { ...place, label: place.name })} />
            </div>
            <div className="world-action-row">
              <button className="world-secondary" type="button" aria-pressed={picking === "start"} onClick={() => setPicking("start")}>Pick start on map</button>
              <button className="world-secondary" type="button" aria-pressed={picking === "destination"} onClick={() => setPicking("destination")}>Pick destination on map</button>
              <button className="world-secondary" type="button" aria-label="Swap starting point and destination" disabled={!start || !end}
                onClick={() => { setStart(end); setEnd(start); setRoute(null); }}><ArrowDownUp size={16} aria-hidden /></button>
            </div>
            <p className="world-hint">The walking route uses reported open passages around Central Parkway and Eggleston Avenue.</p>
            <button className="world-primary navigation-start" type="button" onClick={findRoute}><Footprints size={16} /> Find walking route</button>
            {error && <p className="incident-error" role="alert">{error}</p>}
            {route && <div className={`world-route-result ${route.status}`} role="status">
              <strong>{route.status === "complete" ? `Walking route · ${route.distanceMeters} m` :
                route.status === "partial" ? `Partial route · ${route.distanceMeters} m` : "Route unavailable"}</strong>
              <small>{route.reason}</small>
            </div>}
          </section>
        </div>
      </div>
    </aside>
    <section className="world-stage" aria-label="Cincinnati exercise map">
      <WorldMap active={mapIncident} incidents={[]} focus={focus} route={route} exerciseImagery={aerial ? cincinnatiFloodSurveys : undefined}
        start={start} destination={end} selectedRoad={null}
        aerial={aerial} picking={!!picking} sidebarVisible onCamera={camera => setCenter(camera.center)}
        onPoint={choosePoint} onRoad={noop} onIncident={noop} />
      {picking && <div className="world-picking" role="status">
        {picking === "start" ? "Choose your starting point" : "Choose your destination"}
        <button className="world-text" type="button" onClick={() => choosePoint(center)}>Use map center</button>
        <button className="world-text" type="button" onClick={() => setPicking(null)}>Cancel</button>
      </div>}
    </section>
  </main>;
}
