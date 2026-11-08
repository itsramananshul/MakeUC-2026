import { subscribeToIncidentUpdates } from "@/lib/incident-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const encoder = new TextEncoder();
  let dispose: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const unsubscribe = subscribeToIncidentUpdates(id => send(`data: ${JSON.stringify({ id })}\n\n`));
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), 15_000);
      const expires = setTimeout(() => close(), 55_000);
      function close() {
        if (closed) return;
        dispose();
        controller.close();
      }
      dispose = () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        clearTimeout(expires);
        request.signal.removeEventListener("abort", close);
      };
      request.signal.addEventListener("abort", close, { once: true });
      send("retry: 1000\ndata: {}\n\n");
      if (request.signal.aborted) close();
    },
    cancel() { dispose?.(); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
