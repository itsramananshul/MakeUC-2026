"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine, Camera, ChevronRight, CircleAlert, CircleCheck, Clock3, Map,
  MapPin, Navigation, PanelLeft, Plus, QrCode, Radio, Route as RouteIcon, Satellite, ScanLine,
  Users, X,
} from "lucide-react";
import QRCode from "qrcode";
import { api, sessionUrl, timeLabel } from "@/lib/client";
import { BASE_IMAGERY } from "@/lib/imagery-frame";
import { DEFAULT_START, findRoute, initialWorld, stateLabels, type Observation, type Snapshot } from "@/lib/world";
import FieldMap, { type Layer, type Selection } from "./field-map";
import ImportImagery from "./import-imagery";
import ReportPanel from "./report-panel";

type Modal = "report" | "imagery" | "checkpoints";
type Connection = "connecting" | "online" | "stale";

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="map-dialog" onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="dialog-title">
    <div className="dialog-content">
      <header><h2 id="dialog-title">{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></header>
      {children}
    </div>
  </dialog>;
}

function CheckpointCodes({ world }: { world: Snapshot }) {
  const [selected, setSelected] = useState(world.nodes[0]?.id ?? "");
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const payload = `aftermap:${world.session.code}:${selected}`;
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(payload, { width: 256, margin: 2 })
      .then(data => { if (!cancelled) setImage(data); })
      .catch(() => { if (!cancelled) setError("The QR code could not be generated."); });
    return () => { cancelled = true; };
  }, [payload]);
  return <div className="dialog-form">
    <label>Checkpoint<select value={selected} onChange={event => { setImage(""); setSelected(event.target.value); }}>
      {world.nodes.map(node => <option value={node.id} key={node.id}>{node.label} · {node.id}</option>)}
    </select></label>
    {image && <div className="qr-preview"><img src={image} alt={`QR code for checkpoint ${selected}`} width={176} height={176} /><code>{payload}</code></div>}
    {image && <a href={image} download={`aftermap-${selected}.png`} className="quiet-btn"><ArrowDownToLine size={16} /> Save QR code</a>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

function observationTitle(item: Observation, world: Snapshot) {
  const checkpoint = world.nodes.find(node => node.id === item.nodeId);
  if (item.kind === "exit") return `${checkpoint?.label ?? "Assembly point"} reported`;
  if (item.kind === "help") return `Assistance requested · ${checkpoint?.label ?? "Checkpoint"}`;
  const edge = world.edges.find(edge => edge.id === item.edgeId);
  if (item.discovery) return "New connection reported";
  return `${edge?.label ?? "Passage"} · ${item.status === "hazard" ? "hazard" : item.status ?? "reported"}`;
}
function evidenceLabel(item: Observation) {
  return { image: "Photo", voice: "Voice", text: "Text", manual: "Manual" }[item.evidenceType];
}
function selectionFor(item: Observation): Selection | null {
  return item.edgeId ? { type: "edge", id: item.edgeId } : item.nodeId ? { type: "node", id: item.nodeId } : null;
}

export default function Aftermap() {
  const [world, setWorld] = useState(initialWorld);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [layer, setLayer] = useState<Layer>("field");
  const [start, setStart] = useState(DEFAULT_START);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [showRouteDetails, setShowRouteDetails] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const code = world.session.code;
  const selectedEdge = selection?.type === "edge" ? world.edges.find(edge => edge.id === selection.id) : null;
  const selectedNode = selection?.type === "node" ? world.nodes.find(node => node.id === selection.id) : null;
  const selectedEvidence = world.observations.filter(item =>
    selectedEdge ? item.edgeId === selectedEdge.id : selectedNode ? item.nodeId === selectedNode.id : false);
  const route = start === DEFAULT_START ? world.route : findRoute(world, start);
  const label = (id?: string) => world.nodes.find(node => node.id === id)?.label ?? "Assembly point";
  const isDrone = layer === "drone";
  const imagery = world.imagery ?? BASE_IMAGERY;

  function applyState(incoming: Snapshot) {
    setWorld(current => incoming.version >= current.version ? incoming : current);
    setConnection("online");
  }
  useEffect(() => {
    let active = true;
    let timer: number;
    let currentRequest: AbortController | null = null;
    async function refresh() {
      const controller = new AbortController();
      currentRequest = controller;
      const deadline = window.setTimeout(() => controller.abort(), 7000);
      try {
        const incoming = await api<Snapshot>(sessionUrl(code), { signal: controller.signal });
        if (active) applyState(incoming);
      } catch {
        if (active) setConnection("stale");
      } finally {
        window.clearTimeout(deadline);
        if (active) timer = window.setTimeout(refresh, 900);
      }
    }
    void refresh();
    return () => { active = false; window.clearTimeout(timer); currentRequest?.abort(); };
  }, [code]);

  function imported(state?: Snapshot) {
    if (state) applyState(state);
    setLayer("drone"); setSelection(null); setModal(null);
    setAnnouncement("Aerial imagery added to the drill.");
  }

  return <main className={`workspace ${sidebar ? "sidebar-visible" : "sidebar-hidden"}`}>
    <a className="skip-link" href="#map-stage">Skip to map</a>
    {sidebar && <aside className="sidebar" aria-label="Gaslight Maps controls">
      <header className="sidebar-header">
        <a href="/" className="brand"><span className="brand-mark"><Navigation size={16} fill="currentColor" /></span><span>Gaslight Maps</span></a>
        <button className="toggle-sidebar icon-button" type="button" aria-label="Hide sidebar" onClick={() => setSidebar(false)}><PanelLeft size={17} /></button>
      </header>

      <nav className="map-navigation" aria-label="Map layers">
        <button type="button" aria-pressed={layer === "field"} onClick={() => { setLayer("field"); setSelection(null); }}>
          <span className="nav-icon field-icon"><Map size={16} /></span>Field Map
        </button>
        <button type="button" aria-pressed={layer === "drone"} onClick={() => { setLayer("drone"); setSelection(null); }}>
          <span className="nav-icon drone-icon"><Satellite size={16} /></span>Drone View
        </button>
      </nav>

      <div className="sidebar-scroll">
        <section className="session-section" aria-label="Current drill">
          <div className="session-kicker"><Radio size={13} /> Coastal response drill</div>
          <h1>{world.session.name}</h1>
          <div className="session-meta">
            <span className={`connection ${connection}`}><i />{connection === "online" ? "Live" : connection === "connecting" ? "Connecting" : "Offline"}</span>
            <span className="meta-divider" />
            <span><Users size={13} /> {world.participants.length} {world.participants.length === 1 ? "reporter" : "reporters"}</span>
          </div>
          {connection === "stale" && <p className="stale-note" role="status">Showing the last available map. Reconnecting…</p>}
        </section>

        {isDrone ? <section className="sidebar-section">
          <h2>Aerial imagery</h2>
          <div className="imagery-row"><Satellite size={18} /><div><strong>{imagery.label}</strong><small>{imagery.source}</small></div></div>
          {!imagery.aligned && <p className="route-note">This upload covers a different area. Switch to Field Map for drill checkpoints.</p>}
          <button type="button" className="sidebar-link" onClick={() => setModal("imagery")}><Plus size={16} /> Import imagery</button>
        </section> : <section className="sidebar-section route-section">
          <h2>Directions</h2>
          <label className="from-row"><span><MapPin size={14} /> From</span>
            <select value={start} onChange={event => setStart(event.target.value)}>
              {world.nodes.filter(node => node.kind !== "exit").map(node => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
          </label>
          <button className={`route-card ${route ? "has-route" : ""}`} type="button"
            aria-expanded={showRouteDetails} onClick={() => setShowRouteDetails(!showRouteDetails)}>
            <RouteIcon size={21} />
            <span><strong>{route ? "Candidate route" : "Waiting for a route"}</strong>
              <small>{route ? `${label(route.nodeIds.at(-1))} · ${route.edgeIds.length} passages` : "Needs a reported path to assembly"}</small></span>
            <ChevronRight size={17} className={showRouteDetails ? "rotated" : ""} />
          </button>
          {start === DEFAULT_START && world.routeChange && <p className="route-note" role="status">
            {world.route ? "Route updated. " : "Previous route withdrawn. "}{world.routeChange.reason}
          </p>}
          {showRouteDetails && <div className="route-steps">
            {route ? <ol>{route.nodeIds.map(id => <li key={id}>{label(id)}</li>)}</ol> :
              <p>Reports need to connect the starting point to a reported assembly point. Blocked, disputed, and unobserved links are excluded.</p>}
          </div>}
        </section>}

        <section className="sidebar-section activity">
          <h2>Reports <span>{world.observations.length}</span></h2>
          {world.observations.length === 0 ? <div className="empty-reports"><Clock3 size={17} /><div><strong>No field reports yet</strong><small>Updates appear here after a reporter confirms them.</small></div></div> :
            <ul>{world.observations.map(item => <li key={item.id}>
              <button type="button" className="report-row" onClick={() => setSelection(selectionFor(item))}>
                <span className={`report-symbol ${item.status === "blocked" ? "red" : item.status === "hazard" || item.kind === "help" ? "amber" : "blue"}`}>
                  {item.status === "blocked" || item.status === "hazard" || item.kind === "help" ? <CircleAlert size={16} /> :
                    item.evidenceType === "image" ? <Camera size={15} /> : <CircleCheck size={16} />}
                </span>
                <span className="report-text"><strong>{observationTitle(item, world)}</strong>
                  <small>{item.displayName} · {evidenceLabel(item)}</small></span>
                <time dateTime={item.timestamp}>{timeLabel(item.timestamp)}</time>
              </button>
            </li>)}</ul>}
        </section>
      </div>
      <footer className="sidebar-footer">
        <button type="button" className="join-btn" onClick={() => setModal("report")}><ScanLine size={17} /> Join or report</button>
        <button type="button" className="icon-button" onClick={() => setModal("checkpoints")} title="Checkpoint codes" aria-label="Checkpoint codes"><QrCode size={18} /></button>
      </footer>
    </aside>}

    <div className="map-stage" id="map-stage">
      {!sidebar && <button type="button" className="icon-button restore-sidebar" aria-label="Show sidebar" onClick={() => setSidebar(true)}><PanelLeft size={19} /></button>}
      <FieldMap world={world} route={route} layer={layer} selection={selection} onSelect={setSelection} />

      {(selectedEdge || selectedNode) && <section className="detail-panel" aria-label="Map feature details">
        <header><div><small>{selectedEdge ? "Passage" : "Checkpoint"}</small><h2>{selectedEdge?.label ?? selectedNode?.label}</h2></div>
          <button type="button" className="icon-button" aria-label="Close map details" onClick={() => setSelection(null)}><X size={16} /></button></header>
        {selectedEdge && <p className={`edge-status ${selectedEdge.state}`}><i />{stateLabels[selectedEdge.state]}{selectedEdge.discovered && " · Newly mapped"}</p>}
        {selectedNode && <p className="edge-status"><MapPin size={14} />Checkpoint {selectedNode.id}</p>}
        {selectedEvidence.length === 0 ? <p className="detail-empty">{selectedEdge?.state === "open" ? "Starting condition from the drill setup." : "No confirmed field report for this location."}</p> :
          <ul>{selectedEvidence.slice(0, 8).map(item => <li key={item.id}><strong>{item.displayName}</strong>
            <small>{evidenceLabel(item)} · {timeLabel(item.timestamp)}{item.status ? ` · ${item.status}` : ""}</small>
            {item.note && <p>{item.note}</p>}</li>)}</ul>}
      </section>}
    </div>
    <div className="sr-only" role="status">{announcement}</div>
    {modal === "report" && <Dialog title="Field report" onClose={() => setModal(null)}><ReportPanel world={world} onState={applyState} /></Dialog>}
    {modal === "imagery" && <Dialog title="Import aerial imagery" onClose={() => setModal(null)}><ImportImagery code={code} onImport={imported} /></Dialog>}
    {modal === "checkpoints" && <Dialog title="Checkpoint codes" onClose={() => setModal(null)}><CheckpointCodes world={world} /></Dialog>}
  </main>;
}
