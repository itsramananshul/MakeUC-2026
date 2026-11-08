"use client";

import { useEffect, useRef, useState } from "react";
import { distanceMeters, type Coordinate, type TravelMode } from "@/lib/incident-types";
import { indexRoute, navigationLimits, navigationProgress, type NavigationFix, type NavigationRoute } from "@/lib/navigation";
import { fetchJson } from "@/lib/world-client";

type Trip = { destination: Coordinate & { label: string }; mode: TravelMode; route: NavigationRoute };
type Phase = "locating" | "following" | "rerouting" | "paused" | "arrived";
type Snapshot = {
  route: NavigationRoute; phase: Phase; note: string; position?: NavigationFix;
  progress?: ReturnType<typeof navigationProgress>;
};

export function useLiveNavigation(revision: string) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const refresh = useRef<(() => void) | null>(null);
  const lastRevision = useRef(revision);

  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    refresh.current?.();
  }, [revision]);

  useEffect(() => {
    if (!trip) return;
    let active = true;
    let route = trip.route;
    let path = indexRoute(route);
    let lastAlong = 0;
    let recent: NavigationFix | undefined;
    let outliers = 0;
    let lastRequest = 0;
    let controller: AbortController | null = null;
    let confirmed = false;
    let arrived = false;
    let routeValid = true;
    const destination = trip.destination;
    const limits = navigationLimits[trip.mode];
    function display(phase: Phase, note = "", progress?: Snapshot["progress"]) {
      if (active) setSnapshot({ route, phase, note, position: recent, progress });
    }
    function follow(position: NavigationFix) {
      const progress = navigationProgress(position, path, lastAlong);
      const goodFix = position.accuracy <= limits.accuracy;
      if (!goodFix) {
        display("paused", "GPS accuracy is low. Waiting for a better location.");
        return;
      }
      if (!routeValid) { void recalculate(); return; }
      if (progress.gap > Math.max(limits.offRoute, position.accuracy * 1.3)) {
        outliers++;
        if (!confirmed || outliers >= 2) void recalculate();
        return;
      }
      confirmed = true;
      outliers = 0;
      lastAlong = progress.along;
      const end = route.coordinates.at(-1)!;
      if (progress.remaining <= limits.arrival && distanceMeters(position, end) <= limits.arrival &&
          position.accuracy <= Math.max(20, limits.arrival)) {
        arrived = true;
        display("arrived", distanceMeters(end, destination) > limits.arrival * 2 ? "Reached the end of the mapped route." : "You’ve arrived.");
        return;
      }
      display("following", "", progress);
    }
    async function recalculate(force = false) {
      if (!recent || !trip || arrived || recent.accuracy > limits.accuracy) return;
      if (controller) {
        if (!force) return;
        controller.abort();
      }
      if (!force && Date.now() - lastRequest < 8500) {
        display("paused", "Off route. Waiting to check for another route.");
        return;
      }
      const request = new AbortController();
      controller = request;
      routeValid = false;
      lastRequest = Date.now();
      display("rerouting", "Finding an updated route…");
      try {
        const origin = recent;
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
        const next = await fetchJson<NavigationRoute>("/api/routes", {
          method: "POST", signal, headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin, destination, mode: trip.mode }),
        });
        if (!active || request.signal.aborted) return;
        if (next.status !== "complete" || next.coordinates.length < 2) {
          display("paused", next.reason);
          return;
        }
        if (next.unverifiedSegments?.length) {
          display("paused", "The available route includes streets that haven’t been confirmed open.");
          return;
        }
        route = next.options?.[0] ? { ...next, ...next.options[0] } : next;
        path = indexRoute(route);
        routeValid = true;
        controller = null;
        lastAlong = 0;
        outliers = 0;
        follow(recent);
      } catch (error) {
        if (!request.signal.aborted) display("paused", error instanceof Error && error.name !== "TimeoutError" ?
          error.message : "The route service did not respond. Try again.");
      } finally {
        if (controller === request) controller = null;
      }
    }

    display("locating", "Waiting for your current location…");
    refresh.current = () => {
      routeValid = false;
      if (!recent || recent.accuracy > limits.accuracy) display("paused", "The map changed. Waiting for an accurate location to check your route.");
      else void recalculate(true);
    };
    if (!navigator.geolocation) {
      display("paused", "Location is unavailable in this browser.");
      return () => { refresh.current = null; };
    }
    const watch = navigator.geolocation.watchPosition(({ coords }) => {
      if (!active || arrived) return;
      recent = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy };
      if (!controller) follow(recent);
    }, error => {
      if (!arrived) display("paused", error.code === 1 ?
        "Allow location access in your browser to start navigation." : "Waiting for a GPS signal. Check your location settings.");
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15_000 });
    return () => {
      active = false;
      controller?.abort();
      navigator.geolocation.clearWatch(watch);
      refresh.current = null;
    };
  }, [trip]);

  function start(next: Trip) { setSnapshot(null); setTrip(next); }
  function stop() { setTrip(null); setSnapshot(null); }
  function retry() {
    if (snapshot?.position && snapshot.position.accuracy <= (trip ? navigationLimits[trip.mode].accuracy : 0)) {
      refresh.current?.();
    } else if (trip) start({ ...trip, route: snapshot?.route ?? trip.route });
  }
  return { trip, snapshot, start, stop, retry };
}
