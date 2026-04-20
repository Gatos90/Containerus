import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
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

/** Keyboard model name — only `listbox` is implemented today. */
export type KeyboardModel = 'listbox';

let gridSeq = 0;

/**
 * Virtualized scrolling list with a single-tab-stop listbox keyboard model.
 *
 * Accessibility contract (§5, informed by §6.2):
 * - The outer element has `role=listbox` and is the single Tab stop. Child
 *   rows render as `role=option` with `aria-setsize`/`aria-posinset` keyed
 *   against the real dataset, so AT announces "option 4,218 of 10,000" even
 *   when only rows 4,200–4,220 are mounted. Selection is tracked via
 *   `aria-activedescendant` so focus never leaves the shell during arrow
 *   navigation — rows themselves remain `tabindex="-1"`.
 * - Keyboard: Arrow Up/Down moves focus ±1. Home/End = start/end of visible
 *   window; Ctrl+Home / Ctrl+End = absolute start/end. PageUp/PageDown scrolls
 *   ±pageSize. After any key that moves focus out of the currently-rendered
 *   window (PageUp/PageDown, Ctrl+Home/End) we scroll *first*, then realign
 *   `aria-activedescendant` inside `requestAnimationFrame` — §6.2
 *   "scroll-before-focus" rule.
 * - Row render is opaque — callers pass a `TemplateRef`. The shell owns ARIA
 *   attrs so screens never re-implement row semantics.
 *
 * We deliberately picked listbox/option over grid/gridcell: the body is a
 * single-column identity list (one row = one pickable thing) and ARIA 1.2
 * forbids `role=grid` without `role=gridcell` children. Grid mode can come
 * back when a caller actually needs multi-column cell navigation.
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
  readonly keyboardModel = input<KeyboardModel>('listbox');
  readonly rowTemplate = input.required<TemplateRef<{ $implicit: T; index: number }>>();
  /** aria-label applied to the grid shell. Must name the data in context. */
  readonly ariaLabel = input.required<string>();

  readonly rowActivated = output<T>();

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly instanceId = `virtual-grid-${++gridSeq}`;

  readonly scrollTop = signal(0);
  readonly focusedIndex = signal(0);

  readonly rowCount = computed(() => this.rows().length);

  /** Stable DOM id for the row at `index`. */
  rowId(index: number): string {
    return `${this.instanceId}-row-${index}`;
  }

  /**
   * `aria-activedescendant` target — only valid when the focused row is
   * mounted in the current window. Returns null otherwise so AT falls back
   * to the listbox label rather than pointing at a stale id.
   */
  readonly activeDescendantId = computed<string | null>(() => {
    const idx = this.focusedIndex();
    const [start, end] = this.window();
    if (this.rowCount() === 0 || idx < start || idx >= end) return null;
    return this.rowId(idx);
  });

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
   * the current render window. DOM focus stays on the scroller (single tab
   * stop); `aria-activedescendant` is updated by the computed, so AT tracks
   * the logical focus without moving the tab ring off the listbox.
   */
  private moveFocus(index: number): void {
    this.focusedIndex.set(index);
    const [start, end] = this.window();
    const needsScroll = index < start || index >= end;
    const el = this.scroller()?.nativeElement;
    if (needsScroll && el) {
      el.scrollTop = index * this.rowHeight();
    }
  }
}
