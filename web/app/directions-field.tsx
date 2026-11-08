"use client";

import { MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Coordinate, Place } from "@/lib/incident-types";
import { fetchJson } from "@/lib/world-client";

export type TripPoint = Coordinate & { label: string };

export default function DirectionsField({ side, point, onClear, onSelect, onPick }: {
  side: "start" | "destination"; point: TripPoint | null;
  onClear: () => void; onSelect: (place: Place) => void; onPick: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState("");
  const [request, setRequest] = useState(0);
  const query = draft.trim();
  const label = side === "start" ? "Starting point" : "Destination";
  const visible = focused && !point && query.length >= 2;

  useEffect(() => {
    if (point) { setDraft(""); setPlaces([]); setStatus(""); }
  }, [point]);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("Searching…");
      try {
        const result = await fetchJson<{ places: Place[] }>(`/api/places?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setPlaces(result.places.slice(0, 5));
        setStatus(result.places.length ? "" : "No matching places.");
      } catch (error) {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Place search is unavailable.");
      }
    }, 850);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [visible, query, request]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (places.length && visible) {
      onSelect(places[0]);
    } else if (!point && query.length >= 2) {
      setFocused(true); setRequest(value => value + 1);
    }
  }

  return <div className={`direction-field ${side}`} onFocus={() => setFocused(true)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <label htmlFor={`directions-${side}`}>{label}</label>
    <form className="world-search direction-input" onSubmit={submit}>
      <i aria-hidden />
      <input ref={input} id={`directions-${side}`} name={side} placeholder="Search a place or address…" maxLength={120}
        autoComplete="off" value={point?.label ?? draft}
        onChange={event => { setDraft(event.target.value); setPlaces([]); setStatus(""); onClear(); }}
        onKeyDown={event => { if (event.key === "Escape") setFocused(false); }} />
      <button aria-label={`Search ${label.toLowerCase()}`} type="submit" disabled={!!point || query.length < 2}><Search size={15} /></button>
      <button aria-label={side === "start" ? "Pick start on map" : "Pick destination on map"} type="button"
        title="Pick on map" onClick={() => { setFocused(false); onPick(); }}><MapPin size={16} /></button>
    </form>
    {visible && status && <small className="direction-search-status" role="status">{status}</small>}
    {visible && !!places.length && <div className="world-results" aria-label={`${label} results`}>
      {places.map(place => <button key={place.id} className="world-result" type="button" onClick={() => {
        onSelect(place); input.current?.focus();
      }}>
        <MapPin size={15} /><span><strong>{place.name}</strong><small>{place.detail}</small></span>
      </button>)}
    </div>}
  </div>;
}
