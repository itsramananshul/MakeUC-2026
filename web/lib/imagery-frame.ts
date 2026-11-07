export type Bounds = [west: number, south: number, east: number, north: number];
export type ImageryLayer = {
  url: string; label: string; source: string; timestamp: string;
  bounds: Bounds; aligned: boolean; width: number; height: number; count: number;
};
export const DRILL_BOUNDS: Bounds = [-9509604.737329928, 3497015.84054316, -9509156.86411732, 3497338.309256239];
export const BASE_IMAGERY: ImageryLayer = {
  url: "/mexico-beach-noaa.jpg", label: "After Hurricane Michael",
  source: "NOAA National Geodetic Survey · Oct 11, 2018", timestamp: "2018-10-11T00:00:00Z",
  bounds: DRILL_BOUNDS, aligned: true, width: 1500, height: 1080, count: 0,
};
