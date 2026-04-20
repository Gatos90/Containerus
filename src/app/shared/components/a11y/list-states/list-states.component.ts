import {
  AfterViewInit,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * Single-purpose wrapper enforcing the §4.3 loading / empty / error trio.
 *
 * Contracts (AccessibilitySpecialist sign-off baseline):
 * - **Loading** — `role="status"` + `aria-busy="true"`. SRs announce "Loading"
 *   politely on first transition in; we intentionally do NOT make this a
 *   `live` region with `assertive`, because rapid reloads would spam AT.
 * - **Empty** — `aria-live="off"` on first render. The empty headline is part
 *   of the initial page content; re-announcing "No results" on every filter
 *   keystroke drowns SR users. If you need to announce new emptiness after a
 *   user action, use a separate announcer — not this component.
 * - **Error** — `role="alert"` with focus moved to the retry button on mount.
 *   Alerts short-circuit polite queue so failures are heard immediately.
 */
@Component({
  selector: 'app-list-states',
  standalone: true,
  templateUrl: './list-states.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListStatesComponent implements AfterViewInit {
  readonly loading = input(false, { transform: booleanAttribute });
  readonly empty = input(false, { transform: booleanAttribute });
  readonly error = input<string | null>(null);

  readonly loadingLabel = input<string>('Loading…');
  readonly emptyHeadline = input<string>('Nothing here yet');
  readonly emptyDescription = input<string | null>(null);
  readonly retryLabel = input<string>('Retry');

  readonly retry = output<void>();

  /**
   * Exactly one of loading/error/empty is shown — precedence is
   * error → loading → empty. That ordering matches the §4.3 guidance so a
   * 500 from the API is never hidden behind a spinner once data lands.
   */
  readonly mode = computed<'error' | 'loading' | 'empty' | 'idle'>(() => {
    if (this.error()) return 'error';
    if (this.loading()) return 'loading';
    if (this.empty()) return 'empty';
    return 'idle';
  });

  private readonly retryButton = viewChild<ElementRef<HTMLButtonElement>>('retryButton');

  constructor() {
    // When an error appears for the first time, move focus to the retry
    // button so keyboard users can re-run the fetch without hunting for it.
    let lastMode: string | null = null;
    effect(() => {
      const current = this.mode();
      if (current === 'error' && lastMode !== 'error') {
        queueMicrotask(() => this.retryButton()?.nativeElement?.focus());
      }
      lastMode = current;
    });
  }

  ngAfterViewInit(): void {
    if (this.mode() === 'error') {
      queueMicrotask(() => this.retryButton()?.nativeElement?.focus());
    }
  }

  onRetry(): void {
    this.retry.emit();
  }
}
