"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Check, Mic, QrCode, Send, Sparkles } from "lucide-react";
import jsQR from "jsqr";
import { send } from "@/lib/client";
import { checkpointFromQR } from "@/lib/qr";
import { type EvidenceType, type PassageStatus, type Report, type Snapshot, type Suggestion } from "@/lib/world";

type Result = { state: Snapshot };
type Reporter = { observerId: string; displayName: string };
type Speech = {
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void;
};

async function compressPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
    canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not read the photo.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .72).split(",")[1];
  } finally { bitmap.close(); }
}

function Scanner({ accept, close, fail }: { accept: (value: string) => void; close: () => void; fail: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ accept, fail });
  useEffect(() => { callbacks.current = { accept, fail }; }, [accept, fail]);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0, stopped = false;
    const canvas = document.createElement("canvas");
    canvas.width = 480; canvas.height = 360;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    async function start() {
      try {
        if (!navigator.mediaDevices) throw new Error("Camera access needs HTTPS. Enter the checkpoint ID manually.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        const video = videoRef.current;
        if (!video || !context) throw new Error("Camera could not start.");
        video.srcObject = stream;
        await video.play();
        const scan = () => {
          if (stopped) return;
          if (video.readyState >= 2) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const data = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(data.data, data.width, data.height, { inversionAttempts: "dontInvert" });
            if (code) { callbacks.current.accept(code.data); return; }
          }
          frame = requestAnimationFrame(scan);
        };
        scan();
      } catch (error) { if (!stopped) callbacks.current.fail(error instanceof Error ? error.message : "Camera unavailable."); }
    }
    void start();
    return () => { stopped = true; cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); };
  }, []);
  return <div className="scan-preview"><video ref={videoRef} muted playsInline /><button type="button" className="quiet-btn" onClick={close}>Close camera</button></div>;
}

export default function ReportPanel({ world, onState }: { world: Snapshot; onState: (state: Snapshot) => void }) {
  const code = world.session.code;
  const [identity, setIdentity] = useState<Reporter | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState(code);
  const [checkpoint, setCheckpoint] = useState("");
  const [checkpointText, setCheckpointText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [kind, setKind] = useState<Report["kind"]>("passage");
  const [status, setStatus] = useState<PassageStatus>("open");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState<EvidenceType>("manual");
  const [photo, setPhoto] = useState<File | null>(null);
  const [confidence, setConfidence] = useState<number>();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const speechRef = useRef<Speech | null>(null);
  const pending = useRef<{ signature: string; id: string } | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(`aftermap:${code}`);
      if (!stored) return;
      const remembered = JSON.parse(stored) as Reporter;
      const participant = world.participants.find(item => item.id === remembered.observerId);
      if (participant) {
        setIdentity(remembered); setDisplayName(remembered.displayName);
        setCheckpoint(participant.checkpointId ?? "");
      }
    } catch { /* Session storage is optional. */ }
    return () => { speechRef.current?.stop(); };
    // Restore once when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label); setError(""); setMessage("");
    try { await work(); }
    catch (error) { setError(error instanceof Error ? error.message : "That action could not be completed."); }
    finally { setBusy(""); }
  }
  function join(event: FormEvent) {
    event.preventDefault();
    void run("Joining…", async () => {
      const enteredCode = joinCode.trim().toUpperCase();
      if (enteredCode !== code) throw new Error("That drill code is not active.");
      const result = await send<Result & { observerId: string }>(code, "join", { displayName });
      const reporter = { observerId: result.observerId, displayName: displayName.trim() };
      setIdentity(reporter); onState(result.state);
      try { sessionStorage.setItem(`aftermap:${code}`, JSON.stringify(reporter)); } catch { /* Optional. */ }
    });
  }
  function chooseCheckpoint(value: string) {
    if (!identity) return;
    setScanning(false);
    void run("Locating…", async () => {
      const id = checkpointFromQR(value, code, world.nodes.map(node => node.id));
      if (!id) throw new Error("That checkpoint does not belong to this drill.");
      const result = await send<Result>(code, "position", { observerId: identity.observerId, checkpointId: id });
      setCheckpoint(id); setTarget(""); setCheckpointText(""); setConfidence(undefined);
      setMessage(`Located at ${world.nodes.find(node => node.id === id)?.label}.`);
      onState(result.state);
    });
  }
  function dictate() {
    const speechWindow = window as Window & { SpeechRecognition?: new () => Speech; webkitSpeechRecognition?: new () => Speech };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) { setError("Dictation is unavailable in this browser. Type the report or use the iPhone app."); return; }
    if (listening) { speechRef.current?.stop(); return; }
    setError("");
    const speech = new Recognition();
    speechRef.current = speech;
    speech.onresult = event => {
      setNote(event.results[0][0].transcript.slice(0, 400));
      setEvidence("voice"); setConfidence(undefined);
    };
    speech.onerror = () => { setError("Dictation was unavailable. You can type the report."); setListening(false); };
    speech.onend = () => { speechRef.current = null; setListening(false); };
    try { speech.start(); setListening(true); }
    catch { setError("Dictation could not start."); }
  }
  function suggest() {
    if (!identity || !checkpoint) return;
    void run("Checking evidence…", async () => {
      const evidenceType = photo ? "image" : evidence === "voice" ? "voice" : "text";
      const imageBase64 = photo ? await compressPhoto(photo) : undefined;
      const result = await send<{ suggestion: Suggestion | null; message?: string }>(code, "interpret", {
        observerId: identity.observerId, checkpointId: checkpoint, note: note.trim(), evidenceType,
        imageBase64, imageMimeType: imageBase64 ? "image/jpeg" : undefined,
      });
      setMessage(result.message ?? "Review the suggested fields before submitting.");
      if (!result.suggestion) { setConfidence(undefined); return; }
      const guess = result.suggestion;
      setKind(guess.kind);
      setTarget(guess.kind === "passage" ? (guess.from === checkpoint ? guess.to : guess.from) ?? "" : guess.nodeId ?? "");
      if (guess.status) setStatus(guess.status);
      setNote(guess.note ?? note); setConfidence(guess.confidence); setEvidence(evidenceType);
    });
  }
  function confirm(event: FormEvent) {
    event.preventDefault();
    if (!identity || !checkpoint) return;
    void run("Sending…", async () => {
      if (!target) throw new Error("Choose the checkpoint your report refers to.");
      const fields = {
        observerId: identity.observerId, checkpointId: checkpoint, kind,
        from: kind === "passage" ? checkpoint : undefined,
        to: kind === "passage" ? target : undefined,
        status: kind === "passage" ? status : undefined,
        nodeId: kind === "passage" ? undefined : target,
        evidenceType: photo ? "image" as const : evidence, confidence,
        note: note.trim() || undefined, confirmed: true as const,
      };
      const signature = JSON.stringify(fields);
      if (!pending.current || pending.current.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
      const result = await send<Result>(code, "observations", { ...fields, id: pending.current.id });
      pending.current = null;
      onState(result.state);
      setMessage("Report confirmed and shared.");
      setNote(""); setPhoto(null); setTarget(""); setConfidence(undefined); setEvidence("manual");
    });
  }
  const location = world.nodes.find(node => node.id === checkpoint);
  const targets = world.nodes.filter(node => kind === "passage" ? node.id !== checkpoint : kind === "exit" ? node.kind === "exit" : true);

  if (!identity) return <form className="dialog-form" onSubmit={join}>
    <p>Join the shared field map using the drill code. Use a nickname for the exercise.</p>
    <label>Drill code<input value={joinCode} onChange={event => setJoinCode(event.target.value)} autoCapitalize="characters" maxLength={20} required /></label>
    <label>Display name<input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={32} required placeholder="Reporter A…" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="primary-btn" disabled={!!busy}>{busy || "Join drill"}</button>
  </form>;

  return <div className="dialog-form">
    <div className="reporter-line"><span className="avatar">{identity.displayName[0].toUpperCase()}</span><div><strong>{identity.displayName}</strong><small>{location?.label ?? "Select a checkpoint"}</small></div>
      {location && <span className="located"><Check size={14} /> Located</span>}</div>
    <form className="checkpoint-input" onSubmit={event => { event.preventDefault(); chooseCheckpoint(checkpointText); }}>
      <label className="sr-only" htmlFor="checkpoint">Checkpoint code</label>
      <input id="checkpoint" placeholder="Checkpoint ID…" value={checkpointText} onChange={event => setCheckpointText(event.target.value)} />
      <button type="submit" className="quiet-btn" disabled={!!busy || !checkpointText.trim()}>Set</button>
      <button type="button" className="icon-button" aria-label="Scan checkpoint QR" onClick={() => setScanning(true)} disabled={!!busy}><QrCode size={18} /></button>
    </form>
    {scanning && <Scanner accept={chooseCheckpoint} close={() => setScanning(false)} fail={message => { setScanning(false); setError(message); }} />}
    {location && <form className="dialog-form report-form" onSubmit={confirm}>
      <label>Report type<select aria-label="Report type" value={kind} onChange={event => { setKind(event.target.value as Report["kind"]); setTarget(""); setConfidence(undefined); }}>
        <option value="passage">Passage condition</option><option value="exit">Assembly point</option><option value="help">Person needs assistance</option>
      </select></label>
      <label>{kind === "passage" ? "Other checkpoint" : "Reported location"}<select aria-label={kind === "passage" ? "Other checkpoint" : "Reported location"} value={target} onChange={event => { setTarget(event.target.value); setConfidence(undefined); }}>
        <option value="">Choose a checkpoint</option>{targets.map(node => <option key={node.id} value={node.id}>{node.label} · {node.id}</option>)}
      </select></label>
      {kind === "passage" && <label>Condition<select aria-label="Condition" value={status} onChange={event => { setStatus(event.target.value as PassageStatus); setConfidence(undefined); }}>
        <option value="open">Open</option><option value="blocked">Blocked</option><option value="hazard">Suspected hazard</option>
      </select></label>}
      <label>Observation<textarea value={note} onChange={event => { setNote(event.target.value); setEvidence(event.target.value ? "text" : "manual"); setConfidence(undefined); }} maxLength={400} rows={2} placeholder="Harbor Road is blocked by rubble…" /></label>
      <div className="evidence-actions">
        <label className="quiet-btn photo-button"><Camera size={16} /> {photo ? "Replace photo" : "Photo"}<input type="file" accept="image/*" capture="environment" onChange={event => { setPhoto(event.target.files?.[0] ?? null); setConfidence(undefined); }} /></label>
        <button className="quiet-btn" type="button" onClick={dictate}><Mic size={16} /> {listening ? "Stop" : "Dictate"}</button>
        <button className="quiet-btn" type="button" onClick={suggest} disabled={!!busy || (!note.trim() && !photo)}><Sparkles size={16} /> Interpret</button>
      </div>
      {photo && <small className="muted">{photo.name} <button type="button" className="text-btn" onClick={() => { setPhoto(null); setConfidence(undefined); if (evidence === "image") setEvidence(note ? "text" : "manual"); }}>Remove</button></small>}
      {confidence !== undefined && <small className="muted">Suggestion confidence {Math.round(confidence * 100)}%. Check the fields before sharing.</small>}
      <button type="submit" className="primary-btn" disabled={!!busy}><Send size={17} />{busy || "Confirm and share"}</button>
    </form>}
    {message && <p className="form-status" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
