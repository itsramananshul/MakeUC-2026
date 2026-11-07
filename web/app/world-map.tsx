"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type Map as MapInstance } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { boundsTuple, lngLat, type Coordinate, type GeographicBounds, type Incident, type IncidentRoute, type IncidentSummary } from "@/lib/incident-types";

type Camera = { center: Coordinate; zoom: number };
type Focus = { point: Coordinate; zoom?: number } | { bounds: GeographicBounds };
type Props = {
  incidents: IncidentSummary[]; active: Incident | null; focus: Focus | null; route: IncidentRoute | null;
  start: Coordinate | null; destination: Coordinate | null; selectedRoad: string | null; aerial: boolean; picking: boolean;
  onCamera: (camera: Camera) => void; onPoint: (point: Coordinate) => void;
  onRoad: (id: string) => void; onIncident: (id: string) => void;
};
const style = "https://tiles.openfreemap.org/styles/liberty";
const collection = (features: Feature<Geometry>[] = []): FeatureCollection => ({ type: "FeatureCollection", features });
const point = (coordinate: Coordinate, properties: Record<string, string>): Feature => ({
  type: "Feature", geometry: { type: "Point", coordinates: lngLat(coordinate) }, properties,
});
const polygon = (bounds: GeographicBounds, properties: Record<string, string>): Feature => {
  const [w, s, e, n] = boundsTuple(bounds);
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, properties };
};

function addLayers(map: MapInstance) {
  for (const id of ["incidents", "boundaries", "roads", "route", "markers", "reports"]) {
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
  map.addLayer({ id: "reported-points", type: "circle", source: "reports", paint: {
    "circle-color": "#dd8122", "circle-radius": 6, "circle-stroke-color": "#fff", "circle-stroke-width": 2,
  } });
  map.addLayer({ id: "route-outline", type: "line", source: "route",
    layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 9 } });
  map.addLayer({ id: "route-line", type: "line", source: "route",
    layout: { "line-cap": "round", "line-join": "round" }, paint: {
      "line-color": ["case", ["==", ["get", "state"], "partial"], "#ce781d", "#176df1"], "line-width": 5.5,
    } });
  map.addLayer({ id: "incident-pins", type: "circle", source: "incidents", paint: {
    "circle-color": "#e67429", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5, "circle-radius": 8,
  } });
  map.addLayer({ id: "trip-pins", type: "circle", source: "markers", paint: {
    "circle-color": ["case", ["==", ["get", "kind"], "start"], "#2678ef", "#d94050"],
    "circle-stroke-color": "#fff", "circle-stroke-width": 3, "circle-radius": 8,
  } });
}

export default function WorldMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const inputs = useRef(props);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { inputs.current = props; }, [props]);
  useEffect(() => {
    if (!host.current) return;
    setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
    let view: MapInstance;
    try { view = new MapLibreMap({
      container: host.current, style, center: [0, 24], zoom: 1.65, maxZoom: 21,
      minZoom: 1, attributionControl: { compact: true }, pitchWithRotate: false,
    }); } catch {
      setMessage("The world map requires WebGL. Enable it in your browser and refresh."); return;
    }
    map.current = view;
    const observer = new ResizeObserver(() => view.resize());
    observer.observe(host.current);
    view.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    view.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");
    view.on("load", () => { addLayers(view); setReady(true); setMessage(""); });
    view.on("error", () => {
      if (!view.getSource("incidents")) setMessage("The world map couldn’t load. Check the connection and refresh.");
    });
    view.on("moveend", () => {
      const center = view.getCenter().wrap();
      inputs.current.onCamera({ center: { latitude: center.lat, longitude: center.lng }, zoom: view.getZoom() });
    });
    view.on("click", event => {
      const current = inputs.current;
      const location = event.lngLat.wrap();
      const coordinate = { latitude: location.lat, longitude: location.lng };
      if (current.picking) { current.onPoint(coordinate); return; }
      const layers = ["incident-pins", "incident-roads-hit"].filter(id => view.getLayer(id));
      if (!layers.length) return;
      const features = view.queryRenderedFeatures(event.point, { layers });
      const item = features[0];
      if (item?.layer.id === "incident-pins") current.onIncident(String(item.properties.id));
      if (item?.layer.id === "incident-roads-hit") current.onRoad(String(item.properties.id));
    });
    view.on("mouseenter", "incident-pins", () => { view.getCanvas().style.cursor = "pointer"; });
    view.on("mouseleave", "incident-pins", () => { view.getCanvas().style.cursor = ""; });
    return () => { observer.disconnect(); map.current = null; view.remove(); };
  }, []);

  useEffect(() => {
    if (!ready || !map.current || !props.focus) return;
    const view = map.current;
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700;
    if ("point" in props.focus) view.flyTo({ center: lngLat(props.focus.point), zoom: props.focus.zoom ?? 14, duration });
    else {
      const [west, south, east, north] = boundsTuple(props.focus.bounds);
      view.fitBounds([[west, south], [east, north]], { padding: 50, duration, maxZoom: 17 });
    }
  }, [props.focus, ready]);

  useEffect(() => {
    const view = map.current;
    if (!view || !ready) return;
    const set = (id: string, features: Feature[]) => (view.getSource(id) as GeoJSONSource).setData(collection(features));
    set("incidents", props.incidents.filter(item => item.id !== props.active?.id).map(item => {
      const [west, south, east, north] = boundsTuple(item.bounds);
      return point({ latitude: (south + north) / 2, longitude: (east + west) / 2 }, { id: item.id });
    }));
    set("boundaries", props.active ? [polygon(props.active.bounds, { id: props.active.id })] : []);
    set("roads", (props.active?.roads ?? []).map(road => ({
      type: "Feature", geometry: { type: "LineString", coordinates: [lngLat(road.from), lngLat(road.to)] },
      properties: { id: road.id, state: road.state, selected: props.selectedRoad === road.id ? "yes" : "no" },
    })));
    set("reports", (props.active?.reports ?? []).flatMap(report =>
      report.location && !report.edgeId ? [point(report.location, { id: report.id })] : []));
    set("route", props.route && props.route.coordinates.length > 1 ? [{
      type: "Feature", geometry: { type: "LineString", coordinates: props.route.coordinates.map(lngLat) },
      properties: { state: props.route.status },
    }] : []);
    set("markers", [
      ...(props.start ? [point(props.start, { kind: "start" })] : []),
      ...(props.destination ? [point(props.destination, { kind: "destination" })] : []),
    ]);
  }, [ready, props.incidents, props.active, props.route, props.start, props.destination, props.selectedRoad]);

  const images = props.aerial && props.active ? props.active.surveys ?? (props.active.imagery ? [props.active.imagery] : []) : [];
  const imageKey = images.map(image => image.url).join("|");
  useEffect(() => {
    const view = map.current;
    if (!view || !ready || !images.length) return;
    const layerIds = images.map((image, index) => {
      const id = `after-survey-${index}`;
      const [w, s, e, n] = boundsTuple(image.bounds);
      view.addSource(id, { type: "image", url: image.url, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
      view.addLayer({ id, type: "raster", source: id, paint: { "raster-fade-duration": 0 } }, "incident-boundary-fill");
      return id;
    });
    return () => {
      if (map.current !== view) return;
      for (const id of layerIds) {
        if (view.getLayer(id)) view.removeLayer(id);
        if (view.getSource(id)) view.removeSource(id);
      }
    };
  }, [imageKey, ready]);

  return <div className={`world-canvas ${props.picking ? "is-picking" : ""}`}>
    <div ref={host} className="world-map" aria-label="Interactive world map" />
    {message && <div className="world-map-error" role="status">{message}</div>}
  </div>;
}
