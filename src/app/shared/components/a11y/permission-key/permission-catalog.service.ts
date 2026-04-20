import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * Loads the `/api/permissions/catalog` dictionary once per session and caches
 * it in memory. Used by <PermissionKey> to resolve human-readable popover
 * text for each permission string. We deliberately fall back to "no catalog"
 * on failure — per the §5 contract, PermissionKey silently omits the popover
 * affordance when a description is unavailable, rather than showing a
 * disabled-looking icon with no explanation.
 */
@Injectable({ providedIn: 'root' })
export class PermissionCatalogService {
  private readonly http = inject(HttpClient, { optional: true });
  private readonly _catalog = signal<Record<string, string>>({});
  private loadPromise: Promise<void> | null = null;

  readonly catalog = this._catalog.asReadonly();

  /** Resolve the description for a permission key, or null if unknown. */
  descriptionFor(key: string): string | null {
    return this._catalog()[key] ?? null;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    if (!this.http) {
      // No HttpClient available (tests without provideHttpClient). Treat as empty.
      this._catalog.set({});
      this.loadPromise = Promise.resolve();
      return this.loadPromise;
    }
    this.loadPromise = firstValueFrom(this.http.get<Record<string, string>>('/api/permissions/catalog'))
      .then((map) => {
        this._catalog.set(map ?? {});
      })
      .catch(() => {
        // Silent fallback — the component handles the "no description" path.
        this._catalog.set({});
      });
    return this.loadPromise;
  }

  /** Test seam. Replaces the in-memory catalog without hitting the network. */
  seed(entries: Record<string, string>): void {
    this._catalog.set({ ...entries });
    this.loadPromise = Promise.resolve();
  }
}
