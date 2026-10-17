// A pending selection survives page remounts, without persisting an execution request.
let requestedRecipe: string | null = null;
export function requestProductionRecipe(recipeId: string): void { requestedRecipe = recipeId; }
export function takeRequestedProductionRecipe(): string | null {
  const recipeId = requestedRecipe; requestedRecipe = null; return recipeId;
}

// The run an AI request acts on: taken when the production page mounts, or delivered to it while open.
let requestedRun: string | null = null;
const runListeners = new Set<(runId: string) => void>();
export function requestProductionRun(runId: string): void {
  requestedRun = runId;
  for (const listener of runListeners) listener(runId);
}
export function takeRequestedProductionRun(): string | null {
  const runId = requestedRun; requestedRun = null; return runId;
}
export function onProductionRunRequested(listener: (runId: string) => void): () => void {
  runListeners.add(listener); return () => { runListeners.delete(listener); };
}
