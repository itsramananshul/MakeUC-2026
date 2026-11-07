"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Clipboard, Images, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Coordinate, GeographicBounds, Incident, Road } from "@/lib/incident-types";
import { fetchJson, incidentPath, postJson } from "@/lib/world-client";

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

export function CreateIncident({ center, onCreate }: { center: Coordinate; onCreate: (incident: Incident, key: string) => void }) {
  const [name, setName] = useState("");
  const [lat, setLat] = useState(center.latitude.toFixed(5));
  const [lng, setLng] = useState(center.longitude.toFixed(5));
  const [km, setKm] = useState("1");
  const [token, setToken] = useState("");
  const [askToken, setAskToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const latitude = Number(lat), longitude = Number(lng);
      if (!lat.trim() || !lng.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          Math.abs(latitude) > 84.9 || Math.abs(longitude) > 179.9) throw new Error("Enter a valid incident center.");
      const dy = Number(km) / 2 / 111.32;
      const dx = dy / Math.cos(latitude * Math.PI / 180);
      const bounds: GeographicBounds = { west: longitude - dx, south: latitude - dy, east: longitude + dx, north: latitude + dy };
      const { incident, key } = await postJson<{ incident: Incident; key: string }>("/api/incidents", { name, bounds }, token);
      onCreate(incident, key);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create the incident.";
      if (message.includes("operator key")) setAskToken(true);
      setError(message);
    } finally { setBusy(false); }
  }

  return <form className="incident-form" onSubmit={submit}>
    <label>Incident name<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Name this incident…" /></label>
    <div className="form-columns">
      <label>Center latitude<input required value={lat} onChange={event => setLat(event.target.value)} inputMode="decimal" /></label>
      <label>Center longitude<input required value={lng} onChange={event => setLng(event.target.value)} inputMode="decimal" /></label>
    </div>
    <label>Area width<select value={km} onChange={event => setKm(event.target.value)}>
      <option value=".5">500 m</option><option value="1">1 km</option><option value="2">2 km</option><option value="4">4 km</option>
    </select></label>
    {askToken && <label>Workspace operator key<input type="password" required value={token} onChange={event => setToken(event.target.value)} /></label>}
    {error && <p className="incident-error" role="alert">{error}</p>}
    <button className="world-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create incident"}</button>
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

export function ReportIncident({ incident, road, points, access, onReport }: {
  incident: Incident; road: Road | null; points: Coordinate[]; access: string; onReport: (incident: Incident) => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [condition, setCondition] = useState<"open" | "blocked" | "hazard">("open");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reportId = useRef<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      reportId.current ??= crypto.randomUUID();
      const result = await postJson<{ incident: Incident }>(incidentPath(incident.id, "reports"), {
        id: reportId.current, displayName: name, note,
        edgeId: road?.id, condition: road || points.length === 2 ? condition : undefined,
        location: points.length === 1 ? points[0] : undefined,
        from: points.length === 2 ? points[0] : undefined, to: points.length === 2 ? points[1] : undefined,
        evidenceType: photo ? "image" : note.trim() ? "text" : "manual",
        photoBase64: photo ? await photoBytes(photo) : undefined, confirmed: true,
      }, access);
      onReport(result.incident);
    } catch (error) { setError(error instanceof Error ? error.message : "The report could not be sent."); }
    finally { setBusy(false); }
  }

  return <form className="incident-form" onSubmit={submit}>
    <label>Reporter name<input required maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="Name or team callsign…" /></label>
    {(road || points.length === 2) && <label>Observed condition<select value={condition} onChange={event => setCondition(event.target.value as typeof condition)}>
      <option value="open">Reported open</option><option value="blocked">Blocked</option><option value="hazard">Suspected hazard</option>
    </select></label>}
    <label>What did you observe?<textarea value={note} required={!road && points.length === 1} maxLength={800} rows={3} onChange={event => setNote(event.target.value)} placeholder="Add details other responders should know…" /></label>
    <label>Evidence photo <small>Optional · shared with incident members</small><input type="file" accept="image/*" onChange={event => setPhoto(event.target.files?.[0] ?? null)} /></label>
    {error && <p className="incident-error" role="alert">{error}</p>}
    <button className="world-primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Confirm field report"}</button>
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
