"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpToLine, Images } from "lucide-react";
import { api, sessionUrl } from "@/lib/client";
import type { Snapshot } from "@/lib/world";

type Job = { id: string; status: "queued" | "processing" | "complete" | "failed"; progress?: number; error?: string };

export default function ImportImagery({ code, onImport }: { code: string; onImport: (world?: Snapshot) => void }) {
  const [mode, setMode] = useState<"tiff" | "raw">("tiff");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [token, setToken] = useState("");
  const [requireToken, setRequireToken] = useState(false);
  const callback = useRef(onImport);
  useEffect(() => { callback.current = onImport; }, [onImport]);

  useEffect(() => {
    if (!job || job.status === "complete" || job.status === "failed") return;
    const timer = window.setTimeout(async () => {
      try {
        const result = await api<Job>(sessionUrl(code, `imagery/raw/${job.id}`));
        setJob(result);
        if (result.status === "complete") callback.current();
        if (result.status === "failed") setError(result.error ?? "The worker could not stitch these photos.");
      } catch (error) { setError(error instanceof Error ? error.message : "Could not check the drone job."); setJob({ ...job, status: "failed" }); }
    }, 2500);
    return () => clearTimeout(timer);
  }, [code, job]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setJob(null);
    try {
      const form = new FormData();
      files.forEach(file => form.append("files", file));
      const response = await fetch(sessionUrl(code, mode === "tiff" ? "imagery" : "imagery/raw"), {
        method: "POST", headers: token ? { "x-aftermap-imagery-token": token } : {}, body: form,
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 403) setRequireToken(true);
        throw new Error(result.error || "The upload could not be processed.");
      }
      if (mode === "tiff") onImport(result.state as Snapshot);
      else setJob(result as Job);
    } catch (error) { setError(error instanceof Error ? error.message : "The upload could not be processed."); }
    finally { setBusy(false); }
  }
  const processing = job?.status === "queued" || job?.status === "processing";
  return <form className="dialog-form" onSubmit={upload}>
    <div className="segments" aria-label="Import format">
      <button type="button" aria-pressed={mode === "tiff"} disabled={!!processing || busy} onClick={() => { setMode("tiff"); setFiles([]); setError(""); }}>GeoTIFF mosaic</button>
      <button type="button" aria-pressed={mode === "raw"} disabled={!!processing || busy} onClick={() => { setMode("raw"); setFiles([]); setError(""); }}>Drone photos</button>
    </div>
    <p>{mode === "tiff" ? "Import one or more georeferenced images. AFTERMAP aligns them by location and creates a shared aerial layer." : "Select overlapping, geotagged aerial photographs. The drone worker stitches them into a map and returns a georeferenced image."}</p>
    <label className="upload-well" key={mode}>
      <Images size={22} /><strong>{files.length ? `${files.length} ${files.length === 1 ? "file" : "files"} selected` : "Choose imagery…"}</strong>
      <span>{mode === "tiff" ? "1–8 GeoTIFFs" : "5–40 JPEG or PNG images"} · 72 MB total</span>
      <input type="file" multiple accept={mode === "tiff" ? ".tif,.tiff" : "image/jpeg,image/png"} onChange={event => setFiles(Array.from(event.target.files ?? []))} disabled={!!processing || busy} />
    </label>
    {requireToken && <label>Operator upload code<input value={token} onChange={event => setToken(event.target.value)} type="password" required /></label>}
    {processing && <p className="form-status" role="status">{job.status === "queued" ? "Queued for processing…" : `Stitching photos · ${Math.round(job.progress ?? 0)}%`}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="primary-btn" disabled={busy || !!processing || !files.length}><ArrowUpToLine size={17} />{busy ? "Uploading…" : "Import imagery"}</button>
  </form>;
}
