"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Footprints, Satellite } from "lucide-react";
import { incidentRoute } from "@/lib/incident-route";
import type { Incident } from "@/lib/incident-types";
import WorldMap from "../../world-map";

const origin = { latitude: 39.10736, longitude: -84.50947 };
const destination = { latitude: 39.10801, longitude: -84.5086477 };
const routeCenter = { latitude: 39.1077, longitude: -84.50905 };
const noop = () => {};

export default function CincinnatiExercise({ incident }: { incident: Incident }) {
  const [aerial, setAerial] = useState(true);
  const [showRoute, setShowRoute] = useState(false);
  const mapIncident = useMemo(() => ({ ...incident, imagery: null }), [incident]);
  const route = useMemo(() => showRoute ? incidentRoute(incident, origin, destination) : null, [showRoute, incident]);
  const focus = useMemo(() => showRoute ? { point: routeCenter, zoom: 17.8 } :
    { bounds: incident.imagery?.bounds ?? incident.bounds }, [showRoute, incident]);

  return <main className="world-app with-world-sidebar">
    <aside className="world-sidebar" aria-label="Cincinnati exercise">
      <div className="world-tray">
        <div className="world-scroll">
          <Link className="world-text" href="/"><ArrowLeft size={15} /> World map</Link>
          <section className="world-section active-incident">
          <p className="incident-caption">Aerial imagery preview</p>
            <h1>Cincinnati flood</h1>
            <p className="world-hint">Explore the downtown map stitched from five georeferenced images. The red segment shows a reported closure on East Central Parkway.</p>
            <div className="world-action-row">
              <button className="world-secondary" type="button" aria-pressed={aerial} onClick={() => setAerial(!aerial)}><Satellite size={16} /> Flood imagery</button>
              <button className="world-primary" type="button" aria-pressed={showRoute} onClick={() => setShowRoute(!showRoute)}><Footprints size={16} /> {showRoute ? "Show downtown" : "Find exercise route"}</button>
            </div>
            {route && <div className={`world-route-result ${route.status}`} role="status">
              <strong>{route.status === "complete" ? `Walking route · ${route.distanceMeters} m` : "Route unavailable"}</strong>
              <small>{route.status === "complete" ? "The blue line uses the field-reported passage through the rubble toward Eggleston Avenue." : route.reason}</small>
            </div>}
          </section>
        </div>
      </div>
    </aside>
    <section className="world-stage" aria-label="Cincinnati exercise map">
      <WorldMap active={mapIncident} incidents={[]} focus={focus} route={route} exerciseImagery={aerial ? incident.imagery ?? undefined : undefined}
        start={showRoute ? origin : null} destination={showRoute ? destination : null} selectedRoad={null}
        aerial={aerial} picking={false} sidebarVisible onCamera={noop} onPoint={noop} onRoad={noop} onIncident={noop} />
    </section>
  </main>;
}
