import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface VirtualGridRow {
  /** Stable id for trackBy. Callers MUST ensure uniqueness. */
  readonly id: string | number;
}

/** Keyboard model name — only `grid` is implemented today. */
export type KeyboardModel = 'grid';

/**
 * Virtualized table with a full grid keyboard model.
 *
 * Accessibility contract (§5, informed by §6.2):
 * - The outer element has `role=grid` and `aria-rowcount` equal to the full
 *   dataset (not just the visible window). `aria-rowindex` on each row uses
 *   the 1-based *real-dataset* index so AT announces "row 4,218 of 10,000"
 *   even when only rows 4,200–4,220 are mounted.
 * - Keyboard: Arrow Up/Down moves focus ±1. Home/End = start/end of visible
 *   window; Ctrl+Home / Ctrl+End = absolute start/end. PageUp/PageDown scrolls
 *   ±pageSize. After any key that moves focus out of the currently-rendered
 *   window (PageUp/PageDown, Ctrl+Home/End) we scroll *first*, then focus
 *   inside `requestAnimationFrame` — §6.2 "scroll-before-focus" rule.
 * - Row render is opaque — callers pass a `TemplateRef`. The shell owns ARIA
 *   attrs so screens never re-implement row semantics.
 */
@Component({
  selector: 'app-virtual-grid',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './virtual-grid.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VirtualGridComponent<T extends VirtualGridRow> implements AfterViewInit, OnDestroy {
  readonly rows = input.required<readonly T[]>();
  readonly rowHeight = input<number>(36);
  /** Visible viewport height in px. */
  readonly viewportHeight = input<number>(400);
  /** Number of rows to render above/below the visible window as a buffer. */
  readonly overscan = input<number>(4);
  readonly keyboardModel = input<KeyboardModel>('grid');
  readonly rowTemplate = input.required<TemplateRef<{ $implicit: T; index: number }>>();
  /** aria-label applied to the grid shell. Must name the data in context. */
  readonly ariaLabel = input.required<string>();

  readonly rowActivated = output<T>();

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  readonly scrollTop = signal(0);
  readonly focusedIndex = signal(0);

  readonly rowCount = computed(() => this.rows().length);

  /** Visible window [start, end). `end` is exclusive. Clamped to row count. */
  readonly window = computed<[number, number]>(() => {
    const h = this.rowHeight();
    const count = this.rowCount();
    if (count === 0 || h <= 0) return [0, 0];
    const viewport = this.viewportHeight();
    const overscan = this.overscan();
    const first = Math.max(0, Math.floor(this.scrollTop() / h) - overscan);
    const visible = Math.ceil(viewport / h) + overscan * 2;
    const last = Math.min(count, first + visible);
    return [first, last];
  });

  readonly visibleRows = computed(() => {
    const [start, end] = this.window();
    return this.rows().slice(start, end).map((row, i) => ({ row, index: start + i }));
  });

  readonly totalHeight = computed(() => this.rowCount() * this.rowHeight());
  readonly topSpacerHeight = computed(() => this.window()[0] * this.rowHeight());

  constructor() {
    // Reset focus to 0 if the data shrinks below the focused index — prevents
    // a stale focusedIndex from pointing off the end of the dataset.
    effect(() => {
      const count = this.rowCount();
      if (this.focusedIndex() >= count) {
        this.focusedIndex.set(Math.max(0, count - 1));
      }
    });
  }

  ngAfterViewInit(): void {
    // Sync the initial scrollTop in case Angular restores scroll position.
    const el = this.scroller()?.nativeElement;
    if (el) this.scrollTop.set(el.scrollTop);
  }

  ngOnDestroy(): void {
    // Nothing to tear down — signals are GCed with the component.
  }

  onScroll(event: Event): void {
    const el = event.target as HTMLElement;
    this.scrollTop.set(el.scrollTop);
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.rowCount();
    if (count === 0) return;
    const pageSize = Math.max(1, Math.floor(this.viewportHeight() / this.rowHeight()));
    const current = this.focusedIndex();
    let next = current;
    switch (event.key) {
      case 'ArrowDown': next = Math.min(count - 1, current + 1); break;
      case 'ArrowUp':   next = Math.max(0, current - 1); break;
      case 'Home':      next = event.ctrlKey || event.metaKey ? 0 : this.window()[0]; break;
      case 'End':       next = event.ctrlKey || event.metaKey ? count - 1 : this.window()[1] - 1; break;
      case 'PageDown':  next = Math.min(count - 1, current + pageSize); break;
      case 'PageUp':    next = Math.max(0, current - pageSize); break;
      case 'Enter':
      case ' ': {
        const row = this.rows()[current];
        if (row) this.rowActivated.emit(row);
        event.preventDefault();
        return;
      }
      default: return;
    }
    event.preventDefault();
    this.moveFocus(next);
  }

  /**
   * Move logical focus to `index`, scrolling first if the target is outside
   * the current render window. Focus is applied on the next animation frame
   * so the row DOM has a chance to mount — if we focused synchronously, AT
   * would announce the old row for a frame because the new row doesn't exist
   * in the DOM yet.
   */
  private moveFocus(index: number): void {
    this.focusedIndex.set(index);
    const [start, end] = this.window();
    const needsScroll = index < start || index >= end;
    const el = this.scroller()?.nativeElement;
    if (needsScroll && el) {
      el.scrollTop = index * this.rowHeight();
      // scrollTop assignment will fire onScroll and update window() on the
      // next tick. Focus after a frame so the new row is in the DOM.
      requestAnimationFrame(() => this.focusRowElement(index));
      return;
    }
    this.focusRowElement(index);
  }

  private focusRowElement(index: number): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    const row = el.querySelector<HTMLElement>(`[data-grid-row="${index}"]`);
    row?.focus({ preventScroll: true });
  }
}
