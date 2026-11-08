"use client";

import { Images, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import hashes from "@/lib/catia-image-hashes.json";
import type { Incident } from "@/lib/incident-types";

type ImportResult =
  | { status: "queued" | "processing"; id: string; progress?: number }
  | { status: "failed"; error?: string }
  | { status: "complete"; incident: Incident; key: string };
const endpoint = "/api/imagery/import";
const city = "/venezuela/catia-la-mar";
const pendingImport = "gaslight-aerial-import";
const catalogHashes: Record<string, string> = hashes;

async function identifyFiles(files: File[]) {
  const found = new Set<string>();
  let matched = 0;
  for (const file of files) {
    if (file.size > 16_000_000 || /\.tiff?$/i.test(file.name)) continue;
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const tile = catalogHashes[hex];
    if (tile) { found.add(tile); matched++; }
  }
  return { matched, tiles: [...found] };
}

async function importRequest(path: string, body?: FormData, key?: string) {
  const response = await fetch(path, { method: "POST", body, headers: key ? { Authorization: `Bearer ${key}` } : {} });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error ??
    (response.status === 413 ? "The upload exceeded the server’s size limit." : "The aerial imagery could not be uploaded.")), { status: response.status });
  return result as ImportResult;
}

export default function PhotoOnlyUpload({ onImport }: { onImport: (incident: Incident, key: string) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<string | null>(() => typeof window === "undefined" ? null : sessionStorage.getItem(pendingImport));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [requireKey, setRequireKey] = useState(false);

  const callback = useRef(onImport);
  useEffect(() => { callback.current = onImport; }, [onImport]);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    let timer: number;
    async function poll() {
      try {
        const result = await importRequest(`${endpoint}/${job}`);
        if (cancelled) return;
        if (result.status === "queued" || result.status === "processing") {
          setStatus(result.status === "queued" ? "Waiting for the stitching worker…" : `Stitching images · ${Math.round(result.progress ?? 0)}%`);
          timer = window.setTimeout(poll, 3000);
          return;
        }
        sessionStorage.removeItem(pendingImport);
        setJob(null);
        if (result.status === "complete") callback.current(result.incident, result.key);
        else if (result.status === "failed") setError(result.error || "The worker could not stitch these photos.");
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Could not check the import.");
          setJob(null);
        }
      }
    }
    timer = window.setTimeout(poll, 1500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [job]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setStatus("Checking image locations…");
    try {
      if (files.length > 100) throw new Error("Choose up to 100 prepared images at a time.");
      const { matched, tiles } = await identifyFiles(files);
      if (matched === files.length) {
        window.location.assign(`${city}?tiles=${encodeURIComponent(tiles.join(","))}`);
        return;
      }
      if (matched) throw new Error("Some files are from the prepared Catia La Mar set. Select those separately from other imagery.");
      if (files.reduce((total, file) => total + file.size, 0) > 72_000_000) throw new Error("Choose up to 72 MB of imagery.");
      const form = new FormData();
      files.forEach(file => form.append("files", file));
      setStatus(`Uploading ${files.length} ${files.length === 1 ? "image" : "images"}…`);
      const result = await importRequest(endpoint, form, key);
      if (result.status === "complete") onImport(result.incident, result.key);
      if (result.status === "queued" || result.status === "processing") {
        sessionStorage.setItem(pendingImport, result.id);
        setStatus("Waiting for the stitching worker…");
        setJob(result.id);
      }
    } catch (error) {
      if ((error as { status?: number })?.status === 403) setRequireKey(true);
      setError(error instanceof Error ? error.message : "The aerial imagery could not be uploaded.");
    } finally { setBusy(false); }
  }
  const locked = busy || !!job;
  return <form className="dialog-form incident-form" onSubmit={upload}>
    <p>Select the whole set. Gaslight Maps uses the files’ location data to align them and place them on the map.</p>
    <label className="upload-well">
      <Images size={22} aria-hidden />
      <strong>{files.length ? `${files.length} ${files.length === 1 ? "image" : "images"} selected` : "Choose aerial images"}</strong>
      <span>Prepared Catia La Mar images, GeoTIFFs, or overlapping GPS-tagged drone photos</span>
      <input type="file" multiple accept="image/jpeg,image/png,image/webp,.tif,.tiff" disabled={locked}
        onChange={event => { setFiles(Array.from(event.target.files ?? [])); setError(""); }} />
    </label>
    {requireKey && <label>Workspace operator key<input type="password" required value={key} onChange={event => setKey(event.target.value)} /></label>}
    {locked && <p className="form-status" role="status">{status}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="world-primary" disabled={locked || !files.length}>
      {locked && <LoaderCircle size={16} className="incident-spinner" aria-hidden />}{locked ? "Processing images…" : "Place images on map"}
    </button>
  </form>;
}
