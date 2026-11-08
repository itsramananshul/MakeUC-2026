"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
import WorldMap from "../world-map";
import type { Coordinate, GeographicBounds } from "@/lib/incident-types";
import surveys from "./surveys.json";
import "./venezuela.css";

const source = "https://source.coop/planet/venezuela-earthquake-2026-06-24";
const license = "https://creativecommons.org/licenses/by-nc/4.0/";
const imagery = surveys.map(survey => ({ ...survey, source: "Planet Crisis Response" }));
const locations = [
  { name: "Caracas", latitude: 10.4915, longitude: -66.873, zoom: 12.8 },
  { name: "La Guaira", latitude: 10.600, longitude: -66.934, zoom: 17 },
  { name: "Catia La Mar", latitude: 10.6095023, longitude: -67.015937, zoom: 17 },
  { name: "Caraballeda", latitude: 10.61450793, longitude: -66.83972965, zoom: 17 },
  { name: "Puerto Cabello", latitude: 10.489, longitude: -68.095, zoom: 13 },
  { name: "Valencia", latitude: 10.167, longitude: -68, zoom: 12.8 },
  { name: "Ocumare de la Costa", latitude: 10.477, longitude: -67.769, zoom: 13 },
  { name: "Yumare", latitude: 10.595, longitude: -68.674, zoom: 13 },
];
const country = { west: -73.5, south: 0.5, east: -59.7, north: 12.6 };
const noAction = () => {};

export default function VenezuelaMap() {
  const [focus, setFocus] = useState<{ bounds: GeographicBounds } | { point: Coordinate; zoom: number }>({ bounds: country });
  const [showAfter, setShowAfter] = useState(true);

  return <main className="world-app world-main-map with-world-sidebar venezuela-map">
    <a className="world-skip" href="#venezuela-map">Skip to map</a>
    <aside className="world-sidebar" data-sheet="1" aria-label="Venezuela earthquake imagery">
      <div className="world-tray">
        <div className="world-scroll">
          <Link className="venezuela-back" href="/"><ArrowLeft size={16} aria-hidden /> Live map</Link>
          <h1 className="tray-heading">Venezuela earthquakes</h1>
          <p className="venezuela-date">June 24, 2026 · Historical imagery</p>
          <p>Satellite images captured June 26–28 cover parts of northern Venezuela. The base map fills gaps in coverage.</p>
          <div className="world-action-row">
            <button type="button" className="world-secondary" aria-pressed={showAfter} onClick={() => setShowAfter(value => !value)}>
              Post-earthquake imagery
            </button>
            <button type="button" className="world-secondary" onClick={() => setFocus({ bounds: country })}>Show Venezuela</button>
          </div>
          <p><Link href="/venezuela/catia-la-mar">View Catia La Mar aerial imagery</Link></p>
          <ul className="venezuela-locations" aria-label="Areas with imagery">
            {locations.map(({ name, zoom, ...point }) => <li key={name}>
              <button type="button" className="world-result" onClick={() => setFocus({ point, zoom })}>
                <MapPin size={17} aria-hidden /> <strong>{name}</strong>
              </button>
            </li>)}
          </ul>
          <p className="venezuela-credit">Imagery © 2026 Planet Labs PBC. Reprojected and resampled for this map. <a href={source}>Source catalog</a> · <a href={license}>CC BY-NC 4.0</a></p>
          <p className="venezuela-credit">Historical images do not indicate current road conditions. <a href="https://mapping.emergency.copernicus.eu/activations/EMSR884/">Copernicus damage assessment</a></p>
        </div>
      </div>
    </aside>
    <section id="venezuela-map" className="world-stage" aria-label="Venezuela satellite map">
      <WorldMap incidents={[]} active={null} focus={focus} route={null} start={null} destination={null} selectedRoad={null}
        picking={false} aerial={false} sidebarVisible
        archivedImagery={showAfter ? imagery : undefined}
        onCamera={noAction} onPoint={noAction} onRoad={noAction} onIncident={noAction} />
      {showAfter && <div className="venezuela-map-credit">
        <span>Historical imagery · June 2026</span>
        <a href={source}>© Planet Labs PBC</a> · <a href={license}>CC BY-NC 4.0</a>
      </div>}
    </section>
  </main>;
}
