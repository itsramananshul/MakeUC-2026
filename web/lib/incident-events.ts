type Listener = (id: string) => void;
const processState = globalThis as typeof globalThis & { gaslightIncidentListeners?: Set<Listener> };
const listeners = processState.gaslightIncidentListeners ??= new Set();

export function subscribeToIncidentUpdates(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishIncidentUpdate(id: string) {
  for (const listener of listeners) listener(id);
}
