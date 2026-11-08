"use client";

import {
  ArrowDownUp, ArrowLeft, ArrowUp, Bike, BusFront, CarFront, ChevronRight, CornerUpLeft, CornerUpRight,
  Crosshair, Flag, Footprints, Globe, Info, KeyRound, Layers3, LoaderCircle, MapPin, PanelLeft, Plus, Route, Satellite, ScanLine, Search, ShieldAlert, X,
} from "lucide-react";
import catia from "@/lib/catia-imagery.json";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { distanceMeters, incidentExtent, withinIncident, type AerialScan, type Coordinate, type GeographicBounds, type Incident, type IncidentImagery, type IncidentRoute, type IncidentSummary, type Place, type TravelMode } from "@/lib/incident-types";
import { crossesIncident } from "@/lib/route-boundaries";
import { navigationLimits } from "@/lib/navigation";
import { fetchJson, incidentPath, postJson } from "@/lib/world-client";
import { AccessKey, CreateIncident, Modal, RemoveAerial, ReportIncident, ResolveIncident, SurveyUpload } from "./incident-dialogs";
import PlaceFinder from "./place-finder";
import WorldMap from "./world-map";
import PhotoOnlyUpload from "./photo-only-upload";
import { useLiveNavigation } from "./use-live-navigation";

type Focus = { point: Coordinate; zoom?: number } | { bounds: GeographicBounds };
type Picking = "start" | "destination" | "point" | "connection" | "trace" | null;
type ModalKind = "create" | "access" | "report" | "survey" | "remove-aerial" | "resolve" | null;
type Stop = "start" | "destination";
type TripPoint = Coordinate & { label: string; detail?: string; useDeviceLocation?: boolean };
const labels = { unknown: "Unverified", open: "Reported open", blocked: "Blocked", hazard: "Hazard", conflict: "Disputed" };
const observationLabels = { rubble: "Possible rubble", water: "Possible flooding", both: "Possible rubble and flooding",
  unclear: "Unclear from above", none_visible: "No visible obstruction" };
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
  const [recoveryImagery, setRecoveryImagery] = useState<IncidentImagery[]>([]);
  const updates = useRef<EventSource | null>(null);
  const listRequest = useRef(0);
  const [active, setActive] = useState<Incident | null>(null);
  const [selected, setSelected] = useState("");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [camera, setCamera] = useState({ center: earth, zoom: 1.65 });
  const [place, setPlace] = useState<Place | null>(null);
  const [tripOpen, setTripOpen] = useState(false);
  const [incidentPanel, setIncidentPanel] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [start, setStart] = useState<TripPoint | null>(null);
  const [locatingStart, setLocatingStart] = useState(false);
  const locationRequest = useRef(0);
  const [destination, setDestination] = useState<TripPoint | null>(null);
  const [route, setRoute] = useState<IncidentRoute | null>(null);
  const [mode, setMode] = useState<TravelMode>("driving");
  const [routeIndex, setRouteIndex] = useState(0);
  const [routeRetry, setRouteRetry] = useState(0);
  const [routeError, setRouteError] = useState("");
  const [routing, setRouting] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const keepTripViewport = useRef(false);
  const [points, setPoints] = useState<Coordinate[]>([]);
  const [tracing, setTracing] = useState(false);
  const [roadId, setRoadId] = useState<string | null>(null);
  const [focusedReport, setFocusedReport] = useState("");
  const [roadQuery, setRoadQuery] = useState("");
  const [aerial, setAerial] = useState(true);
  const [access, setAccess] = useState("");
  const [importing, setImporting] = useState(false);
  const [scanningAerial, setScanningAerial] = useState(false);
  const [aerialScan, setAerialScan] = useState<(AerialScan & { incidentId: string }) | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [sheet, setSheet] = useState(0);
  const [mobileSearch, setMobileSearch] = useState(false);
  const mapShell = useRef<HTMLElement>(null);
  const sheetDrag = useRef<{ startY: number; height: number; moved: boolean } | null>(null);
  const lastWheel = useRef(0);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [followNavigation, setFollowNavigation] = useState(true);
  const selectedRoad = active?.roads.find(road => road.id === roadId) ?? null;
  const visibleScan = aerialScan && active && !active.resolvedAt &&
    aerialScan.incidentId === active.id && aerialScan.surveyUrl === active.imagery?.url ? aerialScan : null;
  const hazardFindings = visibleScan?.findings.filter(item =>
    item.obstruction === "rubble" || item.obstruction === "water" || item.obstruction === "both") ?? [];
  const selectedFinding = hazardFindings.find(item => item.roadId === roadId);
  const aerialFlagIds = useMemo(() => new Set(visibleScan?.findings.flatMap(item =>
    item.obstruction !== "none_visible" && item.obstruction !== "unclear" ? [item.roadId] : [])), [visibleScan]);
  const checkedRoute = useMemo(() => {
    if (!route || !route.coordinates.length) return route;
    const options = route.options?.filter(option => option.unverifiedSegments?.length || !crossesIncident(option.coordinates, incidents));
    if (options?.length) return { ...route, options };
    if (options || (!route.unverifiedSegments?.length && crossesIncident(route.coordinates, incidents, route.incidentId))) {
      return { status: "unavailable", coordinates: [], distanceMeters: 0,
        reason: "The route enters an affected area. Open the incident to review its reported passages." } satisfies IncidentRoute;
    }
    return route;
  }, [route, incidents]);
  const selectedOption = checkedRoute?.options?.[routeIndex] ? routeIndex : 0;
  const routeOption = checkedRoute?.options?.[selectedOption];
  const visibleRoute = checkedRoute && routeOption ? { ...checkedRoute, ...routeOption } : checkedRoute;
  const incidentAreas = incidents.map(incident => `${incident.id}:${incident.version}`).sort().join(",");
  const navigationIncident = visibleRoute?.incidentId;
  const navigationRevision = incidents.find(incident => incident.id === navigationIncident)?.version ?? active?.version ?? 0;
  const navigation = useLiveNavigation(`${incidentAreas}:${navigationRevision}`);
  const { trip: liveTrip, snapshot: guidance } = navigation;
  const canNavigate = !routing && !!start && !!destination && visibleRoute?.status === "complete" &&
    visibleRoute.coordinates.length >= 2;
  const canGuide = canNavigate && !!start?.useDeviceLocation && !visibleRoute?.unverifiedSegments?.length;
  const reviewSteps = routeOption?.steps ?? (visibleRoute ? [{
    instruction: visibleRoute.unverifiedSegments?.length ? "Review the mapped route" : visibleRoute.incidentId ? "Follow the reported passage" : "Follow the mapped route",
    distanceMeters: visibleRoute.distanceMeters,
  }] : []);
  const reports = active?.reports ?? [];
  const shownReports = reports.slice(0, 40);
  const pinnedReport = reports.find(report => report.id === focusedReport);
  if (pinnedReport && !shownReports.includes(pinnedReport)) shownReports.push(pinnedReport);
  const roadMatches = roadQuery.trim() ? (active?.roads ?? [])
    .filter(road => road.label.toLowerCase().includes(roadQuery.trim().toLowerCase()))
    .map(road => ({ road, distance: distanceMeters(camera.center, road.from) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 8) : [];

  function refreshList() {
    const request = ++listRequest.current;
    return fetchJson<{ incidents: IncidentSummary[]; recoveryImagery?: IncidentImagery[] }>("/api/incidents").then(value => {
      if (request !== listRequest.current) return;
      setIncidents(value.incidents);
      setRecoveryImagery(value.recoveryImagery ?? []);
    });
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("incident") ?? "";
    if (id) { setSelected(id); setSheet(1); }
    else if (params.get("place") === catia.id) {
      setPlace(catia.place);
      setFocus({ bounds: catia.coverage });
      setSheet(1);
    }
    void refreshList().catch(error => setError(getMessage(error)));
    const stream = typeof EventSource !== "undefined" ? new EventSource("/api/incidents/updates") : null;
    updates.current = stream;
    const refreshVisible = () => { if (!document.hidden) void refreshList().catch(() => {}); };
    stream?.addEventListener("message", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    let ticks = 0;
    const timer = window.setInterval(() => {
      if (++ticks % 3 === 0 || stream?.readyState !== 1) refreshVisible();
    }, 5000);
    return () => {
      updates.current = null;
      stream?.close();
      document.removeEventListener("visibilitychange", refreshVisible);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const shell = mapShell.current;
    if (!mobileSearch || !viewport || !shell) return;
    const update = () => {
      const inset = viewport.scale === 1 ? Math.max(0, shell.clientHeight - viewport.height - viewport.offsetTop) : 0;
      shell.style.setProperty("--mobile-keyboard-inset", `${inset}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      shell.style.removeProperty("--mobile-keyboard-inset");
    };
  }, [mobileSearch]);
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
        if (first) { setFocus({ bounds: incidentExtent(next) }); first = false; }
      } catch (error) {
        if (!cancelled) { setStale(true); if (first) setError(getMessage(error)); }
      }
    }
    setAccess(localStorage.getItem(accessStorage(selected)) ?? "");
    void refresh();
    const stream = updates.current;
    function syncUpdate(event: MessageEvent<string>) {
      try {
        const { id } = JSON.parse(event.data);
        if (!id || id === selected) void refresh();
      } catch { /* The scheduled refresh is still available. */ }
    }
    stream?.addEventListener("message", syncUpdate);
    const timer = window.setInterval(refresh, 4500);
    return () => { cancelled = true; clearInterval(timer); stream?.removeEventListener("message", syncUpdate); };
  }, [selected]);

  function changeAccess(key: string, id = selected) {
    setAccess(key);
    try { localStorage.setItem(accessStorage(id), key); } catch {}
  }
  function chooseIncident(id: string) {
    if (id === selected) { if (active) setFocus({ bounds: incidentExtent(active) }); return; }
    setActive(null); setSelected(id); setRoadId(null); setFocusedReport(""); setRoadQuery(""); setPoints([]); setTracing(false); setStale(false); setError("");
    locationRequest.current++; setLocatingStart(false);
    resetRoute(); setTripOpen(false); setIncidentPanel(!!id); setPicking(null); setStart(null); setDestination(null);
    setPlace(null); setSidebar(true); setSheet(1); setMobileSearch(false);
    const url = new URL(location.href);
    if (id) url.searchParams.set("incident", id); else url.searchParams.delete("incident");
    history.replaceState(null, "", url);
  }
  function applyIncident(next: Incident) {
    setActive(current => current?.id === next.id && current.version > next.version ? current : next);
    setIncidents(current => {
      const others = current.filter(item => item.id !== next.id);
      return next.resolvedAt ? others : [next, ...others];
    });
  }
  const [photoOnly, setPhotoOnly] = useState(true);

  function create(next: Incident, key: string, fromImagery = false) {
    chooseIncident(next.id); applyIncident(next); changeAccess(key, next.id);
    setFocus({ bounds: next.bounds }); setModal(fromImagery ? null : "access");
    setMessage(fromImagery ? "Aerial imagery added to the shared map." : "Incident created. Share its access key with your field team.");
  }

  function choosePlace(item: Place) {
    setPlace(item); setTripOpen(false); setIncidentPanel(false); setPicking(null); resetRoute(); setMessage("");
    setFocus(item.id === catia.place.id ? { bounds: catia.coverage } : { point: item, zoom: 15 });
    setSheet(1);
    if (mobileSearch) closeMobileSearch();
  }
  function resetRoute() {
    if (liveTrip) navigation.stop();
    setRoute(null); setRouteIndex(0); setRouteError(""); setRouting(false); setShowSteps(false);
  }
  function startNavigation() {
    if (!canNavigate || !start || !destination || !visibleRoute) return;
    if (!canGuide) {
      setShowSteps(true); setSheet(2);
      return;
    }
    setFollowNavigation(true); setSheet(1); setShowSteps(false);
    navigation.start({ destination, mode, route: visibleRoute });
  }
  function setTripPoint(side: Stop, point: TripPoint | null) {
    resetRoute();
    setPicking(null);
    if (side === "start") {
      locationRequest.current++;
      setLocatingStart(false);
      setStart(point);
    } else setDestination(point);
  }
  function pickTripPoint(side: Stop) {
    keepTripViewport.current = true;
    setPicking(side);
  }
  function choosePoint(point: Coordinate) {
    if (picking === "start" || picking === "destination") {
      setTripPoint(picking, { ...point, label: "Dropped pin" });
      return;
    }
    if (picking === "point" || picking === "connection" || picking === "trace") {
      if (active && !withinIncident(point, active)) { setError("Choose a point inside the incident or its aerial coverage."); return; }
      if (picking === "trace") {
        const previous = points.at(-1);
        if (previous && distanceMeters(previous, point) < 1) { setError("Place each point at least 1 m apart."); return; }
        if (points.length >= 24) { setError("Finish this trace before adding another passage."); return; }
        setPoints([...points, point]); setError("");
        return;
      }
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
    const request = ++locationRequest.current;
    setLocatingStart(true); setRouteError("");
    navigator.geolocation.getCurrentPosition(position => {
      if (locationRequest.current !== request) return;
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude, label: "My location", useDeviceLocation: true };
      setTripPoint("start", point); setFocus({ point, zoom: 15 });
    }, () => {
      if (locationRequest.current !== request) return;
      setLocatingStart(false);
      setRouteError("Could not get your location. Search for a starting point or pick it on the map.");
    }, { timeout: 8000, enableHighAccuracy: true });
  }
  const routeVersion = active?.version;
  useEffect(() => {
    if (!tripOpen || !start || !destination || liveTrip) return;
    const controller = new AbortController();
    async function loadRoute() {
      setRouting(true); setRouteError("");
      try {
        const next = await fetchJson<IncidentRoute>("/api/routes", { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: start, destination, mode }),
        });
        if (controller.signal.aborted) return;
        setRoute(next); setRouteIndex(0);
        if (!keepTripViewport.current && next.coordinates.length > 1) {
          setFocus({ bounds: routeBounds([start!, destination!, ...next.coordinates]) });
        }
      } catch (error) { if (!controller.signal.aborted) { setRoute(null); setRouteError(getMessage(error)); } }
      finally { if (!controller.signal.aborted) setRouting(false); }
    }
    void loadRoute();
    return () => controller.abort();
    // A newer incident version recomputes an already-requested candidate.
  }, [tripOpen, start, destination, mode, routeRetry, routeVersion, incidentAreas, active?.id, liveTrip]);

  function needAccess(action: () => void) {
    if (!access) { setModal("access"); return; }
    action();
  }
  async function importStreets() {
    if (!active) return;
    setImporting(true); setError("");
    try {
      const center = camera.zoom >= 14 && withinIncident(camera.center, active) ? camera.center : undefined;
      const { incident } = await postJson<{ incident: Incident }>(incidentPath(active.id, "roads"), { center }, access);
      applyIncident(incident);
      setMessage(`Imported OpenStreetMap passages. ${incident.roadCount.toLocaleString()} segments in this incident.`);
    } catch (error) { setError(getMessage(error)); }
    finally { setImporting(false); }
  }
  async function scanImagery() {
    if (!active?.imagery || scanningAerial) return;
    setScanningAerial(true); setError("");
    try {
      const scan = await postJson<AerialScan>(incidentPath(active.id, "imagery/scan"),
        { center: selectedRoad?.from ?? camera.center, roadId: selectedRoad?.id }, access);
      setAerialScan({ ...scan, incidentId: active.id });
      setAerial(true);
    } catch (error) { setError(getMessage(error)); }
    finally { setScanningAerial(false); }
  }
  function startTrip(point?: Place) {
    if (!tripOpen) {
      keepTripViewport.current = false;
      setMode((active && !active.resolvedAt) || (point && incidents.some(incident => withinIncident(point, incident))) ? "walking" : "driving");
    }
    setTripOpen(true); setIncidentPanel(false); setShowSteps(false); setSheet(1); setMobileSearch(false);
    if (!tripOpen || point) resetRoute();
    if (point) setDestination({ ...point, label: point.name });
  }
  function selectRoad(id: string) {
    setRoadId(id); setPoints([]); setTracing(false); setSidebar(true); setIncidentPanel(true);
    setSheet(value => Math.max(1, value));
  }
  function selectReport(id: string) {
    setSidebar(true); setIncidentPanel(true);
    setSheet(value => Math.max(1, value));
    setFocusedReport(id);
    requestAnimationFrame(() => {
      const card = document.getElementById(`report-${id}`);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: "nearest" });
    });
  }
  function beginTrace(road: string | null) {
    needAccess(() => { setRoadId(road); setPoints([]); setTracing(true); setError(""); setPicking("trace"); });
  }
  const pickLabel = picking === "trace" ? (points.length ? "Tap along the passage, then finish" : "Choose the start of the passage") :
    picking === "start" ? "Choose a starting point" : picking === "destination" ? "Choose a destination" :
    picking === "point" ? "Choose a report location" : points.length ? "Choose the end of the passage" : "Choose the start of the passage";
  const directionsVisible = tripOpen && !incidentPanel;
  const searchVisible = !directionsVisible && !incidentPanel;
  const compactSearch = sheet === 0 && searchVisible && !picking;
  function closeMobileSearch() {
    setMobileSearch(false);
    mapShell.current?.querySelector<HTMLInputElement>("[name=place]")?.blur();
  }
  function openSearch() {
    setTripOpen(false); setIncidentPanel(false); setPicking(null); resetRoute();
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".world-scroll [name=place]")?.focus());
  }
  function shiftSheet(direction: number) {
    if (direction < 0 && mobileSearch) closeMobileSearch();
    setSheet(value => Math.max(0, Math.min(2, value + direction)));
  }
  function dragSheet(event: PointerEvent<HTMLButtonElement>) {
    const drag = sheetDrag.current;
    if (!drag) return;
    const delta = drag.startY - event.clientY;
    if (!drag.moved && Math.abs(delta) < 7) return;
    drag.moved = true;
    const height = Math.max(120, Math.min((window.visualViewport?.height ?? innerHeight) - 36, drag.height + delta));
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

  return <main ref={mapShell} className={`world-app world-main-map ${sidebar ? "with-world-sidebar" : ""}`}>
    <a className="world-skip" href="#map-view">Skip to map</a>
    {sidebar && <aside className="world-sidebar" data-sheet={picking ? 0 : sheet}
      data-compact-search={compactSearch} data-searching={searchVisible && mobileSearch} data-navigating={!!liveTrip} aria-label="Map controls">
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
            if (!sheetDrag.current?.moved) {
              if (mobileSearch) closeMobileSearch();
              setSheet(value => value === 2 ? 0 : value + 1);
            }
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
          <button className="wordmark" type="button" onClick={() => { chooseIncident(""); setFocus({ point: earth, zoom: 1.65 }); setSheet(0); }}>
            <Image src="/icon.png" alt="" width={28} height={28} unoptimized />Gaslight Maps
          </button>
          <div className="mobile-brand-actions">
            {incidentPanel && <button className="circle-button" aria-label="Search" onClick={openSearch}><Search size={17} /></button>}
            <button className="circle-button" aria-label="Hide sidebar" onClick={() => { closeMobileSearch(); setSidebar(false); }}><PanelLeft size={17} /></button>
          </div>
        </header>
        <div className="world-scroll">
        <div className="search-pane" hidden={!searchVisible}>
          <h2 className="tray-heading">Search</h2>
          <PlaceFinder label="Search places" onFocus={() => {
            if (matchMedia("(max-width: 740px)").matches) setMobileSearch(true);
            setSheet(2);
          }} onSelect={choosePlace} onCancel={() => {
            closeMobileSearch(); setSheet(place ? 1 : 0);
            mapShell.current?.querySelector<HTMLButtonElement>(".mobile-sheet-handle")?.focus({ preventScroll: true });
          }} />
          {place && <div className="world-place">
            <div><MapPin size={19} /><div><strong>{place.name}</strong><small>{place.detail}</small></div>
              <button type="button" className="circle-button" aria-label="Clear place" onClick={() => setPlace(null)}><X size={15} /></button></div>
            <div className="world-action-row">
              <button className="world-primary" type="button" onClick={() => startTrip(place)}><Route size={15} /> Directions</button>
              {!active && <button className="world-secondary" type="button" onClick={() => { setPicking(null); setModal("create"); }}><Plus size={15} /> Report here</button>}
            </div>
          </div>}
          <section className="mobile-map-tools" aria-label="Map tools">
            <h2>Map tools</h2>
            <div>
              <button type="button" className="world-nav" onClick={() => startTrip()}><span><Route size={17} /></span> Directions</button>
              <button type="button" className="world-nav" onClick={() => {
                closeMobileSearch(); setIncidentPanel(true); setSheet(1);
              }}><span><ShieldAlert size={17} /></span> Incidents</button>
            </div>
          </section>
        </div>

        {directionsVisible && (liveTrip ? <section className="live-navigation" aria-label="Live navigation">
          <header className="tray-header"><h2 className="tray-heading">Navigation</h2>
            <button className="world-secondary" type="button" onClick={navigation.stop}>End navigation</button>
          </header>
          <p className="navigation-destination">To {liveTrip.destination.label}</p>
          <div className="world-route-result" role="status">
            <strong>{guidance?.phase === "following" ? guidance.progress?.instruction :
              guidance?.phase === "arrived" ? "Trip complete" : guidance?.phase === "paused" ? "Navigation paused" :
                guidance?.phase === "rerouting" ? "Recalculating" : "Finding your location"}</strong>
            {guidance?.progress && <small>
              {guidance.progress.nextIn >= 8 ? `In ${formatDistance(Math.round(guidance.progress.nextIn))} · ` : ""}
              {formatDistance(Math.round(guidance.progress.remaining))} remaining
            </small>}
            {guidance?.note && <small>{guidance.note}</small>}
            {(guidance?.route ?? liveTrip.route).incidentId && <small>Uses reported passages. Follow current instructions from responders.</small>}
          </div>
          <div className="world-action-row">
            {guidance?.position && !followNavigation && <button className="world-secondary" type="button" onClick={() => setFollowNavigation(true)}>
              <Crosshair size={15} aria-hidden /> Recenter
            </button>}
            {guidance?.phase === "paused" && <button className="world-secondary" type="button" onClick={navigation.retry}>Try again</button>}
          </div>
        </section> : showSteps && visibleRoute ? <section className="route-detail-pane">
          <header className="tray-header">
            <button className="circle-button" type="button" aria-label="Back to directions" onClick={() => {
              setShowSteps(false); setSheet(1);
            }}><ArrowLeft size={19} /></button>
            <h2 className="tray-heading">{visibleRoute.unverifiedSegments?.length ? "Route preview" : "Route Details"}</h2>
          </header>
          {!!visibleRoute.unverifiedSegments?.length && <p className="world-hint">Preview only. Dashed sections have no report confirming they’re open.</p>}
          <p className="route-detail-label">Steps</p>
          <ol className="route-maneuvers">
            <li><span className="maneuver-pin start"><MapPin size={16} /></span><span><strong>{start?.label}</strong>{start?.detail && <small>{start.detail}</small>}</span></li>
            {reviewSteps.map((step, index) => {
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
          {canGuide && <button className="world-primary navigation-start" type="button" onClick={startNavigation}>Go</button>}
        </section> : <section className="trip">
          <header className="tray-header"><h2 className="tray-heading">Directions</h2>
            <button className="circle-button" aria-label="Close directions" onClick={() => {
              locationRequest.current++; setLocatingStart(false);
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
              setTripPoint("start", destination); setDestination(start);
            }}><ArrowDownUp size={15} aria-hidden /> Swap</button>
          </div>
          <details className="direction-pick-options">
            <summary>Pick a point on the map</summary>
            <div className="world-action-row">
              <button className="world-secondary" type="button" onClick={() => pickTripPoint("start")}>Pick start on map</button>
              <button className="world-secondary" type="button" onClick={() => pickTripPoint("destination")}>Pick destination on map</button>
            </div>
          </details>
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
                <span>{formatDistance(option.distanceMeters)}{option.unverifiedSegments?.length ? " · Unverified sections" :
                  checkedRoute.options!.length > 1 ? ` · Route ${index + 1}` : ""}</span>
              </button>
              <button className="direction-info" type="button" aria-label={`Route details${checkedRoute.options!.length > 1 ? ` for route ${index + 1}` : ""}`}
                onClick={() => {
                  setRouteIndex(index); setShowSteps(true); setSheet(2);
                  if (start && destination) setFocus({ bounds: routeBounds([start, destination, ...option.coordinates]) });
                }}><Info size={19} /></button>
            </div>)}
            {!!routeOption.unverifiedSegments?.length && <p className="world-hint">Dashed sections have no report confirming they’re open.</p>}
            <small className="world-attribution">Checked against mapped incidents · <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">OSRM routing</a></small>
          </div> : visibleRoute && <div className={`world-route-result ${visibleRoute.status}`}>
            <strong role="status">{visibleRoute.status === "unavailable" ? "Route unavailable" :
              visibleRoute.status === "partial" ? "Partial route only" : visibleRoute.unverifiedSegments?.length ?
                "Walking route with unverified sections" : "Walking route"}
              {visibleRoute.distanceMeters > 0 && ` · ${formatDistance(visibleRoute.distanceMeters)}`}</strong>
            <small>{visibleRoute.reason}</small>
          </div>}
          {canNavigate && <button className="world-primary navigation-start" type="button" onClick={startNavigation}>Go</button>}
        </section>)}

        {!directionsVisible && (active ? <section className="world-section active-incident mobile-search-content">
          {incidentPanel && <button type="button" className="world-nav mobile-directions" onClick={() => startTrip()}><span><Route size={17} /></span> Directions <ChevronRight size={15} /></button>}
          <button type="button" className="world-text" onClick={() => chooseIncident("")}><ArrowLeft size={15} /> All incidents</button>
          <h1>{active.name}</h1>
          <p className="incident-caption"><span className={stale || active.resolvedAt ? "sync stale" : "sync"} />{active.resolvedAt ? "Resolved" : stale ? "Showing last update" : "Live incident"} · {active.roadCount.toLocaleString()} segments</p>
          {!active.resolvedAt && <>
          <div className="world-action-row">
            <button className="world-secondary" type="button" onClick={() => setAerial(!aerial)} aria-pressed={aerial}><Satellite size={16} /> Aerial view</button>
            <button className="world-secondary" type="button" onClick={() => needAccess(() => setModal("survey"))}><Layers3 size={16} /> Add imagery</button>
          </div>
          {aerial && active.imagery && <small className="world-attribution">{active.name === "Catia La Mar" || active.name === "Cincinnati" ? "Aerial survey" : active.imagery.source}</small>}
          {active.imagery && <>
            <div className="world-action-row">
              <button className="world-secondary" type="button" disabled={scanningAerial}
                onClick={() => needAccess(() => void scanImagery())}>
                {scanningAerial ? <LoaderCircle className="incident-spinner" size={16} aria-hidden /> : <ScanLine size={16} aria-hidden />} Scan aerial imagery
              </button>
            </div>
            {!visibleScan && !scanningAerial && <p className="world-hint">OpenAI checks up to six nearby road segments.</p>}
          </>}
          {scanningAerial && <p className="world-hint" role="status">Checking nearby roads for visible obstructions…</p>}
          {visibleScan && <div className="aerial-scan">
            <h2 className="reports-title">Aerial scan</h2>
            <p className="world-hint" role="status">{hazardFindings.length} flagged · {visibleScan.findings.length} scanned. Purple dashes mark unverified roads flagged for review.</p>
            <ul className="world-reports">{visibleScan.findings.map(finding => {
              const road = active.roads.find(item => item.id === finding.roadId);
              if (!road) return null;
              return <li key={road.id}>
                <div><strong>{road.label}</strong><small>{labels[road.state]}</small></div>
                <small>{observationLabels[finding.obstruction]}</small>
                <p>{finding.observation}</p>
                {finding.image && <button className="world-text" type="button" onClick={() => {
                  selectRoad(road.id); setFocus({ bounds: routeBounds([road.from, ...(road.via ?? []), road.to]) });
                }}>View segment</button>}
                {finding.image && roadId === road.id && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="aerial-scan-evidence" src={`data:image/jpeg;base64,${finding.image}`} alt={`Aerial crop with ${road.label} marked in cyan`} />
                )}
              </li>;
            })}</ul>
          </div>}
          <div className="world-action-row">
            <button className="world-secondary" type="button" disabled={importing} onClick={() => needAccess(() => void importStreets())}>{importing ? "Importing…" : "Import roads"}</button>
            <button className="world-secondary" type="button" onClick={() => setModal("access")}><KeyRound size={15} /> Access key</button>
          </div>
          <div className="world-action-row">
            <button className="world-text" type="button" onClick={() => needAccess(() => { setTracing(false); setPoints([]); setPicking("point"); })}><MapPin size={15} /> Report a point</button>
            <button className="world-text" type="button" onClick={() => needAccess(() => { setTracing(false); setPoints([]); setPicking("connection"); })}><Plus size={15} /> Add passage</button>
            <button className="world-text" type="button" onClick={() => beginTrace(null)}>Trace passage</button>
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
            <button className="world-secondary" onClick={() => needAccess(() => { setTracing(false); setPoints([]); setModal("report"); })}>Report condition</button>
            {selectedRoad.id.startsWith("field-") && <button className="world-text" type="button" onClick={() => beginTrace(selectedRoad.id)}>Redraw passage</button>}
          </div> : <p className="world-hint">Select a road on the map to view or report its condition.</p>}
          <button className="world-text" type="button" onClick={() => needAccess(() => setModal("resolve"))}>Mark area repaired…</button>
          </>}
          {active.resolvedAt && <button className="world-secondary" type="button" onClick={() => setModal("access")}><KeyRound size={15} /> Access key</button>}
          {(active.resolvedAt ? active.recoveryImagery : active.imagery) && <button className="world-text" type="button"
            onClick={() => needAccess(() => setModal("remove-aerial"))}>Remove aerial imagery…</button>}
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
        </section> : <section className="world-section mobile-search-content">
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
      <WorldMap incidents={incidents} recoveryImagery={recoveryImagery} active={active} focus={focus}
        route={liveTrip ? guidance?.phase === "rerouting" || guidance?.phase === "paused" ? null : guidance?.route ?? liveTrip.route : visibleRoute}
        navigationPosition={guidance?.position}
        navigationZoom={liveTrip && followNavigation ? navigationLimits[liveTrip.mode].zoom : undefined}
        onFreePan={() => setFollowNavigation(false)}
        start={tripOpen && !liveTrip ? start : null} destination={tripOpen ? destination : place}
        selectedRoad={roadId} aerial={aerial} picking={!!picking} pickingTripPoint={picking === "start" || picking === "destination"}
        draftPassage={picking === "trace" ? points : undefined} aerialFlagIds={aerialFlagIds} sidebarVisible={sidebar} onCamera={setCamera}
        onPoint={choosePoint} onRoad={selectRoad} onIncident={chooseIncident} onReport={selectReport} />
      {!sidebar && <button className="world-restore circle-button" aria-label="Show sidebar" onClick={() => setSidebar(true)}><PanelLeft size={18} /></button>}
      {picking && <div className={picking === "trace" ? "world-picking world-tracing" : "world-picking"}><span role="status">{pickLabel}</span>
        <button type="button" className="world-text" onClick={() => choosePoint(camera.center)}>Use map center</button>
        {picking === "trace" && points.length > 0 && <button type="button" className="world-text" onClick={() => setPoints(points.slice(0, -1))}>Undo point</button>}
        {picking === "trace" && points.length >= 2 && <button type="button" className="world-text" onClick={() => { setPicking(null); setModal("report"); }}>Finish trace</button>}
        <button type="button" className="circle-button" aria-label="Cancel map selection" onClick={() => { setPicking(null); setPoints([]); setTracing(false); }}><X size={16} /></button>
      </div>}
      {active && !active.resolvedAt && <div className="world-legend" aria-label="Road legend"><span><i /> Unverified</span><span><i /> Open</span><span><i /> Blocked</span><span><i /> Hazard or dispute</span></div>}
    </section>

    {modal === "create" && <Modal title="Report an incident" description="Upload aerial images or enter the incident details." onClose={() => setModal(null)}>
      <div className="world-segments" aria-label="Incident submission method">
        <button type="button" aria-pressed={photoOnly} onClick={() => setPhotoOnly(true)}>Upload aerial images</button>
        <button type="button" aria-pressed={!photoOnly} onClick={() => setPhotoOnly(false)}>Report details</button>
      </div>
      {photoOnly ? <PhotoOnlyUpload onImport={(next, key) => create(next, key, true)} />
        : <CreateIncident camera={camera} place={place} onCreate={create} />}
    </Modal>}
    {modal === "access" && active && <Modal title="Incident access" description="Use the incident key to submit reports, import roads, or upload imagery." onClose={() => setModal(null)}>
      <AccessKey current={access} onSave={key => { changeAccess(key); setModal(null); }} />
    </Modal>}
    {modal === "report" && active && <Modal title="Confirm field report" description={tracing ? "Confirm the condition along the traced passage." : selectedRoad?.label ?? (points.length === 2 ? "New connection between the selected points." : "Observation at the selected location.")} onClose={() => { setModal(null); setTracing(false); setPoints([]); }}>
      <ReportIncident incident={active} road={selectedRoad} points={points} trace={tracing} access={access}
        suggestedHazard={!tracing && !!selectedFinding && selectedRoad?.state === "unknown"} onReport={next => {
        applyIncident(next); setModal(null); setPoints([]); setTracing(false); setMessage("Field report recorded.");
      }} />
    </Modal>}
    {modal === "survey" && active && <Modal title="Add aerial imagery" description="Upload a georeferenced survey or overlapping geotagged drone photos for this incident." onClose={() => setModal(null)}>
      <SurveyUpload incident={active} access={access} onUpload={next => {
        applyIncident(next); setAerial(true); setModal(null);
        setFocus({ bounds: incidentExtent(next) }); setMessage("Aerial survey added.");
      }} />
    </Modal>}
    {modal === "remove-aerial" && active && <Modal title="Remove aerial imagery" description="Restore the original map imagery in this area for everyone. The incident and its field reports stay on the map." onClose={() => setModal(null)}>
      <RemoveAerial incident={active} access={access} onRemove={next => {
        if (active.recoveryImagery) setRecoveryImagery(current => current.filter(image => image.url !== active.recoveryImagery?.url));
        applyIncident(next); setModal(null); setMessage("Aerial imagery removed.");
        void refreshList().catch(() => {});
      }} />
    </Modal>}
    {modal === "resolve" && active && !active.resolvedAt && <Modal title="Mark area repaired" description="Resolve this incident once someone has verified the area has recovered." onClose={() => setModal(null)}>
      <ResolveIncident incident={active} access={access} onResolve={next => {
        applyIncident(next);
        const recovery = next.recoveryImagery;
        if (recovery) setRecoveryImagery(current => [...current.filter(image => image.url !== recovery.url), recovery]);
        setModal(null); setMessage("Incident resolved. Standard directions have resumed.");
        void refreshList().catch(() => {});
      }} />
    </Modal>}
  </main>;
}
