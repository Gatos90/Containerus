import { describe, it, expect } from 'vitest';
import { K8sPod } from '../../../core/models/backend.model';
import {
  countPodPhases,
  podReadyRatio,
  rollUpNodeStatus,
  rollUpPodStatus,
  rollUpWorkloadReadiness,
} from './k8s-health';

function pod(partial: Partial<K8sPod> & { status: string }): K8sPod {
  return {
    name: partial.name ?? 'p',
    namespace: partial.namespace ?? 'default',
    status: partial.status,
    ready: partial.ready ?? '1/1',
    restarts: partial.restarts ?? 0,
    age: partial.age ?? '1m',
    node: partial.node ?? null,
    ip: partial.ip ?? null,
    labels: partial.labels ?? {},
    creationTimestamp: partial.creationTimestamp ?? null,
    containerNames: partial.containerNames ?? [],
  };
}

describe('k8s-health helpers', () => {
  describe('countPodPhases', () => {
    it('buckets each k8s phase correctly', () => {
      const pods = [
        pod({ status: 'Running' }),
        pod({ status: 'Running' }),
        pod({ status: 'Succeeded' }),
        pod({ status: 'Pending' }),
        pod({ status: 'Failed' }),
        pod({ status: 'CrashLoopBackOff' }),
        pod({ status: 'SomeNewPhase' }),
      ];
      expect(countPodPhases(pods)).toEqual({
        total: 7,
        running: 2,
        succeeded: 1,
        pending: 1,
        failed: 2,
        unknown: 1,
      });
    });

    it('returns zeros for an empty cluster', () => {
      expect(countPodPhases([])).toEqual({
        total: 0,
        running: 0,
        succeeded: 0,
        pending: 0,
        failed: 0,
        unknown: 0,
      });
    });
  });

  describe('rollUpPodStatus', () => {
    it('is unknown when there are no pods (empty workload warning signal)', () => {
      // Zero-pod workloads deliberately do NOT roll up to healthy — a
      // workload scaled to zero or a selector mismatch should not hide
      // behind a green chip. Regression test for the §2 health contract.
      expect(rollUpPodStatus(countPodPhases([]))).toBe('unknown');
    });

    it('is failing when any pod is failed', () => {
      expect(rollUpPodStatus(countPodPhases([
        pod({ status: 'Running' }),
        pod({ status: 'Failed' }),
      ]))).toBe('failing');
    });

    it('is degraded for pending or unknown phases', () => {
      expect(rollUpPodStatus(countPodPhases([
        pod({ status: 'Pending' }),
      ]))).toBe('degraded');
      expect(rollUpPodStatus(countPodPhases([
        pod({ status: 'Running' }),
        pod({ status: 'MysteryPhase' }),
      ]))).toBe('degraded');
    });

    it('is healthy when every pod is running or succeeded', () => {
      expect(rollUpPodStatus(countPodPhases([
        pod({ status: 'Running' }),
        pod({ status: 'Succeeded' }),
      ]))).toBe('healthy');
    });
  });

  describe('podReadyRatio', () => {
    it('counts running + succeeded as ready', () => {
      const counts = countPodPhases([
        pod({ status: 'Running' }),
        pod({ status: 'Succeeded' }),
        pod({ status: 'Pending' }),
      ]);
      expect(podReadyRatio(counts)).toBe('2/3');
    });
  });

  describe('rollUpWorkloadReadiness', () => {
    it('returns unknown when ready is missing or malformed', () => {
      expect(rollUpWorkloadReadiness(null)).toBe('unknown');
      expect(rollUpWorkloadReadiness(undefined)).toBe('unknown');
      expect(rollUpWorkloadReadiness('')).toBe('unknown');
      expect(rollUpWorkloadReadiness('bad/data')).toBe('unknown');
    });

    it('returns unknown when desired replicas is zero', () => {
      // A workload with spec replicas=0 is neither healthy nor failing —
      // it's off. Flag it as unknown so the triage card surfaces rather
      // than hiding it.
      expect(rollUpWorkloadReadiness('0/0')).toBe('unknown');
    });

    it('returns failing when zero are ready but replicas are desired', () => {
      expect(rollUpWorkloadReadiness('0/3')).toBe('failing');
    });

    it('returns degraded when partially ready', () => {
      expect(rollUpWorkloadReadiness('2/3')).toBe('degraded');
    });

    it('returns healthy when fully ready', () => {
      expect(rollUpWorkloadReadiness('3/3')).toBe('healthy');
    });
  });

  describe('rollUpNodeStatus', () => {
    it('is failing when any node is NotReady', () => {
      expect(rollUpNodeStatus(['Ready', 'NotReady'])).toBe('failing');
    });
    it('is degraded when any node is Unknown and none failed', () => {
      expect(rollUpNodeStatus(['Ready', 'Unknown'])).toBe('degraded');
    });
    it('is healthy when all are Ready', () => {
      expect(rollUpNodeStatus(['Ready', 'Ready'])).toBe('healthy');
    });
    it('is unknown for an empty node list', () => {
      expect(rollUpNodeStatus([])).toBe('unknown');
    });
  });
});
