"use client";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Navigation, Crosshair, Minus, Plus } from "lucide-react";
import { BASE_IMAGERY } from "@/lib/imagery-frame";
import { stateLabels, type Checkpoint, type Edge, type Route, type Snapshot } from "@/lib/world";

export type Layer = "field" | "drone";
export type Selection = { type: "node" | "edge"; id: string };
const routePoints = (route: Route | null, nodes: Map<string, Checkpoint>) => route?.nodeIds
  .map(id => nodes.get(id))
  .filter((node): node is Checkpoint => !!node)
  .map(node => `${node.x},${node.y}`)
  .join(" ");

export default function FieldMap({ world, route, layer, selection, onSelect }: {
  world: Snapshot; route: Route | null; layer: Layer; selection: Selection | null;
  onSelect: (value: Selection) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [moving, setMoving] = useState(false);
  const nodes = new Map(world.nodes.map(node => [node.id, node]));
  const imagery = layer === "drone" ? world.imagery ?? BASE_IMAGERY : BASE_IMAGERY;
  const showGraph = imagery.aligned;
  const exits = new Set(world.observations.filter(item => item.kind === "exit").map(item => item.nodeId));
  const help = new Set(world.observations.filter(item => item.kind === "help").map(item => item.nodeId));
  const previous = routePoints(world.previousRoute, nodes);
  const current = routePoints(route, nodes);

  function changeZoom(delta: number) {
    setZoom(current => Math.min(3, Math.max(.8, current + delta)));
  }
  function reset() { setZoom(1); setOffset({ x: 0, y: 0 }); }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || (event.target as Element).closest("[data-map-feature]")) return;
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    setMoving(true);
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const scale = svgRef.current?.getScreenCTM()?.a ?? 1;
    setOffset({
      x: drag.current.ox + (event.clientX - drag.current.x) / scale,
      y: drag.current.oy + (event.clientY - drag.current.y) / scale,
    });
  }
  function stop() { drag.current = null; setMoving(false); }
  function keys(event: KeyboardEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    const shift: Record<string, [number, number]> = {
      ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45],
    };
    if (shift[event.key]) {
      event.preventDefault();
      const [dx, dy] = shift[event.key];
      setOffset(position => ({ x: position.x + dx, y: position.y + dy }));
    }
    if (event.key === "+" || event.key === "=") changeZoom(.25);
    if (event.key === "-") changeZoom(-.25);
    if (event.key === "0") reset();
  }
  function activate(event: KeyboardEvent<SVGGElement>, value: Selection) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(value); }
  }
  function line(edge: Edge) {
    const a = nodes.get(edge.from), b = nodes.get(edge.to);
    if (!a || !b) return null;
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    const closed = edge.state === "blocked" || edge.state === "hazard" || edge.state === "conflict";
    const value: Selection = { type: "edge", id: edge.id };
    return <g key={edge.id} className={`feature passage ${edge.state} ${selection?.id === edge.id ? "selected" : ""}`}
      data-map-feature="" role="button" tabIndex={0} aria-label={`${edge.label}, ${stateLabels[edge.state]}`}
      onClick={() => onSelect(value)} onKeyDown={event => activate(event, value)}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="edge-hit" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="edge-base" />
      {closed && <g transform={`translate(${x} ${y})`} pointerEvents="none">
        <circle className="closure" r="12" />
        <path d={edge.state === "blocked" ? "M-4 0H4" : "M0 -5V1M0 4V4.5"} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </g>}
    </g>;
  }
  return <section className={`map-area ${layer === "drone" ? "aerial-mode" : "field-mode"}`} aria-label="Live field map">
    <svg ref={svgRef} className={`map-svg ${moving ? "panning" : ""}`} viewBox="0 0 1000 720" tabIndex={0}
      aria-label="Map. Arrow keys pan. Plus and minus zoom. Zero resets." preserveAspectRatio={showGraph ? "xMidYMid slice" : "xMidYMid meet"}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={stop} onPointerCancel={stop}
      onLostPointerCapture={stop} onKeyDown={keys}>
      <defs>
        <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
          <path d="M64 0H0V64" fill="none" stroke="#dce7ea" strokeWidth=".7" opacity=".2" />
        </pattern>
        <radialGradient id="vignette"><stop offset=".6" stopColor="#000" stopOpacity="0"/><stop offset="1" stopColor="#081016" stopOpacity=".34"/></radialGradient>
      </defs>
      <g transform={`translate(${500 + offset.x} ${360 + offset.y}) scale(${zoom}) translate(-500 -360)`}>
        {showGraph && <image href={BASE_IMAGERY.url} width="1000" height="720" preserveAspectRatio="none" />}
        {(!showGraph || imagery.url !== BASE_IMAGERY.url) && <image href={imagery.url} width="1000" height="720" preserveAspectRatio={showGraph ? "none" : "xMidYMid meet"} />}
        {showGraph && <>
          <rect className="imagery-wash" width="1000" height="720" />
          <rect className="field-grid" width="1000" height="720" fill="url(#grid)" />
          <rect width="1000" height="720" fill="url(#vignette)" pointerEvents="none" />
          {world.edges.map(line)}
          {previous && previous !== current && <polyline className="previous-line" points={previous} />}
          {current && <g key={current} className="route-path">
            <polyline className="route-outline" points={current} /><polyline className="route-line" points={current} />
          </g>}
          {world.nodes.map(node => {
            const value: Selection = { type: "node", id: node.id };
            const major = node.kind === "entrance" || node.kind === "exit" || help.has(node.id);
            return <g key={node.id} transform={`translate(${node.x} ${node.y})`}
              className={`feature checkpoint ${major ? "major" : ""} ${exits.has(node.id) ? "verified" : ""} ${help.has(node.id) ? "needs-help" : ""} ${selection?.id === node.id ? "selected" : ""}`}
              data-map-feature="" role="button" tabIndex={0} aria-label={node.label}
              onClick={() => onSelect(value)} onKeyDown={event => activate(event, value)}>
              <circle r="15" fill="transparent" />
              <circle className="checkpoint-dot" r={major ? 8 : 4.8} />
              {major ? <text x={node.kind === "entrance" ? -12 : 13} y={-12} textAnchor={node.kind === "entrance" ? "end" : "start"} className="map-label">{node.label}</text> :
                <text x="9" y="17" className="map-label secondary">{node.label}</text>}
            </g>;
          })}
          {world.participants.filter(participant => participant.checkpointId).map((participant, i) => {
            const node = nodes.get(participant.checkpointId!);
            if (!node) return null;
            const group = world.participants.filter(person => person.checkpointId === participant.checkpointId);
            const index = group.findIndex(person => person.id === participant.id);
            const side = node.kind === "exit" ? -1 : 1;
            const x = node.x + side * (17 + index * 17), y = node.y - 19 - index * 12;
            return <g className="reporter-pin" key={participant.id} transform={`translate(${x} ${y})`} aria-label={participant.displayName}>
              <title>{participant.displayName}</title>
              <circle r="10" fill={["#2386ef", "#8d70e3", "#188c9c"][i % 3]} />
              <text textAnchor="middle" dominantBaseline="central">{participant.displayName.slice(0, 1).toUpperCase()}</text>
            </g>;
          })}
        </>}
      </g>
    </svg>

    <div className="scenario-tag"><span />Training scenario</div>
    <div className="map-controls">
      <button type="button" className="compass" onClick={reset} title="Reset map" aria-label="Reset map to north"><Navigation size={15} fill="currentColor" /><span>N</span></button>
      <div className="zoom-stack">
        <button type="button" onClick={() => changeZoom(.25)} aria-label="Zoom in" disabled={zoom >= 3}><Plus size={18} /></button>
        <button type="button" onClick={() => changeZoom(-.25)} aria-label="Zoom out" disabled={zoom <= .8}><Minus size={18} /></button>
      </div>
      <button type="button" onClick={reset} aria-label="Center map"><Crosshair size={17} /></button>
    </div>
    {showGraph && <div className="map-legend" aria-label="Map legend">
      <span><i className="legend-route" />Candidate route</span><span><i className="legend-block" />Blocked</span>
      <span><i className="legend-conflict" />Hazard or dispute</span><span><i className="legend-unknown" />Unobserved</span>
    </div>}
    <div className="map-attribution">{imagery.url === BASE_IMAGERY.url
      ? <a href="https://www.fisheries.noaa.gov/inport/item/57759" target="_blank" rel="noreferrer">NOAA / NGS · October 2018</a>
      : imagery.source}</div>
  </section>;
}
