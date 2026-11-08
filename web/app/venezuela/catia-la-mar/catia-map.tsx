"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import WorldMap from "../../world-map";
import type { GeographicBounds, IncidentImagery } from "@/lib/incident-types";
import "../venezuela.css";

const noAction = () => {};

export default function CatiaMap({ imagery, selected }: { imagery: IncidentImagery[]; selected: number }) {
  const extent = imagery.reduce<GeographicBounds>((bounds, tile) => ({
    west: Math.min(bounds.west, tile.bounds.west), south: Math.min(bounds.south, tile.bounds.south),
    east: Math.max(bounds.east, tile.bounds.east), north: Math.max(bounds.north, tile.bounds.north),
  }), imagery[0].bounds);
  const [focus, setFocus] = useState({ bounds: extent });
  const [visible, setVisible] = useState(true);

  return <main className="world-app world-main-map with-world-sidebar venezuela-map">
    <a className="world-skip" href="#catia-map">Skip to map</a>
    <aside className="world-sidebar" data-sheet="1" aria-label="Catia La Mar aerial imagery">
      <div className="world-tray"><div className="world-scroll">
        <Link className="venezuela-back" href="/"><ArrowLeft size={16} aria-hidden /> Live map</Link>
        <h1 className="tray-heading">Catia La Mar</h1>
        <p className="venezuela-date">AI-generated aerial imagery</p>
        <p>{selected ? `${selected} selected ${selected === 1 ? "image" : "images"} placed on the map.` : "Citywide aerial imagery with detailed images as you zoom in."}</p>
        <div className="world-action-row">
          <button type="button" className="world-secondary" aria-pressed={visible} onClick={() => setVisible(value => !value)}>Aerial imagery</button>
          {selected ? <Link className="world-secondary" href="/venezuela/catia-la-mar">Show full city</Link>
            : <button type="button" className="world-secondary" onClick={() => setFocus({ bounds: extent })}>Show full city</button>}
        </div>
      </div></div>
    </aside>
    <section id="catia-map" className="world-stage" aria-label="Catia La Mar satellite map">
      <WorldMap incidents={[]} active={null} focus={focus} route={null} start={null} destination={null} selectedRoad={null}
        picking={false} aerial={false} sidebarVisible archivedImagery={visible ? imagery : undefined}
        onCamera={noAction} onPoint={noAction} onRoad={noAction} onIncident={noAction} />
      {visible && <div className="venezuela-map-credit">AI-generated imagery</div>}
    </section>
  </main>;
}
