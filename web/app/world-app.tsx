"use client";

import {
  ArrowDownUp, ArrowLeft, ArrowUp, Bike, BusFront, CarFront, ChevronRight, CornerUpLeft, CornerUpRight,
  Crosshair, Flag, Footprints, Globe, Info, KeyRound, Layers3, MapPin, PanelLeft, Plus, Route, Satellite, Search, ShieldAlert, X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { distanceMeters, within, type Coordinate, type GeographicBounds, type Incident, type IncidentRoute, type IncidentSummary, type Place, type TravelMode } from "@/lib/incident-types";
import { crossesIncident } from "@/lib/route-boundaries";
import { fetchJson, incidentPath, postJson } from "@/lib/world-client";
import { AccessKey, CreateIncident, Modal, ReportIncident, SurveyUpload } from "./incident-dialogs";
import PlaceFinder from "./place-finder";
import WorldMap from "./world-map";

type Focus = { point: Coordinate; zoom?: number } | { bounds: GeographicBounds };
type Picking = "start" | "destination" | "point" | "connection" | null;
type ModalKind = "create" | "access" | "report" | "survey" | null;
type Stop = "start" | "destination";
type TripPoint = Coordinate & { label: string; detail?: string };
const labels = { unknown: "Unverified", open: "Reported open", blocked: "Blocked", hazard: "Hazard", conflict: "Disputed" };
const earth = { latitude: 24, longitude: 0 };
const accessStorage = (id: string) => `aftermap.access.${id}`;
const getMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong.";
const travelModes = [
  { mode: "driving", label: "Drive", icon: CarFront },
  { mode: "walking", label: "Walk", icon: Footprints },
  { mode: "cycling", label: "Bike", icon: Bike },
] as const;
const formatDistance = (meters: number) => meters >= 1000
  ? `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`
  : `${meters.toLocaleString()} m`;
function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}
function routeBounds(points: Coordinate[]): GeographicBounds {
  const first = points[0];
  return points.reduce((bounds, point) => ({
    west: Math.min(bounds.west, point.longitude), east: Math.max(bounds.east, point.longitude),
    south: Math.min(bounds.south, point.latitude), north: Math.max(bounds.north, point.latitude),
  }), { west: first.longitude, east: first.longitude, south: first.latitude, north: first.latitude });
}

export default function WorldApp() {
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [active, setActive] = useState<Incident | null>(null);
  const [selected, setSelected] = useState("");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [camera, setCamera] = useState({ center: earth, zoom: 1.65 });
  const [place, setPlace] = useState<Place | null>(null);
  const [tripOpen, setTripOpen] = useState(false);
  const [incidentPanel, setIncidentPanel] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [start, setStart] = useState<TripPoint | null>(null);
  const [deviceOrigin, setDeviceOrigin] = useState<TripPoint | null>(null);
  const [locatingStart, setLocatingStart] = useState(false);
  const [destination, setDestination] = useState<TripPoint | null>(null);
  const [route, setRoute] = useState<IncidentRoute | null>(null);
  const [mode, setMode] = useState<TravelMode>("driving");
  const [routeIndex, setRouteIndex] = useState(0);
  const [routeRetry, setRouteRetry] = useState(0);
  const [routeError, setRouteError] = useState("");
  const [routing, setRouting] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [points, setPoints] = useState<Coordinate[]>([]);
  const [roadId, setRoadId] = useState<string | null>(null);
  const [focusedReport, setFocusedReport] = useState("");
  const [roadQuery, setRoadQuery] = useState("");
  const [aerial, setAerial] = useState(true);
  const [access, setAccess] = useState("");
  const [importing, setImporting] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [sheet, setSheet] = useState(1);
  const sheetDrag = useRef<{ startY: number; height: number; moved: boolean } | null>(null);
  const lastWheel = useRef(0);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selectedRoad = active?.roads.find(road => road.id === roadId) ?? null;
  const checkedRoute = useMemo(() => {
    if (!route || !route.coordinates.length) return route;
    const options = route.options?.filter(option => !crossesIncident(option.coordinates, incidents));
    if (options?.length) return { ...route, options };
    if (options || crossesIncident(route.coordinates, incidents, route.incidentId)) {
      return { status: "unavailable", coordinates: [], distanceMeters: 0,
        reason: "The route enters an affected area. Open the incident to review its reported passages." } satisfies IncidentRoute;
    }
    return route;
  }, [route, incidents]);
  const selectedOption = checkedRoute?.options?.[routeIndex] ? routeIndex : 0;
  const routeOption = checkedRoute?.options?.[selectedOption];
  const visibleRoute = checkedRoute && routeOption ? { ...checkedRoute, ...routeOption } : checkedRoute;
  const reports = active?.reports ?? [];
  const shownReports = reports.slice(0, 40);
  const pinnedReport = reports.find(report => report.id === focusedReport);
  if (pinnedReport && !shownReports.includes(pinnedReport)) shownReports.push(pinnedReport);
  const roadMatches = roadQuery.trim() ? (active?.roads ?? [])
    .filter(road => road.label.toLowerCase().includes(roadQuery.trim().toLowerCase()))
    .map(road => ({ road, distance: distanceMeters(camera.center, road.from) }))
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
    setActive(null); setSelected(id); setRoadId(null); setFocusedReport(""); setRoadQuery(""); setPoints([]); setStale(false); setError("");
    resetRoute(); setTripOpen(false); setIncidentPanel(!!id); setPicking(null); setStart(null); setDestination(null);
    setPlace(null); setSidebar(true); setSheet(1);
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

  function choosePlace(item: Place) {
    setPlace(item); setTripOpen(false); setIncidentPanel(false); setPicking(null); resetRoute(); setMessage("");
    setFocus({ point: item, zoom: 15 }); setSheet(1);
  }
  function resetRoute() { setRoute(null); setRouteIndex(0); setRouteError(""); setRouting(false); setShowSteps(false); }
  function setTripPoint(side: Stop, point: TripPoint | null) {
    resetRoute();
    setPicking(null);
    if (side === "start") setStart(point); else setDestination(point);
  }
  function choosePoint(point: Coordinate) {
    if (picking === "start" || picking === "destination") {
      setTripPoint(picking, { ...point, label: "Dropped pin" });
      return;
    }
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
    if (!navigator.geolocation) { setRouteError("Location is unavailable in this browser."); return; }
    setLocatingStart(true); setRouteError("");
    navigator.geolocation.getCurrentPosition(position => {
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude, label: "My location" };
      setLocatingStart(false); setDeviceOrigin(point);
      setTripPoint("start", point); setFocus({ point, zoom: 15 });
    }, () => {
      setLocatingStart(false);
      setRouteError("Could not get your location. Search for a starting point or pick it on the map.");
    }, { timeout: 8000, enableHighAccuracy: true });
  }
  const routeVersion = active?.version;
  useEffect(() => {
    if (!tripOpen || !start || !destination) return;
    const controller = new AbortController();
    const endpoint = active && mode === "walking" && within(start, active.bounds) ? incidentPath(active.id, "route") : "/api/routes";
    async function loadRoute() {
      setRouting(true); setRouteError("");
      try {
        const next = await fetchJson<IncidentRoute>(endpoint, { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: start, destination, mode }),
        });
        if (controller.signal.aborted) return;
        setRoute(next); setRouteIndex(0);
        if (next.options?.length) setFocus({ bounds: routeBounds([start!, destination!, ...next.coordinates]) });
      } catch (error) { if (!controller.signal.aborted) { setRoute(null); setRouteError(getMessage(error)); } }
      finally { if (!controller.signal.aborted) setRouting(false); }
    }
    void loadRoute();
    return () => controller.abort();
    // A newer incident version recomputes an already-requested candidate.
  }, [tripOpen, start, destination, mode, routeRetry, routeVersion, active?.id]);

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
  function startTrip(point?: Place) {
    if (!tripOpen) setMode(active ? "walking" : "driving");
    setTripOpen(true); setIncidentPanel(false); setShowSteps(false); setSheet(1);
    if (!tripOpen || point) resetRoute();
    if (!start && deviceOrigin) setStart(deviceOrigin);
    if (point) setDestination({ ...point, label: point.name });
  }
  function selectRoad(id: string) {
    setRoadId(id); setPoints([]); setSidebar(true); setIncidentPanel(true);
  }
  function selectReport(id: string) {
    setSidebar(true); setIncidentPanel(true);
    setFocusedReport(id);
    requestAnimationFrame(() => {
      const card = document.getElementById(`report-${id}`);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: "nearest" });
    });
  }
  const pickLabel = picking === "start" ? "Choose a starting point" : picking === "destination" ? "Choose a destination" :
    picking === "point" ? "Choose a report location" : points.length ? "Choose the end of the passage" : "Choose the start of the passage";
  const directionsVisible = tripOpen && !incidentPanel;
  function openSearch() {
    setTripOpen(false); setIncidentPanel(false); setPicking(null); resetRoute();
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".world-scroll [name=place]")?.focus());
  }
  function shiftSheet(direction: number) {
    setSheet(value => Math.max(0, Math.min(2, value + direction)));
  }
  function dragSheet(event: PointerEvent<HTMLButtonElement>) {
    const drag = sheetDrag.current;
    if (!drag) return;
    const delta = drag.startY - event.clientY;
    if (!drag.moved && Math.abs(delta) < 7) return;
    drag.moved = true;
    const height = Math.max(113, Math.min((window.visualViewport?.height ?? innerHeight) * .81, drag.height + delta));
    event.currentTarget.closest<HTMLElement>(".world-sidebar")?.style.setProperty("--drag-sheet-height", `${height}px`);
  }
  function releaseSheet(event: PointerEvent<HTMLButtonElement>) {
    const drag = sheetDrag.current;
    if (drag?.moved && event.type !== "pointercancel") {
      const delta = drag.startY - event.clientY;
      if (Math.abs(delta) >= 24) shiftSheet(Math.sign(delta));
    }
    event.currentTarget.closest<HTMLElement>(".world-sidebar")?.style.removeProperty("--drag-sheet-height");
  }

  return <main className={`world-app ${sidebar ? "with-world-sidebar" : ""}`}>
    <a className="world-skip" href="#map-view">Skip to map</a>
    {sidebar && <aside className="world-sidebar" data-sheet={picking ? 0 : sheet} aria-label="Map controls">
      <nav className="world-rail" aria-label="Map views">
        <header>
          <button className="rail-wordmark" type="button" onClick={openSearch}>
            <Image src="/icon.png" alt="" width={23} height={23} unoptimized />Gaslight Maps
          </button>
          <button className="circle-button" aria-label="Hide sidebar" onClick={() => setSidebar(false)}><PanelLeft size={16} /></button>
        </header>
        <button className="rail-item" type="button" aria-current={!directionsVisible && !incidentPanel ? "page" : undefined} onClick={openSearch}>
          <span><Search size={17} /></span>Search
        </button>
        <button className="rail-item" type="button" aria-current={directionsVisible ? "page" : undefined} onClick={() => startTrip()}>
          <span><Route size={17} /></span>Directions
        </button>
        <button className="rail-item" type="button" aria-current={incidentPanel ? "page" : undefined} onClick={() => {
          setIncidentPanel(true); setPicking(null);
        }}><span><ShieldAlert size={17} /></span>Incidents</button>
        <footer><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></footer>
      </nav>
      <div className="world-tray">
        <button className="mobile-sheet-handle" type="button" aria-label="Resize map panel"
          onPointerDown={event => {
            const height = event.currentTarget.closest(".world-sidebar")?.getBoundingClientRect().height;
            if (!height) return;
            sheetDrag.current = { startY: event.clientY, height, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={dragSheet} onPointerUp={releaseSheet} onPointerCancel={releaseSheet}
          onClick={() => {
            if (!sheetDrag.current?.moved) setSheet(value => value === 2 ? 0 : value + 1);
            sheetDrag.current = null;
          }}
          onKeyDown={event => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault(); shiftSheet(event.key === "ArrowUp" ? 1 : -1);
          }}
          onWheel={event => {
            if (Math.abs(event.deltaY) > 16 && Date.now() - lastWheel.current > 260) {
              lastWheel.current = Date.now(); shiftSheet(Math.sign(event.deltaY));
            }
          }}><span /></button>
        <header className="world-brand">
          <button className="wordmark" type="button" onClick={() => { chooseIncident(""); setFocus({ point: earth, zoom: 1.65 }); }}>
            <Image src="/icon.png" alt="" width={28} height={28} unoptimized />Gaslight Maps
          </button>
          <div className="mobile-brand-actions">
            {incidentPanel && <button className="circle-button" aria-label="Search" onClick={openSearch}><Search size={17} /></button>}
            <button className="circle-button" aria-label="Hide sidebar" onClick={() => setSidebar(false)}><PanelLeft size={17} /></button>
          </div>
        </header>
        <div className="world-scroll">
        <div className="search-pane" hidden={directionsVisible || incidentPanel}>
          <h2 className="tray-heading">Search</h2>
          <PlaceFinder label="Search places" onFocus={() => setSheet(2)} onSelect={choosePlace} />
          {place && <div className="world-place">
            <div><MapPin size={19} /><div><strong>{place.name}</strong><small>{place.detail}</small></div>
              <button type="button" className="circle-button" aria-label="Clear place" onClick={() => setPlace(null)}><X size={15} /></button></div>
            <div className="world-action-row">
              <button className="world-primary" type="button" onClick={() => startTrip(place)}><Route size={15} /> Directions</button>
              {!active && <button className="world-secondary" type="button" onClick={() => { setPicking(null); setModal("create"); }}><Plus size={15} /> Report here</button>}
            </div>
          </div>}
          <button type="button" className="world-nav mobile-directions" onClick={() => startTrip()}><span><Route size={17} /></span> Directions <ChevronRight size={15} /></button>
        </div>

        {directionsVisible && (showSteps && routeOption ? <section className="route-detail-pane">
          <header className="tray-header">
            <button className="circle-button" type="button" aria-label="Back to directions" onClick={() => {
              setShowSteps(false); setSheet(1);
            }}><ArrowLeft size={19} /></button>
            <h2 className="tray-heading">Route Details</h2>
          </header>
          <p className="route-detail-label">Steps</p>
          <ol className="route-maneuvers">
            <li><span className="maneuver-pin start"><MapPin size={16} /></span><span><strong>{start?.label}</strong>{start?.detail && <small>{start.detail}</small>}</span></li>
            {routeOption.steps.map((step, index) => {
              const Icon = /^Arrive/.test(step.instruction) ? Flag :
                /^(Turn|Keep|Continue|Merge) (slight |sharp )?left/.test(step.instruction) ? CornerUpLeft :
                /^(Turn|Keep|Continue|Merge) (slight |sharp )?right/.test(step.instruction) ? CornerUpRight : ArrowUp;
              return <li key={index}><Icon size={22} aria-hidden /><span>
                {step.distanceMeters > 0 ? <><strong>{formatDistance(step.distanceMeters)}</strong><small>{step.instruction}</small></> :
                  <strong>{step.instruction}</strong>}
              </span></li>;
            })}
            <li><span className="maneuver-pin destination"><MapPin size={16} /></span><span><strong>{destination?.label}</strong>
              {destination?.detail && <small>{destination.detail}</small>}</span></li>
          </ol>
        </section> : <section className="trip">
          <header className="tray-header"><h2 className="tray-heading">Directions</h2>
            <button className="circle-button" aria-label="Close directions" onClick={() => {
              setTripOpen(false); setIncidentPanel(!!active); setPicking(null); resetRoute();
            }}><X size={18} /></button></header>
          <div className="direction-modes" role="group" aria-label="Travel mode">
            {travelModes.map(({ mode: item, label, icon: Icon }) =>
              <button key={item} type="button" aria-pressed={mode === item} onClick={() => {
                if (mode !== item) { resetRoute(); setMode(item); }
              }}><Icon size={19} aria-hidden />{label}</button>)}
            <button type="button" disabled aria-label="Transit unavailable" title="Transit routing is currently unavailable">
              <BusFront size={19} aria-hidden />Transit
            </button>
          </div>
          <div className="direction-stops">
            <PlaceFinder label="Starting point" stop="start" initialValue={start?.label}
              autoFocus={!start} onEdit={() => { if (start) setTripPoint("start", null); }}
              onSelect={item => setTripPoint("start", { ...item, label: item.name })} />
            <PlaceFinder label="Destination" stop="destination" initialValue={destination?.label}
              onEdit={() => { if (destination) setTripPoint("destination", null); }}
              onSelect={item => setTripPoint("destination", { ...item, label: item.name })} />
          </div>
          <div className="direction-utilities">
            <button className="world-secondary" type="button" onClick={myLocation} disabled={locatingStart}>
              <Crosshair size={15} aria-hidden /> {locatingStart ? "Locating…" : "My location"}
            </button>
            <button className="world-secondary" type="button" disabled={!start || !destination} onClick={() => {
              resetRoute(); setStart(destination); setDestination(start); setPicking(null);
            }}><ArrowDownUp size={15} aria-hidden /> Swap</button>
          </div>
          {active && <details className="direction-pick-options">
            <summary>Pick a point on the map</summary>
            <div className="world-action-row">
              <button className="world-secondary" type="button" onClick={() => setPicking("start")}>Pick start on map</button>
              <button className="world-secondary" type="button" onClick={() => setPicking("destination")}>Pick destination on map</button>
            </div>
          </details>}
          {routing && <small role="status" className="direction-search-status">Finding routes…</small>}
          {routeError && <div className="world-route-result unavailable">
            <small role="alert">{routeError}</small>
            {start && destination && <button className="world-secondary" type="button" onClick={() => setRouteRetry(value => value + 1)}>Try again</button>}
          </div>}
          {checkedRoute?.options?.length && routeOption ? <div className="direction-options" role="group" aria-label="Route options">
            {checkedRoute.options.map((option, index) => <div className="direction-card" data-selected={index === selectedOption} key={index}>
              <button type="button" aria-pressed={index === selectedOption} aria-label={`Route ${index + 1}, ${formatDuration(option.durationSeconds)}, ${formatDistance(option.distanceMeters)}`}
                onClick={() => {
                  setRouteIndex(index);
                  if (start && destination) setFocus({ bounds: routeBounds([start, destination, ...option.coordinates]) });
                }}>
                <strong>{formatDuration(option.durationSeconds)}</strong>
                <span>{formatDistance(option.distanceMeters)}{checkedRoute.options!.length > 1 && ` · Route ${index + 1}`}</span>
              </button>
              <button className="direction-info" type="button" aria-label={`Route details${checkedRoute.options!.length > 1 ? ` for route ${index + 1}` : ""}`}
                onClick={() => {
                  setRouteIndex(index); setShowSteps(true); setSheet(2);
                  if (start && destination) setFocus({ bounds: routeBounds([start, destination, ...option.coordinates]) });
                }}><Info size={19} /></button>
            </div>)}
            <small className="world-attribution">Checked against mapped incidents · <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">OSRM routing</a></small>
          </div> : visibleRoute && <div className={`world-route-result ${visibleRoute.status}`}>
            <strong role="status">{visibleRoute.status === "unavailable" ? "Route unavailable" :
              visibleRoute.status === "partial" ? "Partial route only" : "Walking route"}
              {visibleRoute.distanceMeters > 0 && ` · ${formatDistance(visibleRoute.distanceMeters)}`}</strong>
            <small>{visibleRoute.reason}</small>
          </div>}
        </section>)}

        {!directionsVisible && (active ? <section className="world-section active-incident">
          {incidentPanel && <button type="button" className="world-nav mobile-directions" onClick={() => startTrip()}><span><Route size={17} /></span> Directions <ChevronRight size={15} /></button>}
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
          {shownReports.length ? <ul className="world-reports">{shownReports.map(report => <li key={report.id} id={`report-${report.id}`}
            tabIndex={-1} className={focusedReport === report.id ? "is-selected" : undefined}>
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
            <button className="world-text" type="button" onClick={() => { setPicking(null); setModal("create"); }}><Plus size={16} /> Report incident</button></header>
          {incidents.length ? <ul className="incident-list">{incidents.map(item => <li key={item.id}><button type="button" onClick={() => chooseIncident(item.id)}>
            <span><strong>{item.name}</strong><small>{item.roadCount.toLocaleString()} mapped segments{item.imagery ? " · Aerial survey" : ""}</small></span><ChevronRight size={17} />
          </button></li>)}</ul> : <p className="world-hint">Report an incident to mark the affected area and start collecting observations.</p>}
        </section>)}

        {error && <p className="incident-error sidebar-status" role="alert">{error}</p>}
        {message && <p className="sidebar-status" role="status">{message}</p>}
      </div>
      <footer className="world-footer"><Globe size={15} /> World map <span>·</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></footer>
      </div>
    </aside>}
    <section id="map-view" className="world-stage" aria-label="Map">
      <WorldMap incidents={incidents} active={active} focus={focus} route={visibleRoute}
        start={tripOpen ? start : null} destination={tripOpen ? destination : place}
        selectedRoad={roadId} aerial={aerial} picking={!!picking} sidebarVisible={sidebar} onCamera={setCamera}
        onPoint={choosePoint} onRoad={selectRoad} onIncident={chooseIncident} onReport={selectReport} />
      {!sidebar && <button className="world-restore circle-button" aria-label="Show sidebar" onClick={() => setSidebar(true)}><PanelLeft size={18} /></button>}
      {picking && <div className="world-picking" role="status">{pickLabel}<button type="button" className="world-text" onClick={() => choosePoint(camera.center)}>Use map center</button><button type="button" className="circle-button" aria-label="Cancel map selection" onClick={() => { setPicking(null); setPoints([]); }}><X size={16} /></button></div>}
      {active && <div className="world-legend" aria-label="Road legend"><span><i /> Unverified</span><span><i /> Open</span><span><i /> Blocked</span><span><i /> Hazard or dispute</span></div>}
    </section>

    {modal === "create" && <Modal title="Report an incident" description="Mark the affected area and add an observation or photo if you have one." onClose={() => setModal(null)}>
      <CreateIncident camera={camera} place={place} onCreate={create} />
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
