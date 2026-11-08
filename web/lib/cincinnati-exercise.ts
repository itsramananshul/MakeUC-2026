import type { IncidentImagery, Place } from "./incident-types";

export const cincinnatiFloodImagery: IncidentImagery = {
  bounds: { west: -84.53157984358575, south: 39.09092079263095, east: -84.49942015641427, north: 39.11587699862377 },
  timestamp: "2026-11-08T02:02:17.466Z",
  source: "5 uploaded GeoTIFFs",
  url: "/exercise/cincinnati/flood-survey.webp",
};

export const cincinnatiFloodSurveys: IncidentImagery[] = [cincinnatiFloodImagery, {
  bounds: { west: -84.51105932611365, south: 39.10547849648426, east: -84.50593892899417, north: 39.10945174148621 },
  timestamp: cincinnatiFloodImagery.timestamp,
  source: "Central Parkway detail GeoTIFF",
  url: "/exercise/cincinnati/flood-detail.webp",
}];

export function isCincinnati(place: Place) {
  return place.name.toLowerCase() === "cincinnati" &&
    Math.abs(place.latitude - 39.1031) < .09 && Math.abs(place.longitude + 84.512) < .11;
}
