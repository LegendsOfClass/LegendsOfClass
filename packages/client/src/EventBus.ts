/** Tiny event bus bridging Phaser scenes <-> React UI (Rule 4: rendering never calls networking directly). */
type Handler = (payload?: any) => void;
const handlers: Record<string, Handler[]> = {};
export const EventBus = {
  on(ev: string, h: Handler) { (handlers[ev] ??= []).push(h); return () => EventBus.off(ev, h); },
  off(ev: string, h: Handler) { handlers[ev] = (handlers[ev] ?? []).filter(x => x !== h); },
  emit(ev: string, payload?: any) { (handlers[ev] ?? []).forEach(h => h(payload)); }
};
