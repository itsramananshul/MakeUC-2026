"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Camera, Clipboard, Crosshair, Images, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Coordinate, GeographicBounds, Incident, Place, Road } from "@/lib/incident-types";
import { fetchJson, incidentPath, postJson } from "@/lib/world-client";
import WorldMap from "./world-map";

export function Modal({ title, description, onClose, children }: {
  title: string; description: string; onClose: () => void; children: ReactNode;
}) {
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="incident-overlay" />
      <Dialog.Content className="incident-dialog">
        <header><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="circle-button" aria-label="Close"><X size={18} /></Dialog.Close></header>
        <Dialog.Description>{description}</Dialog.Description>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function ResolveIncident({ incident, access, onResolve }: {
  incident: Incident; access: string; onResolve: (incident: Incident) => void;
}) {
  const [recoverySurveyUrl, setRecoverySurveyUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const errorMessage = useRef<HTMLParagraphElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await postJson<{ incident: Incident }>(
        incidentPath(incident.id, "resolve"), { recoverySurveyUrl }, access,
      );
      onResolve(result.incident);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not resolve the incident.");
      requestAnimationFrame(() => errorMessage.current?.focus());
    } finally { setSaving(false); }
  }
  return <form className="incident-form" onSubmit={submit}>
    {incident.imagery && <label className="incident-recovery-option">
      <input type="checkbox" checked={!!recoverySurveyUrl} disabled={saving}
        onChange={event => setRecoverySurveyUrl(event.target.checked ? incident.imagery?.url ?? null : null)} />
      Keep the latest survey as the repaired map
    </label>}
    <p>{recoverySurveyUrl ? "Confirm that the selected survey shows the repaired area." : "The map will return to its standard imagery in this area."} Standard directions will resume, and field reports will stay in the incident record.</p>
    {error && <p className="incident-error" role="alert" tabIndex={-1} ref={errorMessage}>{error}</p>}
    <button className="world-primary" type="submit" disabled={saving}>
      {saving && <LoaderCircle size={16} className="incident-spinner" aria-hidden />} Resolve incident
    </button>
  </form>;
}

export function RemoveAerial({ incident, access, onRemove }: {
  incident: Incident; access: string; onRemove: (incident: Incident) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await fetchJson<{ incident: Incident }>(incidentPath(incident.id, "imagery"), {
        method: "DELETE", headers: { Authorization: `Bearer ${access}` },
      });
      onRemove(result.incident);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not remove imagery.");
    } finally { setSaving(false); }
  }
  return <form className="incident-form" onSubmit={remove}>
    {error && <p className="incident-error" role="alert">{error}</p>}
    <button className="world-primary" type="submit" disabled={saving}>
      {saving && <LoaderCircle size={16} className="incident-spinner" aria-hidden />} Remove imagery
    </button>
  </form>;
}

type IncidentLocation = { center: Coordinate; label: string };
type MapFocus = { point: Coordinate; zoom?: number };
const noIncidents: Incident[] = [];
const noop = () => {};

function incidentBounds(center: Coordinate, km: number): GeographicBounds | null {
  const dy = km / 2 / 111.32;
  const dx = dy / Math.cos(center.latitude * Math.PI / 180);
  const { latitude, longitude } = center;
  if (Math.abs(latitude) + dy > 85 || Math.abs(longitude) + dx > 180) return null;
  return { west: longitude - dx, south: latitude - dy, east: longitude + dx, north: latitude + dy };
}

export function CreateIncident({ camera, place, onCreate }: {
  camera: { center: Coordinate; zoom: number }; place: Place | null;
  onCreate: (incident: Incident, key: string) => void;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [location, setLocation] = useState<IncidentLocation | null>(place ? { center: place, label: place.name } : null);
  const [view, setView] = useState(camera);
  const [focus, setFocus] = useState<MapFocus>({ point: place ?? camera.center, zoom: place ? 15 : camera.zoom });
  const [km, setKm] = useState("1");
  const [reporter, setReporter] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [token, setToken] = useState("");
  const [askToken, setAskToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bounds = location ? incidentBounds(location.center, Number(km)) : null;
  const preview = location && bounds ? { center: location.center, bounds } : null;
  const hasObservation = !!(note.trim() || photo);
  const searchInput = useRef<HTMLInputElement>(null);

  function chooseLocation(center: Coordinate, label: string, zoom?: number) {
    setLocation({ center, label });
    setResults([]); setLocationError(""); setError("");
    if (zoom) {
      setView({ center, zoom });
      setFocus({ point: center, zoom });
    }
  }
  async function search() {
    if (query.trim().length < 2 || searching) return;
    setSearching(true); setResults([]); setLocationError("");
    try {
      const { places } = await fetchJson<{ places: Place[] }>(`/api/places?q=${encodeURIComponent(query.trim())}`);
      setResults(places);
      if (!places.length) setLocationError("No matches. Try a nearby landmark or drop a pin.");
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Place search is unavailable. Drop a pin on the map.");
    } finally { setSearching(false); }
  }
  function locate() {
    if (!navigator.geolocation) { setLocationError("Location is unavailable. Search for a place or drop a pin."); return; }
    setLocating(true); setLocationError("");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      chooseLocation({ latitude: coords.latitude, longitude: coords.longitude }, "My location", 15);
      setLocating(false);
    }, () => {
      setLocationError("Could not get your location. Search for a place or drop a pin.");
      setLocating(false);
    }, { timeout: 8000, enableHighAccuracy: true });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || preparingPhoto) return;
    if (!bounds) {
      setLocationError(location ? "Choose a smaller area or move the pin farther from the map edge." : "Choose an incident location first.");
      searchInput.current?.focus();
      return;
    }
    setBusy(true); setError("");
    try {
      const observation = hasObservation ? { displayName: reporter, note, photoBase64: photo ?? undefined } : undefined;
      const { incident, key } = await postJson<{ incident: Incident; key: string }>("/api/incidents", { name, bounds, observation }, token);
      onCreate(incident, key);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create the incident.";
      if (message.includes("operator key")) setAskToken(true);
      setError(message);
    } finally { setBusy(false); }
  }

  return <form className="incident-form incident-create" onSubmit={submit}>
    <label>Incident name<input name="incidentName" required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Riverside flood…" /></label>
    <fieldset className="incident-location">
      <legend>Incident location</legend>
      <div className="incident-location-search">
        <input ref={searchInput} name="location" aria-label="Find an address or landmark" placeholder="Search an address or landmark…" value={query}
          maxLength={120} readOnly={searching} onChange={event => { setQuery(event.target.value); setResults([]); setLocationError(""); }}
          onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void search(); } }} />
        <button type="button" className="world-secondary" onClick={search} disabled={query.trim().length < 2 || searching}>
          {searching ? <LoaderCircle size={16} className="incident-spinner" aria-hidden /> : <Search size={16} aria-hidden />} Search
        </button>
      </div>
      {!!results.length && <ul className="incident-location-results" aria-label="Matching places">
        {results.map(item => <li key={item.id}><button className="world-result" type="button" onClick={() => chooseLocation(item, item.name, 15)}>
          <MapPin size={16} aria-hidden /><span><strong>{item.name}</strong><small>{item.detail}</small></span>
        </button></li>)}
        <li className="world-attribution">Search by <a href="https://github.com/komoot/photon" target="_blank" rel="noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></li>
      </ul>}
      <div className="incident-location-map">
        <WorldMap incidents={noIncidents} active={null} focus={focus} route={null} start={null} destination={null}
          selectedRoad={null} aerial={false} picking incidentPreview={preview} onCamera={setView}
          onPoint={point => chooseLocation(point, "Dropped pin", Math.max(view.zoom, 15))} onRoad={noop} onIncident={noop} />
      </div>
      <div className="incident-location-actions">
        <button type="button" className="world-secondary" onClick={() => chooseLocation(view.center, "Dropped pin", Math.max(view.zoom, 15))}>
          <MapPin size={16} aria-hidden /> Pin map center
        </button>
        <button type="button" className="world-secondary" onClick={locate} disabled={locating}>
          {locating ? <LoaderCircle size={16} className="incident-spinner" aria-hidden /> : <Crosshair size={16} aria-hidden />} My location
        </button>
      </div>
      <p className="incident-location-label" aria-live="polite">{location ? <><MapPin size={15} aria-hidden /><strong>{location.label}</strong></> : "Tap the map to drop a pin, or select a search result."}</p>
      <label>Area around the pin<select name="areaWidth" value={km} onChange={event => { setKm(event.target.value); setLocationError(""); }}>
        <option value=".5">500 m across</option><option value="1">1 km across</option><option value="2">2 km across</option><option value="4">4 km across</option>
      </select></label>
      {locationError && <p className="incident-error" role="alert">{locationError}</p>}
    </fieldset>
    <details className="incident-observation">
      <summary>Add a first field report <small>Optional</small></summary>
      <div>
        <label>What happened?<textarea name="observation" rows={2} maxLength={800} value={note} onChange={event => setNote(event.target.value)} placeholder="Describe what you saw…" /></label>
        <EvidencePhoto photo={photo} onChange={setPhoto} onBusy={setPreparingPhoto} />
        {(hasObservation || reporter) && <label>Reporter name<input name="reporter" autoComplete="name" value={reporter} required={hasObservation} maxLength={40} onChange={event => setReporter(event.target.value)} placeholder="Name or team callsign…" /></label>}
        <small className="incident-visibility">The report appears at your pin. Anyone can see the note and reporter name. The photo requires the incident key.</small>
      </div>
    </details>
    {askToken && <label>Workspace operator key<input name="operatorKey" type="password" autoComplete="off" required value={token} onChange={event => setToken(event.target.value)} /></label>}
    {error && <p className="incident-error" role="alert">{error}</p>}
    <button className="world-primary" type="submit" disabled={busy || preparingPhoto}>{busy && <LoaderCircle size={16} className="incident-spinner" aria-hidden />} Create incident</button>
  </form>;
}

export function AccessKey({ current, onSave }: { current: string; onSave: (key: string) => void }) {
  const [key, setKey] = useState(current);
  const [copied, setCopied] = useState(false);
  return <form className="incident-form" onSubmit={event => { event.preventDefault(); onSave(key.trim()); }}>
    <label>Incident access key<input value={key} onChange={event => setKey(event.target.value)} autoComplete="off" required /></label>
    {current && <button className="world-secondary" type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(current); setCopied(true); } catch { setCopied(false); }
    }}><Clipboard size={16} />{copied ? "Copied" : "Copy key"}</button>}
    <button className="world-primary" type="submit">Use key</button>
  </form>;
}

async function photoBytes(file: File): Promise<string> {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read the photo.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .72).split(",")[1];
  } finally { image.close(); }
}

function EvidencePhoto({ photo, onChange, onBusy }: {
  photo: string | null; onChange: (photo: string | null) => void; onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  async function load(file: File | undefined) {
    if (!file) return;
    setBusy(true); onBusy(true); setError("");
    try { onChange(await photoBytes(file)); setName(file.name); }
    catch { setError("Could not read that image. Try a JPEG or PNG."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <div className="incident-photo">
    {photo ? <div className="incident-photo-preview">
      {/* This image is a local JPEG preview, so it needs no remote optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:image/jpeg;base64,${photo}`} alt="Selected evidence photo" width={64} height={56} />
      <span><strong>Evidence photo</strong><small>{name}</small></span>
      <button className="circle-button" type="button" aria-label="Remove photo" onClick={() => { onChange(null); setError(""); }}><X size={16} /></button>
    </div> : <div className="incident-photo-actions">
      <label className="world-secondary"><Images size={16} aria-hidden /> Add photo<input type="file" accept="image/*" disabled={busy} onChange={event => void load(event.target.files?.[0])} /></label>
      <label className="world-secondary incident-camera"><Camera size={16} aria-hidden /> Take photo<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={event => void load(event.target.files?.[0])} /></label>
    </div>}
    {busy && <small role="status">Preparing photo…</small>}
    {error && <p className="incident-error" role="alert">{error}</p>}
  </div>;
}

export function ReportIncident({ incident, road, points, trace, access, suggestedHazard, onReport }: {
  incident: Incident; road: Road | null; points: Coordinate[]; trace: boolean; access: string;
  suggestedHazard?: boolean; onReport: (incident: Incident) => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [condition, setCondition] = useState<"open" | "blocked" | "hazard">(
    trace && road?.state === "blocked" ? "blocked" : suggestedHazard || (trace && road?.state === "hazard") ? "hazard" : "open",
  );
  const [photo, setPhoto] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reportId = useRef<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || preparingPhoto) return;
    setBusy(true); setError("");
    try {
      reportId.current ??= crypto.randomUUID();
      const result = await postJson<{ incident: Incident }>(incidentPath(incident.id, "reports"), {
        id: reportId.current, displayName: name, note,
        edgeId: road?.id, condition: road || points.length >= 2 ? condition : undefined,
        location: points.length === 1 ? points[0] : undefined,
        from: !trace && points.length === 2 ? points[0] : undefined, to: !trace && points.length === 2 ? points[1] : undefined,
        trace: trace ? points : undefined,
        evidenceType: photo ? "image" : note.trim() ? "text" : "manual",
        photoBase64: photo ?? undefined, confirmed: true,
      }, access);
      onReport(result.incident);
    } catch (error) { setError(error instanceof Error ? error.message : "The report could not be sent."); }
    finally { setBusy(false); }
  }

  return <form className="incident-form" onSubmit={submit}>
    <label>Reporter name<input required maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="Name or team callsign…" /></label>
    {(road || points.length >= 2) && <label>Observed condition<select value={condition} onChange={event => setCondition(event.target.value as typeof condition)}>
      <option value="open">Reported open</option><option value="blocked">Blocked</option><option value="hazard">Suspected hazard</option>
    </select></label>}
    <label>What did you observe?<textarea value={note} required={!road && points.length === 1 && !photo} maxLength={800} rows={3} onChange={event => setNote(event.target.value)} placeholder="Add details other responders should know…" /></label>
    <EvidencePhoto photo={photo} onChange={setPhoto} onBusy={setPreparingPhoto} />
    <small className="incident-visibility">Photos are shared with incident members.</small>
    {error && <p className="incident-error" role="alert">{error}</p>}
    <button className="world-primary" type="submit" disabled={busy || preparingPhoto}>{busy && <LoaderCircle size={16} className="incident-spinner" aria-hidden />} Confirm field report</button>
  </form>;
}

type Job = { id: string; status: "queued" | "processing" | "complete" | "failed"; progress?: number; error?: string };
export function SurveyUpload({ incident, access, onUpload }: {
  incident: Incident; access: string; onUpload: (incident: Incident) => void;
}) {
  const [mode, setMode] = useState<"tiff" | "raw">("tiff");
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const callback = useRef(onUpload);
  const storageKey = `aftermap.job.${incident.id}`;

  useEffect(() => { callback.current = onUpload; }, [onUpload]);
  useEffect(() => {
    const id = localStorage.getItem(storageKey);
    if (id) { setMode("raw"); setJob({ id, status: "queued" }); return; }
    let cancelled = false;
    void fetchJson<{ job: { id: string } | null }>(incidentPath(incident.id, "imagery/raw"), {
      headers: { Authorization: `Bearer ${access}` },
    }).then(({ job }) => {
      if (!cancelled && job) { setMode("raw"); setJob({ id: job.id, status: "queued" }); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [storageKey, incident.id, access]);
  useEffect(() => {
    if (!job || job.status === "complete" || job.status === "failed") return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await fetchJson<Job>(incidentPath(incident.id, `imagery/raw/${job.id}`), { headers: { Authorization: `Bearer ${access}` } });
        if (cancelled) return;
        setJob(next);
        if (next.status === "failed" || next.status === "complete") localStorage.removeItem(storageKey);
        if (next.status === "failed") setError(next.error || "The photos could not be aligned.");
        if (next.status === "complete") callback.current(await fetchJson<Incident>(incidentPath(incident.id)));
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Could not check the drone job.");
          setJob({ ...job, status: "failed" });
          localStorage.removeItem(storageKey);
        }
      }
    }, 2200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job, incident.id, access, storageKey]);

  async function upload(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const form = new FormData();
      files.forEach(file => form.append("files", file));
      const init = { method: "POST", body: form, headers: { Authorization: `Bearer ${access}` } };
      if (mode === "raw") {
        const next = await fetchJson<Job>(incidentPath(incident.id, "imagery/raw"), init);
        localStorage.setItem(storageKey, next.id); setJob(next);
      } else {
        const result = await fetchJson<{ incident: Incident }>(incidentPath(incident.id, "imagery"), init);
        onUpload(result.incident);
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Could not import the survey."); }
    finally { setBusy(false); }
  }
  const processing = job?.status === "queued" || job?.status === "processing";
  return <form className="incident-form" onSubmit={upload}>
    <div className="world-segments" aria-label="Imagery format">
      <button type="button" aria-pressed={mode === "tiff"} disabled={busy || processing} onClick={() => { setMode("tiff"); setFiles([]); }}>GeoTIFF</button>
      <button type="button" aria-pressed={mode === "raw"} disabled={busy || processing} onClick={() => { setMode("raw"); setFiles([]); }}>Drone photos</button>
    </div>
    <label className="world-upload" key={mode}><Images size={24} />
      <strong>{files.length ? `${files.length} selected` : "Choose survey files…"}</strong>
      <small>{mode === "tiff" ? "1 to 8 georeferenced TIFFs" : "5 to 40 overlapping geotagged photos"} · 72 MB total</small>
      <input type="file" multiple disabled={busy || processing} accept={mode === "tiff" ? ".tif,.tiff" : ".jpg,.jpeg,.png"}
        onChange={event => setFiles(Array.from(event.target.files ?? []))} />
    </label>
    {processing && <p role="status">Processing aerial survey{job.progress === undefined ? "…" : ` · ${Math.round(job.progress)}%`}</p>}
    {error && <p className="incident-error" role="alert">{error}</p>}
    <button className="world-primary" type="submit" disabled={!files.length || busy || processing}>{busy ? "Uploading…" : "Upload survey"}</button>
  </form>;
}
