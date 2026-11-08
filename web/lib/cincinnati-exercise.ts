import type { IncidentImagery, Place } from "./incident-types";

export const cincinnatiFloodImagery: IncidentImagery = {
  bounds: { west: -84.53157984358575, south: 39.09092079263095, east: -84.49942015641427, north: 39.11587699862377 },
  timestamp: "2026-11-08T02:02:17.466Z",
  source: "5 uploaded GeoTIFFs",
  url: "/exercise/cincinnati/flood-survey.webp",
};

export function isCincinnati(place: Place) {
  return place.name.toLowerCase() === "cincinnati" &&
    Math.abs(place.latitude - 39.1031) < .09 && Math.abs(place.longitude + 84.512) < .11;
}
