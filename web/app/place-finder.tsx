"use client";

import { ArrowRight, ChevronRight, Clock, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Place } from "@/lib/incident-types";

const recentKey = "gaslight.recentPlaces";
function recentPlaces(): Place[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(saved) ? saved.filter(item => item && typeof item.id === "string" &&
      typeof item.name === "string" && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).slice(0, 12) : [];
  } catch { return []; }
}

export default function PlaceFinder({ label, initialValue = "", autoFocus = false, stop, onEdit, onFocus, onSelect, onCancel }: {
  label: string; initialValue?: string; autoFocus?: boolean; stop?: "start" | "destination";
  onEdit?: () => void; onFocus?: () => void; onSelect: (place: Place) => void; onCancel?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initialValue);
  const [focused, setFocused] = useState(autoFocus);
  const [matches, setMatches] = useState<{ query: string; places: Place[] } | null>(null);
  const [status, setStatus] = useState("");
  const [recent, setRecent] = useState<Place[]>([]);
  const [committed, setCommitted] = useState(initialValue);
  const current = useRef<AbortController | null>(null);
  const selectPlace = useRef(onSelect);
  const query = draft.trim();
  const visible = focused && query.length >= 2 && query !== committed;
  const results = visible && matches?.query === query ? matches.places : [];

  useEffect(() => { setRecent(recentPlaces()); }, []);
  useEffect(() => { selectPlace.current = onSelect; }, [onSelect]);
  useEffect(() => () => current.current?.abort(), []);
  useEffect(() => {
    if (!initialValue) return;
    current.current?.abort();
    setDraft(initialValue); setCommitted(initialValue); setMatches(null); setStatus("");
  }, [initialValue]);

  function choose(place: Place) {
    current.current?.abort();
    setDraft(place.name); setCommitted(place.name); setStatus(""); setMatches(null);
    const next = [place, ...recentPlaces().filter(item => item.id !== place.id)].slice(0, 12);
    try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch {}
    setRecent(next);
    selectPlace.current(place);
  }

  async function search(term: string, selectBest: boolean) {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setStatus("Searching…");
    try {
      const url = `/api/places?q=${encodeURIComponent(term)}`;
      const request = () => fetch(url, { cache: "no-store", signal: controller.signal });
      let response = await request();
      if (response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 850));
        response = await request();
      }
      if (controller.signal.aborted) return;
      if (response.status === 429) throw new Error("Search is busy. Pause for a moment, then try again.");
      if (!response.ok) throw new Error("Place search is unavailable. Try again shortly.");
      const { places } = await response.json() as { places: Place[] };
      if (controller.signal.aborted) return;
      if (selectBest && places.length) choose(places[0]);
      else {
        setMatches({ query: term, places });
        setStatus(places.length ? "" : "No matching places. Try a city, address, or landmark.");
      }
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Place search is unavailable.");
    }
  }

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => {
      if (!current.current || current.current.signal.aborted) void search(query, false);
    }, 850);
    return () => clearTimeout(timer);
  }, [query, visible]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.length < 2) return;
    if (results.length) { choose(results[0]); return; }
    setCommitted(""); setFocused(true);
    void search(query, true);
  }
  function edit(value: string) {
    current.current?.abort(); setDraft(value); setCommitted(""); setMatches(null); setStatus("");
    onEdit?.();
  }
  function cancel() {
    current.current?.abort();
    setDraft(committed); setMatches(null); setStatus("");
    setFocused(false);
    input.current?.blur();
    onCancel?.();
  }

  return <div className={`place-finder${stop ? ` stop-finder ${stop}` : ""}`} onFocus={() => { setFocused(true); setRecent(recentPlaces()); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="place-search-row">
      <form className={`world-search${draft ? " has-text" : ""}`} onSubmit={submit}>
        {stop ? <span className="stop-dot" aria-hidden /> : <Search size={18} aria-hidden />}
        <input ref={input} aria-label={label} name={stop ?? "place"} autoComplete="off" autoFocus={autoFocus}
          placeholder={stop ? (stop === "start" ? "Starting point" : "Destination") : "Search a place or address…"}
          maxLength={120} value={draft} onFocus={onFocus} onChange={event => edit(event.target.value)}
          enterKeyHint="search"
          onKeyDown={event => { if (event.key === "Escape") setFocused(false); }} />
        {draft && <button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => { edit(""); input.current?.focus(); }}>
          <X size={15} aria-hidden />
        </button>}
        {(!stop || query !== committed) && <button type="submit" aria-label="Search" disabled={query.length < 2}>
          <ArrowRight size={17} aria-hidden />
        </button>}
      </form>
      {onCancel && <button className="mobile-search-cancel" type="button" onClick={cancel}>Cancel</button>}
    </div>
    {visible && status && <small className="direction-search-status" role="status">{status}</small>}
    {focused && !query && recent.length > 0 && <div className="world-results" aria-label="Recent searches">
      <small className="world-attribution">Recent searches</small>
      {recent.map(item => <button key={item.id} type="button" className="world-result" onClick={() => choose(item)}>
        <Clock size={16} aria-hidden /><span><strong>{item.name}</strong><small>{item.detail}</small></span><ChevronRight size={14} aria-hidden />
      </button>)}
    </div>}
    {!!results.length && <div className="world-results" aria-label={`${label} results`}>
      {results.map(item => <button key={item.id} type="button" className="world-result" onClick={() => choose(item)}>
        <MapPin size={16} aria-hidden /><span><strong>{item.name}</strong><small>{item.detail}</small></span><ChevronRight size={14} aria-hidden />
      </button>)}
      <small className="world-attribution">Search by <a href="https://github.com/komoot/photon" target="_blank" rel="noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></small>
    </div>}
  </div>;
}
