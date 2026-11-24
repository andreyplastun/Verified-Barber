/** Process-local hint; periodic DB probing still handles other processes/restarts. */
let generation = 0;
const listeners = new Set<() => void>();
export function wakeQueue() {
  generation++;
  for (const wake of listeners) wake();
}
export function queueGeneration() { return generation; }
export function waitForQueue(ms: number, observed: number): Promise<void> {
  if (generation !== observed) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); listeners.delete(finish); resolve(); };
    const timer = setTimeout(finish, Math.min(Math.max(ms, 1), 600000));
    listeners.add(finish);
    if (generation !== observed) finish();
  });
}
