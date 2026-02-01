import { computed, Injectable, signal } from '@angular/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { LiveSystemMetrics } from '../models/system.model';
import { TauriService } from './tauri.service';

/** Maximum number of history samples to keep per system */
const HISTORY_LENGTH = 30;

/** Event name for live metrics updates from backend */
const METRICS_EVENT = 'system:metrics';

@Injectable({ providedIn: 'root' })
export class SystemMonitoringService {
  /** Current metrics for each system (latest only) */
  private _metrics = signal<Record<string, LiveSystemMetrics>>({});

  /** Historical metrics for each system (last N samples) */
  private _history = signal<Record<string, LiveSystemMetrics[]>>({});

  /** Systems currently being monitored */
  private _monitoredSystems = signal<Set<string>>(new Set());

  /** Event listener cleanup function */
  private unlistenFn: UnlistenFn | null = null;

  /** Public readonly signals */
  readonly metrics = this._metrics.asReadonly();
  readonly history = this._history.asReadonly();
  readonly monitoredSystems = computed(() => Array.from(this._monitoredSystems()));

  constructor(private tauri: TauriService) {}

  /**
   * Start listening to metrics events from the backend.
   * Should be called once when the app initializes.
   */
  async startListening(): Promise<void> {
    if (this.unlistenFn) {
      console.warn('Already listening to metrics events');
      return;
    }

    this.unlistenFn = await listen<LiveSystemMetrics>(METRICS_EVENT, (event) => {
      const metrics = event.payload;
      this.updateMetrics(metrics);
    });

    console.log('Started listening to system metrics events');
  }

  /**
   * Stop listening to metrics events.
   * Should be called when the app is shutting down.
   */
  async stopListening(): Promise<void> {
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
      console.log('Stopped listening to system metrics events');
    }
  }

  /**
   * Start monitoring a system.
   * @param systemId The system ID to monitor
   * @param intervalMs Polling interval in milliseconds (default: 3000)
   */
  async startMonitoring(systemId: string, intervalMs: number = 3000): Promise<boolean> {
    try {
      const started = await this.tauri.invoke<boolean>('start_system_monitoring', {
        systemId,
        intervalMs,
      });

      if (started) {
        this._monitoredSystems.update((systems) => new Set([...systems, systemId]));
      }

      return started;
    } catch (err) {
      console.error(`Failed to start monitoring for ${systemId}:`, err);
      return false;
    }
  }

  /**
   * Stop monitoring a system.
   * @param systemId The system ID to stop monitoring
   */
  async stopMonitoring(systemId: string): Promise<boolean> {
    try {
      const stopped = await this.tauri.invoke<boolean>('stop_system_monitoring', {
        systemId,
      });

      if (stopped) {
        this._monitoredSystems.update((systems) => {
          const newSet = new Set(systems);
          newSet.delete(systemId);
          return newSet;
        });

        // Clear metrics and history for this system
        this._metrics.update((m) => {
          const newMap = { ...m };
          delete newMap[systemId];
          return newMap;
        });

        this._history.update((h) => {
          const newMap = { ...h };
          delete newMap[systemId];
          return newMap;
        });
      }

      return stopped;
    } catch (err) {
      console.error(`Failed to stop monitoring for ${systemId}:`, err);
      return false;
    }
  }

  /**
   * Check if a system is currently being monitored.
   */
  isMonitoring(systemId: string): boolean {
    return this._monitoredSystems().has(systemId);
  }

  /**
   * Get current metrics for a system (or null if not available).
   */
  getMetrics(systemId: string): LiveSystemMetrics | null {
    return this._metrics()[systemId] ?? null;
  }

  /**
   * Get metrics history for a system.
   */
  getHistory(systemId: string): LiveSystemMetrics[] {
    return this._history()[systemId] ?? [];
  }

  /**
   * Fetch current metrics once (without starting continuous monitoring).
   */
  async fetchMetricsOnce(systemId: string): Promise<LiveSystemMetrics | null> {
    try {
      const metrics = await this.tauri.invoke<LiveSystemMetrics>('get_live_metrics', {
        systemId,
      });
      this.updateMetrics(metrics);
      return metrics;
    } catch (err) {
      console.error(`Failed to fetch metrics for ${systemId}:`, err);
      return null;
    }
  }

  /**
   * Update metrics state (called from event listener or fetchMetricsOnce).
   */
  private updateMetrics(metrics: LiveSystemMetrics): void {
    const systemId = metrics.systemId;

    // Update current metrics
    this._metrics.update((m) => ({
      ...m,
      [systemId]: metrics,
    }));

    // Update history (keep last N samples)
    this._history.update((h) => {
      const currentHistory = h[systemId] ?? [];
      const newHistory = [...currentHistory, metrics].slice(-HISTORY_LENGTH);
      return {
        ...h,
        [systemId]: newHistory,
      };
    });
  }

  /**
   * Clear all metrics and history for a system.
   */
  clearMetrics(systemId: string): void {
    this._metrics.update((m) => {
      const newMap = { ...m };
      delete newMap[systemId];
      return newMap;
    });

    this._history.update((h) => {
      const newMap = { ...h };
      delete newMap[systemId];
      return newMap;
    });
  }

  /**
   * Clear all metrics and stop all monitoring.
   */
  async clearAll(): Promise<void> {
    // Stop monitoring all systems
    for (const systemId of this._monitoredSystems()) {
      await this.stopMonitoring(systemId);
    }

    this._metrics.set({});
    this._history.set({});
    this._monitoredSystems.set(new Set());
  }
}
