"use client";

import { useEffect, useRef, useState } from "react";
import { Layers2, Satellite } from "lucide-react";
import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type Map as MapInstance } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, LineString } from "geojson";
import { boundsTuple, incidentCoverage, lngLat, roadPoints, type Coordinate, type GeographicBounds, type Incident, type IncidentImagery, type IncidentRoute, type IncidentSummary, type SurveyRaster } from "@/lib/incident-types";

type Camera = { center: Coordinate; zoom: number };
type Focus = { point: Coordinate; zoom?: number } | { bounds: GeographicBounds };
type Props = {
  incidents: IncidentSummary[]; active: Incident | null; focus: Focus | null; route: IncidentRoute | null;
  start: Coordinate | null; destination: Coordinate | null; selectedRoad: string | null; aerial: boolean; picking: boolean;
  pickingTripPoint?: boolean;
  onCamera: (camera: Camera) => void; onPoint: (point: Coordinate) => void;
  onRoad: (id: string) => void; onIncident: (id: string) => void;
  onReport?: (id: string) => void;
  sidebarVisible?: boolean;
  recoveryImagery?: IncidentImagery[];
  draftPassage?: Coordinate[];
  aerialFlagIds?: Set<string>;
  navigationPosition?: Coordinate;
  navigationZoom?: number;
  onFreePan?: () => void;
  incidentPreview?: { center: Coordinate; bounds: GeographicBounds } | null;
};
const style = "https://tiles.openfreemap.org/styles/liberty";
const satelliteLayer = "satellite-basemap";
const satelliteTiles = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg";
const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim();
const satelliteRoads = ["road_motorway", "road_trunk_primary", "road_secondary_tertiary", "road_street"];
const satelliteRoadLayer = (id: string) => `satellite-${id}`;
const collection = (features: Feature<Geometry>[] = []): FeatureCollection => ({ type: "FeatureCollection", features });
const point = (coordinate: Coordinate, properties: Record<string, string>): Feature => ({
  type: "Feature", geometry: { type: "Point", coordinates: lngLat(coordinate) }, properties,
});
const polygon = (bounds: GeographicBounds, properties: Record<string, string>): Feature => {
  const [w, s, e, n] = boundsTuple(bounds);
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, properties };
};

function addSatellite(map: MapInstance) {
  map.addSource(satelliteLayer, maptilerKey
    ? { type: "raster", url: `https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=${encodeURIComponent(maptilerKey)}`, tileSize: 256 }
    : {
      type: "raster", tiles: [satelliteTiles], tileSize: 256, maxzoom: 14,
      attribution: '<a href="https://cloudless.eox.at/" target="_blank" rel="noopener">EOxCloudless</a> by EOX IT Services GmbH (modified Copernicus Sentinel data 2016)',
    });
  const firstLabel = map.getLayer("waterway_line_label") ? "waterway_line_label" : undefined;
  map.addLayer({ id: satelliteLayer, type: "raster", source: satelliteLayer }, firstLabel);
  for (const id of satelliteRoads) {
    const road = map.getStyle().layers.find(layer => layer.id === id);
    if (road?.type !== "line") continue;
    map.addLayer({
      ...road, id: satelliteRoadLayer(id), minzoom: Math.max(10, road.minzoom ?? 0),
      paint: { "line-color": id === "road_street" ? "#eee9d8" : "#ffdfa5",
        "line-opacity": id === "road_street" ? .55 : .78,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 17, 2.5] },
    }, firstLabel);
  }
}

function addLayers(map: MapInstance, satellite: boolean) {
  if (satellite) addSatellite(map);
  for (const id of ["incidents", "boundaries", "roads", "route", "markers", "reports", "passage-draft"]) {
    map.addSource(id, { type: "geojson", data: collection() });
  }
  map.addLayer({ id: "incident-boundary-fill", type: "fill", source: "boundaries",
    paint: { "fill-color": "#de801a", "fill-opacity": .07 } });
  map.addLayer({ id: "incident-boundary-line", type: "line", source: "boundaries",
    paint: { "line-color": "#c75a12", "line-width": 2, "line-dasharray": [3, 2] } });
  map.addLayer({ id: "incident-roads-hit", type: "line", source: "roads", paint: { "line-width": 20, "line-opacity": 0 } });
  map.addLayer({ id: "incident-roads", type: "line", source: "roads", layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["match", ["get", "state"], "open", "#138962", "blocked", "#d13943",
        "hazard", "#cc7319", "conflict", "#b16a13", "#7c868b"],
      "line-opacity": ["case", ["==", ["get", "state"], "unknown"], .57, .95],
      "line-width": ["case", ["==", ["get", "selected"], "yes"], 7, ["==", ["get", "state"], "unknown"], 2, 4],
    } });
  map.addLayer({ id: "aerial-scan-flags", type: "line", source: "roads", filter: ["==", ["get", "aerialFlag"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#c185ff", "line-width": 4, "line-dasharray": [1.5, 1.5] } });
  map.addLayer({ id: "passage-draft-line", type: "line", source: "passage-draft",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#fff", "line-width": 4, "line-dasharray": [1, 1] } });
  map.addLayer({ id: "passage-draft-points", type: "circle", source: "passage-draft",
    paint: { "circle-color": "#176df1", "circle-radius": 5, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  map.addLayer({ id: "reported-points", type: "circle", source: "reports", paint: {
    "circle-color": "#dd8122", "circle-radius": 6, "circle-stroke-color": "#fff", "circle-stroke-width": 2,
  } });
  map.addLayer({ id: "route-outline", type: "line", source: "route",
    layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 9 } });
  map.addLayer({ id: "route-line", type: "line", source: "route", filter: ["!=", ["get", "state"], "unverified"],
    layout: { "line-cap": "round", "line-join": "round" }, paint: {
      "line-color": ["case", ["==", ["get", "state"], "partial"], "#ce781d", "#176df1"], "line-width": 5.5,
    } });
  map.addLayer({ id: "route-unverified", type: "line", source: "route", filter: ["==", ["get", "state"], "unverified"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ae5208", "line-width": 5.5, "line-dasharray": [1.4, 1.8] } });
  map.addLayer({ id: "incident-pins", type: "circle", source: "incidents", paint: {
    "circle-color": "#e67429", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5, "circle-radius": 8,
  } });
  map.addLayer({ id: "trip-pins", type: "circle", source: "markers", paint: {
    "circle-color": ["match", ["get", "kind"], "position", "#087bfb", "start", "#2678ef", "incident", "#d46a20", "#d94050"],
    "circle-stroke-color": "#fff", "circle-stroke-width": 3,
    "circle-radius": ["case", ["==", ["get", "kind"], "position"], 10, 8],
  } });
}

export default function WorldMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const surveyLayers = useRef(new Set<string>());
  const inputs = useRef(props);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [satellite, setSatellite] = useState(true);
  const locationPicker = props.incidentPreview !== undefined;
  useEffect(() => { inputs.current = props; }, [props]);
  useEffect(() => {
    if (!host.current) return;
    setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
    const initial = inputs.current.incidentPreview !== undefined ? inputs.current.focus : null;
    let view: MapInstance;
    try { view = new MapLibreMap({
      container: host.current, style,
      center: initial && "point" in initial ? lngLat(initial.point) : [0, 24],
      zoom: initial && "point" in initial ? initial.zoom ?? 14 : 1.65, maxZoom: 21,
      minZoom: 1, renderWorldCopies: false,
      attributionControl: { compact: true }, pitchWithRotate: false,
    }); } catch {
      setMessage("The world map requires WebGL. Enable it in your browser and refresh."); return;
    }
    map.current = view;
    if (inputs.current.incidentPreview === undefined) {
      view.scrollZoom.setWheelZoomRate(1 / 180);
      view.scrollZoom.setZoomRate(1 / 70);
    }
    const observer = new ResizeObserver(() => view.resize());
    observer.observe(host.current);
    view.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    view.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");
    view.on("load", () => {
      addLayers(view, inputs.current.incidentPreview === undefined);
      setReady(true);
      setMessage("");
    });
    view.on("error", () => {
      if (!view.getSource("incidents")) setMessage("The world map couldn’t load. Check the connection and refresh.");
    });
    view.on("moveend", () => {
      const center = view.getCenter().wrap();
      inputs.current.onCamera({ center: { latitude: center.lat, longitude: center.lng }, zoom: view.getZoom() });
    });
    view.on("dragstart", () => inputs.current.onFreePan?.());
    view.on("click", event => {
      const current = inputs.current;
      const location = event.lngLat.wrap();
      const coordinate = { latitude: location.lat, longitude: location.lng };
      if (current.picking) { current.onPoint(coordinate); return; }
      const layers = ["incident-pins", "reported-points", "incident-roads-hit"].filter(id => view.getLayer(id));
      if (!layers.length) return;
      const features = view.queryRenderedFeatures(event.point, { layers });
      const item = features.find(feature => feature.layer.id === "reported-points") ?? features[0];
      if (item?.layer.id === "incident-pins") current.onIncident(String(item.properties.id));
      if (item?.layer.id === "reported-points") current.onReport?.(String(item.properties.id));
      if (item?.layer.id === "incident-roads-hit") current.onRoad(String(item.properties.id));
    });
    for (const layer of ["incident-pins", "reported-points"]) {
      view.on("mouseenter", layer, () => { view.getCanvas().style.cursor = inputs.current.picking ? "" : "pointer"; });
      view.on("mouseleave", layer, () => { view.getCanvas().style.cursor = ""; });
    }
    return () => { observer.disconnect(); surveyLayers.current.clear(); map.current = null; view.remove(); };
  }, []);

  useEffect(() => {
    const view = map.current;
    if (!ready || !view?.getLayer(satelliteLayer)) return;
    const layers = [satelliteLayer, ...satelliteRoads.map(satelliteRoadLayer)];
    for (const layer of layers) {
      if (view.getLayer(layer)) view.setLayoutProperty(layer, "visibility", satellite ? "visible" : "none");
    }
  }, [ready, satellite]);

  useEffect(() => {
    const view = map.current;
    if (!ready || !view || props.sidebarVisible === undefined) return;
    const app = host.current?.closest(".world-app");
    const sidebar = props.sidebarVisible ? app?.querySelector(".world-sidebar") : null;
    const mobileOverlay = app?.classList.contains("world-main-map");
    const desktop = matchMedia("(min-width: 741px)");
    function resizePadding() {
      if (!view || inputs.current.pickingTripPoint) return;
      const rect = sidebar?.getBoundingClientRect();
      const left = desktop.matches && rect ? Math.ceil(rect.width) : 0;
      const bottom = !desktop.matches && mobileOverlay && rect && app ? Math.min(Math.ceil(rect.height), Math.round(app.clientHeight * .53)) : 0;
      const current = view.getPadding();
      if (current.left !== left || current.bottom !== bottom) view.setPadding({ left, top: 0, right: 0, bottom });
    }
    const observer = new ResizeObserver(resizePadding);
    if (sidebar) observer.observe(sidebar);
    desktop.addEventListener("change", resizePadding);
    resizePadding();
    return () => { observer.disconnect(); desktop.removeEventListener("change", resizePadding); };
  }, [ready, props.sidebarVisible]);

  useEffect(() => {
    if (props.pickingTripPoint) map.current?.stop();
  }, [props.pickingTripPoint]);

  useEffect(() => {
    if (!ready || !map.current || !props.focus) return;
    const view = map.current;
    const duration = inputs.current.incidentPreview !== undefined || matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700;
    if ("point" in props.focus) view.flyTo({ center: lngLat(props.focus.point), zoom: props.focus.zoom ?? 14, duration });
    else {
      const [west, south, east, north] = boundsTuple(props.focus.bounds);
      view.fitBounds([[west, south], [east, north]], { padding: 50, duration, maxZoom: 17 });
    }
  }, [props.focus, ready]);

  useEffect(() => {
    const view = map.current;
    if (!ready || !view || !props.navigationPosition || props.navigationZoom === undefined) return;
    view.easeTo({
      center: lngLat(props.navigationPosition), zoom: Math.max(view.getZoom(), props.navigationZoom),
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360,
    });
  }, [props.navigationPosition, props.navigationZoom, ready]);

  useEffect(() => {
    const view = map.current;
    if (!view || !ready) return;
    const set = (id: string, features: Feature[]) => (view.getSource(id) as GeoJSONSource).setData(collection(features));
    const active = props.active?.resolvedAt ? null : props.active;
    const others = props.incidents.filter(item => item.id !== props.active?.id);
    set("incidents", others.map(item => {
      const [west, south, east, north] = boundsTuple(item.bounds);
      return point({ latitude: (south + north) / 2, longitude: (east + west) / 2 }, { id: item.id });
    }));
    set("boundaries", props.incidentPreview ? [polygon(props.incidentPreview.bounds, { id: "preview" })] :
      [...others, ...(active ? [active] : [])].flatMap(item => {
        const areas = incidentCoverage(item);
        return (areas.length > 1 ? areas.slice(1) : areas).map(bounds => polygon(bounds, { id: item.id }));
      }));
    set("roads", (active?.roads ?? []).map(road => ({
      type: "Feature", geometry: { type: "LineString", coordinates: roadPoints(road).map(lngLat) },
      properties: { id: road.id, state: road.state, selected: props.selectedRoad === road.id ? "yes" : "no",
        aerialFlag: road.state === "unknown" && props.aerial && props.aerialFlagIds?.has(road.id) === true },
    })));
    set("reports", (active?.reports ?? []).flatMap(report =>
      report.location && !report.edgeId ? [point(report.location, { id: report.id })] : []));
    const route = props.route;
    const lines: Feature<LineString>[] = [];
    if (route) {
      const unverified = new Set(route.unverifiedSegments);
      for (let index = 1; index < route.coordinates.length; index++) {
        const state = unverified.has(index - 1) ? "unverified" : route.status;
        const last = lines.at(-1);
        const position = lngLat(route.coordinates[index]);
        if (last?.properties?.state === state) last.geometry.coordinates.push(position);
        else lines.push({ type: "Feature", geometry: {
          type: "LineString", coordinates: [lngLat(route.coordinates[index - 1]), position],
        }, properties: { state } });
      }
    }
    set("route", lines);
  }, [ready, props.incidents, props.active, props.route, props.selectedRoad, props.incidentPreview, props.aerial, props.aerialFlagIds]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const points = props.draftPassage ?? [];
    const features = points.map(coordinate => point(coordinate, {}));
    if (points.length > 1) features.unshift({
      type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points.map(lngLat) },
    });
    (map.current.getSource("passage-draft") as GeoJSONSource).setData(collection(features));
  }, [ready, props.draftPassage]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const markers = map.current.getSource("markers") as GeoJSONSource;
    markers.setData(collection([
      ...(props.start ? [point(props.start, { kind: "start" })] : []),
      ...(props.destination ? [point(props.destination, { kind: "destination" })] : []),
      ...(props.navigationPosition ? [point(props.navigationPosition, { kind: "position" })] : []),
      ...(props.incidentPreview ? [point(props.incidentPreview.center, { kind: "incident" })] : []),
    ]));
  }, [ready, props.start, props.destination, props.incidentPreview, props.navigationPosition]);

  useEffect(() => {
    if (!map.current || !ready || locationPicker) return;
    const view: MapInstance = map.current;
    // Keep the map's place and street names above the new imagery.
    const surveyBefore = view.getLayer("waterway_line_label") ? "waterway_line_label" : "incident-boundary-fill";
    const { active, aerial, incidents, recoveryImagery } = props;
    const layers = surveyLayers.current;
    function renderSurveys() {
      const bounds = view.getBounds();
      const showsArea = (image: SurveyRaster) => view.getZoom() >= 9 &&
        image.bounds.west <= bounds.getEast() && image.bounds.east >= bounds.getWest() &&
        image.bounds.south <= bounds.getNorth() && image.bounds.north >= bounds.getSouth();
      const activeSurveys = (item: IncidentSummary) => item.surveys ?? (item.imagery ? [item.imagery] : []);
      const images = [
        ...(recoveryImagery ?? []).filter(showsArea),
        ...incidents.filter(item => item.id !== active?.id).flatMap(item => activeSurveys(item).filter(showsArea)),
        ...(aerial && active && !active.resolvedAt ? activeSurveys(active) : []),
      ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const rasters = images.flatMap(image => [image,
        ...(view.getZoom() >= 16 ? (image.detailTiles ?? []).filter(showsArea) : [])]);
      const next = new Map(rasters.map(image => [`after-survey-${image.url.split("/").at(-1)}`, image]));
      if (next.size === layers.size && [...next.keys()].every(id => layers.has(id))) return;
      for (const id of layers) if (!next.has(id)) {
        view.removeLayer(id);
        view.removeSource(id);
        layers.delete(id);
      }
      for (const [id, image] of next) {
        if (!layers.has(id)) {
          const [w, s, e, n] = boundsTuple(image.bounds);
          view.addSource(id, { type: "image", url: image.url, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
          view.addLayer({ id, type: "raster", source: id, paint: { "raster-fade-duration": 0 } }, surveyBefore);
          layers.add(id);
        } else view.moveLayer(id, surveyBefore);
      }
    }
    renderSurveys();
    view.on("moveend", renderSurveys);
    view.on("resize", renderSurveys);
    return () => { view.off("moveend", renderSurveys); view.off("resize", renderSurveys); };
  }, [locationPicker, props.active, props.aerial, props.incidents, props.recoveryImagery, ready]);

  return <div className={`world-canvas ${props.picking ? "is-picking" : ""}`}>
    <div ref={host} className="world-map" aria-label="Interactive world map" />
    {!locationPicker && <button type="button" className="world-basemap" aria-pressed={satellite}
      aria-label="Satellite basemap" onClick={() => setSatellite(value => !value)}>
      {satellite ? <Satellite size={16} aria-hidden /> : <Layers2 size={16} aria-hidden />}
      {satellite ? maptilerKey ? "Satellite" : "Satellite · 2016" : "Streets"}
    </button>}
    {!locationPicker && satellite && maptilerKey && <a className="world-maptiler" href="https://www.maptiler.com/" target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler" width={78} height={20} />
    </a>}
    {message && <div className="world-map-error" role="status">{message}</div>}
  </div>;
}
