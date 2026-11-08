"use client";

import { ArrowRight, ChevronRight, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Place } from "@/lib/incident-types";

export default function PlaceFinder({ label, initialValue = "", autoFocus = false, stop, onEdit, onFocus, onSelect }: {
  label: string; initialValue?: string; autoFocus?: boolean; stop?: "start" | "destination";
  onEdit?: () => void; onFocus?: () => void; onSelect: (place: Place) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initialValue);
  const [focused, setFocused] = useState(autoFocus);
  const [matches, setMatches] = useState<{ query: string; places: Place[] } | null>(null);
  const [status, setStatus] = useState("");
  const [committed, setCommitted] = useState(initialValue);
  const current = useRef<AbortController | null>(null);
  const selectPlace = useRef(onSelect);
  const query = draft.trim();
  const visible = focused && query.length >= 2 && query !== committed;
  const results = visible && matches?.query === query ? matches.places : [];

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

  return <div className={`place-finder${stop ? ` stop-finder ${stop}` : ""}`} onFocus={() => setFocused(true)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <form className={`world-search${draft ? " has-text" : ""}`} onSubmit={submit}>
      {stop ? <span className="stop-dot" aria-hidden /> : <Search size={18} aria-hidden />}
      <input ref={input} aria-label={label} name={stop ?? "place"} autoComplete="off" autoFocus={autoFocus}
        placeholder={stop ? (stop === "start" ? "Starting point" : "Destination") : "Search a place or address…"}
        maxLength={120} value={draft} onFocus={onFocus} onChange={event => edit(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") setFocused(false); }} />
      {draft && <button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => { edit(""); input.current?.focus(); }}>
        <X size={15} aria-hidden />
      </button>}
      {(!stop || query !== committed) && <button type="submit" aria-label="Search" disabled={query.length < 2}>
        <ArrowRight size={17} aria-hidden />
      </button>}
    </form>
    {visible && status && <small className="direction-search-status" role="status">{status}</small>}
    {!!results.length && <div className="world-results" aria-label={`${label} results`}>
      {results.map(item => <button key={item.id} type="button" className="world-result" onClick={() => choose(item)}>
        <MapPin size={16} aria-hidden /><span><strong>{item.name}</strong><small>{item.detail}</small></span><ChevronRight size={14} aria-hidden />
      </button>)}
      <small className="world-attribution">Search by <a href="https://github.com/komoot/photon" target="_blank" rel="noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></small>
    </div>}
  </div>;
}
