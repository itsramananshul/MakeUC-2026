"use client";

import {
  ArrowLeft, ArrowRight, ChevronRight, Crosshair, Footprints, Globe, KeyRound, Layers3,
  MapPin, Navigation2, PanelLeft, Plus, Route, Satellite, Search, ShieldAlert, X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { distanceMeters, within, type Coordinate, type GeographicBounds, type Incident, type IncidentRoute, type IncidentSummary, type Place } from "@/lib/incident-types";
import { fetchJson, incidentPath, postJson } from "@/lib/world-client";
import { AccessKey, CreateIncident, Modal, ReportIncident, SurveyUpload } from "./incident-dialogs";
import WorldMap from "./world-map";

type Focus = { point: Coordinate; zoom?: number } | { bounds: GeographicBounds };
type Picking = "start" | "destination" | "point" | "connection" | null;
type ModalKind = "create" | "access" | "report" | "survey" | null;
const labels = { unknown: "Unverified", open: "Reported open", blocked: "Blocked", hazard: "Hazard", conflict: "Disputed" };
const earth = { latitude: 24, longitude: 0 };
const endpointLabel = (point: Coordinate) => `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;
const accessStorage = (id: string) => `aftermap.access.${id}`;
const getMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong.";

export default function WorldApp() {
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [active, setActive] = useState<Incident | null>(null);
  const [selected, setSelected] = useState("");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [center, setCenter] = useState<Coordinate>(earth);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [searching, setSearching] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const [start, setStart] = useState<Coordinate | null>(null);
  const [destination, setDestination] = useState<Coordinate | null>(null);
  const [route, setRoute] = useState<IncidentRoute | null>(null);
  const [requested, setRequested] = useState(0);
  const [routing, setRouting] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [points, setPoints] = useState<Coordinate[]>([]);
  const [roadId, setRoadId] = useState<string | null>(null);
  const [roadQuery, setRoadQuery] = useState("");
  const [aerial, setAerial] = useState(true);
  const [access, setAccess] = useState("");
  const [importing, setImporting] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selectedRoad = active?.roads.find(road => road.id === roadId) ?? null;
  const roadMatches = roadQuery.trim() ? (active?.roads ?? [])
    .filter(road => road.label.toLowerCase().includes(roadQuery.trim().toLowerCase()))
    .map(road => ({ road, distance: distanceMeters(center, road.from) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 8) : [];

  function refreshList() {
    return fetchJson<{ incidents: IncidentSummary[] }>("/api/incidents").then(value => setIncidents(value.incidents));
  }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("incident") ?? "";
    if (id) setSelected(id);
    void refreshList().catch(error => setError(getMessage(error)));
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshList().catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    let first = true;
    async function refresh() {
      if (document.hidden && !first) return;
      try {
        const next = await fetchJson<Incident>(incidentPath(selected), { signal: AbortSignal.timeout(9000) });
        if (cancelled) return;
        setActive(current => current?.id === next.id && current.version >= next.version ? current : next);
        setStale(false);
        if (first) { setFocus({ bounds: next.bounds }); first = false; }
      } catch (error) {
        if (!cancelled) { setStale(true); if (first) setError(getMessage(error)); }
      }
    }
    setAccess(localStorage.getItem(accessStorage(selected)) ?? "");
    void refresh();
    const timer = window.setInterval(refresh, 4500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [selected]);

  function changeAccess(key: string, id = selected) {
    setAccess(key);
    try { localStorage.setItem(accessStorage(id), key); } catch {}
  }
  function chooseIncident(id: string) {
    if (id === selected) { if (active) setFocus({ bounds: active.bounds }); return; }
    setActive(null); setSelected(id); setRoadId(null); setRoadQuery(""); setPoints([]); setStale(false); setError("");
    setRequested(0); setRoute(null); setTripOpen(false); setPicking(null); setStart(null); setDestination(null);
    setPlace(null); setPlaces([]); setSidebar(true);
    const url = new URL(location.href);
    if (id) url.searchParams.set("incident", id); else url.searchParams.delete("incident");
    history.replaceState(null, "", url);
  }
  function applyIncident(next: Incident) {
    setActive(current => current?.id === next.id && current.version > next.version ? current : next);
    setIncidents(current => [next, ...current.filter(item => item.id !== next.id)]);
  }
  function create(next: Incident, key: string) {
    chooseIncident(next.id); applyIncident(next); changeAccess(key, next.id);
    setFocus({ bounds: next.bounds }); setModal("access");
    setMessage("Incident created. Share its access key with your field team.");
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true); setPlaces([]); setPlace(null); setError("");
    try {
      const result = await fetchJson<{ places: Place[] }>(`/api/places?q=${encodeURIComponent(query.trim())}`);
      setPlaces(result.places);
      if (!result.places.length) setMessage("No places matched that search.");
    } catch (error) { setError(getMessage(error)); }
    finally { setSearching(false); }
  }
  function choosePlace(item: Place) {
    setPlace(item); setPlaces([]); setMessage("");
    setFocus({ point: item, zoom: 15 });
  }
  function resetRoute() { setRequested(0); setRoute(null); }
  function choosePoint(point: Coordinate) {
    if (picking === "start") { setStart(point); resetRoute(); }
    if (picking === "destination") { setDestination(point); setPlace(null); resetRoute(); }
    if (picking === "point" || picking === "connection") {
      if (active && !within(point, active.bounds)) { setError("Choose a point inside the incident boundary."); return; }
      if (picking === "connection" && points.length === 1 && distanceMeters(points[0], point) < 1) {
        setError("Choose a different point for the other end."); return;
      }
      const next = picking === "point" ? [point] : [...points, point];
      setPoints(next); setError("");
      if (picking === "connection" && next.length === 1) return;
      setRoadId(null); setModal("report");
    }
    setPicking(null);
  }
  function myLocation() {
    if (!navigator.geolocation) { setError("Location is unavailable in this browser."); return; }
    navigator.geolocation.getCurrentPosition(position => {
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setStart(point); resetRoute(); setPicking(null); setFocus({ point, zoom: 15 });
    }, () => setError("Could not get your location. Pick a starting point on the map."), { timeout: 8000 });
  }
  const routeVersion = active?.version;
  useEffect(() => {
    if (!requested || !start || !destination) return;
    let cancelled = false;
    async function loadRoute() {
      setRouting(true); setError("");
      try {
        const endpoint = active && within(start!, active.bounds) ? incidentPath(active.id, "route") : "/api/routes";
        const next = await postJson<IncidentRoute>(endpoint, { origin: start, destination });
        if (!cancelled) setRoute(next);
      } catch (error) { if (!cancelled) { setRoute(null); setError(getMessage(error)); } }
      finally { if (!cancelled) setRouting(false); }
    }
    void loadRoute();
    return () => { cancelled = true; };
    // A newer incident version recomputes an already-requested candidate.
  }, [requested, start, destination, routeVersion, active?.id]);

  function needAccess(action: () => void) {
    if (!access) { setModal("access"); return; }
    action();
  }
  async function importStreets() {
    if (!active) return;
    setImporting(true); setError("");
    try {
      const { incident } = await postJson<{ incident: Incident }>(incidentPath(active.id, "roads"), {}, access);
      applyIncident(incident);
      setMessage(`Imported OpenStreetMap passages. ${incident.roadCount.toLocaleString()} segments in this incident.`);
    } catch (error) { setError(getMessage(error)); }
    finally { setImporting(false); }
  }
  function startTrip(point?: Coordinate) {
    setTripOpen(true); resetRoute(); setPlaces([]);
    if (point) setDestination(point);
  }
  function selectRoad(id: string) {
    setRoadId(id); setPoints([]); setSidebar(true);
  }
  const pickLabel = picking === "start" ? "Choose a starting point" : picking === "destination" ? "Choose a destination" :
    picking === "point" ? "Choose a report location" : points.length ? "Choose the end of the passage" : "Choose the start of the passage";

  return <main className={`world-app ${sidebar ? "with-world-sidebar" : ""}`}>
    <a className="world-skip" href="#map-view">Skip to map</a>
    {sidebar && <aside className="world-sidebar" aria-label="Map controls">
      <header className="world-brand">
        <button className="wordmark" type="button" onClick={() => { chooseIncident(""); setFocus({ point: earth, zoom: 1.65 }); }}>
          <span><Navigation2 size={16} fill="currentColor" /></span>Aftermap
        </button>
        <button className="circle-button" aria-label="Hide sidebar" onClick={() => setSidebar(false)}><PanelLeft size={17} /></button>
      </header>
      <div className="world-scroll">
        <form className="world-search" onSubmit={search}>
          <Search size={18} aria-hidden />
          <input aria-label="Search places" placeholder="Search a place or address…" value={query} maxLength={120} onChange={event => setQuery(event.target.value)} />
          <button type="submit" aria-label="Search" disabled={searching || query.trim().length < 2}>{searching ? "…" : <ArrowRight size={17} />}</button>
        </form>
        {!!places.length && <div className="world-results" aria-label="Search results">
          {places.map(item => <button key={item.id} type="button" className="world-result" onClick={() => choosePlace(item)}>
            <MapPin size={16} /><span><strong>{item.name}</strong><small>{item.detail}</small></span><ChevronRight size={14} />
          </button>)}
          <small className="world-attribution">Search by <a href="https://github.com/komoot/photon" target="_blank" rel="noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></small>
        </div>}
        {place && <div className="world-place">
          <div><MapPin size={19} /><div><strong>{place.name}</strong><small>{place.detail}</small></div>
            <button type="button" className="circle-button" aria-label="Clear place" onClick={() => setPlace(null)}><X size={15} /></button></div>
          <button className="world-secondary" type="button" onClick={() => startTrip(place)}><Route size={15} /> Directions here</button>
        </div>}

        {tripOpen ? <section className="world-section trip">
          <header><h2><Footprints size={16} /> Walking directions</h2>
            <button className="circle-button" aria-label="Close directions" onClick={() => { setTripOpen(false); setPicking(null); resetRoute(); }}><X size={15} /></button></header>
          <button className="world-pick" onClick={() => { setPicking("start"); resetRoute(); }}><i />{start ? endpointLabel(start) : "Pick start on map"}<ChevronRight size={15} /></button>
          <button className="world-pick" onClick={() => { setPicking("destination"); resetRoute(); }}><i />{destination ? place?.latitude === destination.latitude && place.longitude === destination.longitude ? place.name : endpointLabel(destination) : "Pick destination on map"}<ChevronRight size={15} /></button>
          <div className="world-action-row"><button className="world-secondary" onClick={myLocation}><Crosshair size={16} /> My location</button>
            <button className="world-primary" disabled={!start || !destination || routing} onClick={() => setRequested(value => value + 1)}>{routing ? "Finding…" : "Find route"}</button></div>
          {route && <div className={`world-route-result ${route.status}`} role="status">
            <strong>{route.status === "unavailable" ? "Route unavailable" : route.status === "partial" ? "Partial route" : "Walking route"}
              {route.distanceMeters > 0 && ` · ${route.distanceMeters.toLocaleString()} m`}</strong><small>{route.reason}</small>
            {!active && <small><a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">OSRM routing</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Fix the map</a></small>}
          </div>}
        </section> : <button type="button" className="world-nav" onClick={() => startTrip()}><span><Route size={17} /></span> Directions <ChevronRight size={15} /></button>}

        {active ? <section className="world-section active-incident">
          <button type="button" className="world-text" onClick={() => chooseIncident("")}><ArrowLeft size={15} /> All incidents</button>
          <h1>{active.name}</h1>
          <p className="incident-caption"><span className={stale ? "sync stale" : "sync"} />{stale ? "Showing last update" : "Live incident"} · {active.roadCount.toLocaleString()} segments</p>
          <div className="world-action-row">
            <button className="world-secondary" type="button" onClick={() => setAerial(!aerial)} aria-pressed={aerial}><Satellite size={16} /> Aerial view</button>
            <button className="world-secondary" type="button" onClick={() => needAccess(() => setModal("survey"))}><Layers3 size={16} /> Add imagery</button>
          </div>
          {aerial && active.imagery && <small className="world-attribution">{active.imagery.source}</small>}
          <div className="world-action-row">
            <button className="world-secondary" type="button" disabled={importing} onClick={() => needAccess(() => void importStreets())}>{importing ? "Importing…" : "Import roads"}</button>
            <button className="world-secondary" type="button" onClick={() => setModal("access")}><KeyRound size={15} /> Access key</button>
          </div>
          <div className="world-action-row">
            <button className="world-text" type="button" onClick={() => needAccess(() => { setPoints([]); setPicking("point"); })}><MapPin size={15} /> Report a point</button>
            <button className="world-text" type="button" onClick={() => needAccess(() => { setPoints([]); setPicking("connection"); })}><Plus size={15} /> Add passage</button>
          </div>
          {!!active.roadCount && <div className="road-finder">
            <input aria-label="Find an incident road" placeholder="Find a road in this area…" value={roadQuery} onChange={event => setRoadQuery(event.target.value)} />
            {roadMatches.length > 0 && <div className="road-matches">{roadMatches.map(({ road }) => <button type="button" key={road.id}
              onClick={() => { selectRoad(road.id); setRoadQuery(""); setFocus({ point: road.from, zoom: 17.5 }); }}>
              <strong>{road.label}</strong><small>{labels[road.state]}</small>
            </button>)}</div>}
          </div>}
          {selectedRoad ? <div className="selected-road">
            <div><strong>{selectedRoad.label}</strong><small>{labels[selectedRoad.state]}</small></div>
            <button className="world-secondary" onClick={() => needAccess(() => setModal("report"))}>Report condition</button>
          </div> : <p className="world-hint">Select a road on the map to view or report its condition.</p>}
          <h2 className="reports-title">Field reports <small>{active.reports.length}</small></h2>
          {active.reports.length ? <ul className="world-reports">{active.reports.slice(0, 40).map(report => <li key={report.id}>
            <div><strong>{report.displayName}</strong><time dateTime={report.at}>{new Date(report.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
            <small>{report.condition ? labels[report.condition] : "Location report"} · {report.evidenceType}</small>
            {report.note && <p>{report.note}</p>}
            {report.evidenceUrl && access && <button className="world-text" onClick={async () => {
              try {
                const response = await fetch(report.evidenceUrl!, { headers: { Authorization: `Bearer ${access}` } });
                if (!response.ok) throw new Error("Could not open evidence.");
                const url = URL.createObjectURL(await response.blob());
                const anchor = document.createElement("a"); anchor.href = url; anchor.download = `aftermap-${report.id}.jpg`; anchor.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (error) { setError(getMessage(error)); }
            }}>Download evidence photo</button>}
          </li>)}</ul> : <p className="world-hint">Confirmed reports will appear here.</p>}
        </section> : <section className="world-section">
          <header><h2><ShieldAlert size={16} /> Incidents</h2>
            <button className="world-text" type="button" onClick={() => setModal("create")}><Plus size={16} /> New incident</button></header>
          {incidents.length ? <ul className="incident-list">{incidents.map(item => <li key={item.id}><button type="button" onClick={() => chooseIncident(item.id)}>
            <span><strong>{item.name}</strong><small>{item.roadCount.toLocaleString()} mapped segments{item.imagery ? " · Aerial survey" : ""}</small></span><ChevronRight size={17} />
          </button></li>)}</ul> : <p className="world-hint">Search an area or pan the map, then create an incident to start collecting reports.</p>}
        </section>}

        {error && <p className="incident-error sidebar-status" role="alert">{error}</p>}
        {message && <p className="sidebar-status" role="status">{message}</p>}
      </div>
      <footer className="world-footer"><Globe size={15} /> World map <span>·</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></footer>
    </aside>}
    <section id="map-view" className="world-stage" aria-label="Map">
      <WorldMap incidents={incidents} active={active} focus={focus} route={route} start={start} destination={destination}
        selectedRoad={roadId} aerial={aerial} picking={!!picking} onCamera={camera => setCenter(camera.center)}
        onPoint={choosePoint} onRoad={selectRoad} onIncident={chooseIncident} />
      {!sidebar && <button className="world-restore circle-button" aria-label="Show sidebar" onClick={() => setSidebar(true)}><PanelLeft size={18} /></button>}
      {picking && <div className="world-picking" role="status">{pickLabel}<button type="button" className="world-text" onClick={() => choosePoint(center)}>Use map center</button><button type="button" className="circle-button" aria-label="Cancel map selection" onClick={() => { setPicking(null); setPoints([]); }}><X size={16} /></button></div>}
      {active && <div className="world-legend" aria-label="Road legend"><span><i /> Unverified</span><span><i /> Open</span><span><i /> Blocked</span><span><i /> Hazard or dispute</span></div>}
    </section>

    {modal === "create" && <Modal title="Create incident" description="Set the area for reports and aerial surveys. Roads imported into this area start unverified." onClose={() => setModal(null)}>
      <CreateIncident center={place ?? center} onCreate={create} />
    </Modal>}
    {modal === "access" && active && <Modal title="Incident access" description="Use the incident key to submit reports, import roads, or upload imagery." onClose={() => setModal(null)}>
      <AccessKey current={access} onSave={key => { changeAccess(key); setModal(null); }} />
    </Modal>}
    {modal === "report" && active && <Modal title="Confirm field report" description={selectedRoad?.label ?? (points.length === 2 ? "New connection between the selected points." : "Observation at the selected location.")} onClose={() => setModal(null)}>
      <ReportIncident incident={active} road={selectedRoad} points={points} access={access} onReport={next => {
        applyIncident(next); setModal(null); setPoints([]); setMessage("Field report recorded.");
      }} />
    </Modal>}
    {modal === "survey" && active && <Modal title="Add aerial imagery" description="Upload a georeferenced survey or overlapping geotagged drone photos for this incident." onClose={() => setModal(null)}>
      <SurveyUpload incident={active} access={access} onUpload={next => { applyIncident(next); setAerial(true); setModal(null); setMessage("Aerial survey added."); }} />
    </Modal>}
  </main>;
}
