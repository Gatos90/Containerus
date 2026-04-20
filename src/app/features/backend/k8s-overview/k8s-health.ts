import { ChipStatus } from '../../../shared/components/a11y';
import { K8sPod } from '../../../core/models/backend.model';

/**
 * CON-131 §2 — health roll-up helpers shared across cluster / namespace /
 * workload triage cards. Rolling this up in one place keeps the status
 * mapping testable without pulling in the Angular component graph, and
 * guarantees every drill-level uses the same `ChipStatus` taxonomy from
 * CON-123 (`healthy | degraded | failing | unknown`).
 */

export interface PodPhaseCounts {
  readonly total: number;
  readonly running: number;
  readonly succeeded: number;
  readonly pending: number;
  readonly failed: number;
  readonly unknown: number;
}

const RUNNING_PHASES = new Set(['Running']);
const SUCCEEDED_PHASES = new Set(['Succeeded']);
const PENDING_PHASES = new Set(['Pending']);
const FAILED_PHASES = new Set(['Failed', 'CrashLoopBackOff', 'Error']);

/**
 * Count pods per phase. We treat anything that isn't Running/Succeeded/
 * Pending/Failed as `unknown` rather than folding it into an existing
 * bucket; the triage card will render the unknown count separately so
 * operators don't silently mistake a new k8s phase for "healthy".
 */
export function countPodPhases(pods: ReadonlyArray<K8sPod>): PodPhaseCounts {
  const counts = { total: 0, running: 0, succeeded: 0, pending: 0, failed: 0, unknown: 0 };
  for (const pod of pods) {
    counts.total++;
    const phase = pod.status;
    if (RUNNING_PHASES.has(phase)) counts.running++;
    else if (SUCCEEDED_PHASES.has(phase)) counts.succeeded++;
    else if (PENDING_PHASES.has(phase)) counts.pending++;
    else if (FAILED_PHASES.has(phase)) counts.failed++;
    else counts.unknown++;
  }
  return counts;
}

/**
 * Roll pod counts up to a single chip status. Any failing pod → failing;
 * any pending → degraded; all running/succeeded → healthy; empty → unknown.
 *
 * We explicitly do NOT emit `healthy` for a zero-pod workload — empty
 * workloads are reported as `unknown` so readiness regressions (HPA scaled
 * to zero, or selector-mismatch) surface in the triage row instead of
 * disappearing behind a green chip.
 */
export function rollUpPodStatus(counts: PodPhaseCounts): ChipStatus {
  if (counts.total === 0) return 'unknown';
  if (counts.failed > 0) return 'failing';
  if (counts.pending > 0 || counts.unknown > 0) return 'degraded';
  return 'healthy';
}

/** Convenience: ready-count string (`k/total`) for the triage card. */
export function podReadyRatio(counts: PodPhaseCounts): string {
  const ready = counts.running + counts.succeeded;
  return `${ready}/${counts.total}`;
}

/**
 * Deployment-like readiness: the raw `ready` field is already formatted
 * `"a/b"` server-side; we parse defensively because custom workload types
 * may omit `.status.readyReplicas`.
 */
export function rollUpWorkloadReadiness(ready: string | null | undefined): ChipStatus {
  if (!ready) return 'unknown';
  const match = /^(\d+)\/(\d+)$/.exec(ready);
  if (!match) return 'unknown';
  const got = Number(match[1]);
  const want = Number(match[2]);
  if (want === 0) return 'unknown';
  if (got === 0) return 'failing';
  if (got < want) return 'degraded';
  return 'healthy';
}

export type NodeReadyState = 'Ready' | 'NotReady' | 'Unknown';

export function rollUpNodeStatus(states: ReadonlyArray<NodeReadyState>): ChipStatus {
  if (states.length === 0) return 'unknown';
  const notReady = states.filter((s) => s === 'NotReady').length;
  const unknown = states.filter((s) => s === 'Unknown').length;
  if (notReady > 0) return 'failing';
  if (unknown > 0) return 'degraded';
  return 'healthy';
}
