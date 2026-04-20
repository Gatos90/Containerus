import { ConfigurableFocusTrap, ConfigurableFocusTrapFactory } from '@angular/cdk/a11y';
import {
  AfterViewInit,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';

let drawerSeq = 0;

/**
 * Right-side drawer dialog. Composes the three contracts CON-115 §5 calls out:
 *
 * 1. Focus trap via CDK ConfigurableFocusTrapFactory (shared with AppModal).
 * 2. Esc close (suppressible via `disableEscape`).
 * 3. "Pristine vs dirty" backdrop semantics — clicking the backdrop closes
 *    the drawer when `dirty=false`, and emits `dirtyCloseAttempt` instead
 *    when `dirty=true` so the caller can open a confirm step.
 *
 * Focus restoration uses an explicit `restoreFocusTo` input rather than
 * `document.activeElement`: on route changes or when the trigger was itself
 * inside a closing overlay, `document.activeElement` is already gone by the
 * time we destroy, and focus gets dumped onto `<body>` (the AccessibilitySpecialist
 * flagged this exact bug in the §5 review).
 */
@Component({
  selector: 'app-drawer-dialog',
  standalone: true,
  templateUrl: './drawer-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DrawerDialogComponent implements AfterViewInit, OnDestroy {
  readonly open = input(false, { transform: booleanAttribute });
  readonly titleId = input<string>(`drawer-title-${++drawerSeq}`);
  readonly dirty = input(false, { transform: booleanAttribute });
  readonly disableEscape = input(false, { transform: booleanAttribute });
  /**
   * Explicit focus-restore target. Required — callers must capture
   * `event.currentTarget` or a stable ref before opening, because by the
   * time we unmount, `document.activeElement` may point at `<body>`.
   */
  readonly restoreFocusTo = input<HTMLElement | null>(null);

  readonly closed = output<void>();
  readonly dirtyCloseAttempt = output<void>();

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly focusTrapFactory = inject(ConfigurableFocusTrapFactory);
  private readonly destroyRef = inject(DestroyRef);

  private trap: ConfigurableFocusTrap | null = null;
  private lastOpen = signal(false);

  constructor() {
    // React to `open` transitions: set up / tear down the trap + focus
    // restore target explicitly. We do NOT fall back to document.activeElement.
    effect(() => {
      const isOpen = this.open();
      const wasOpen = this.lastOpen();
      if (isOpen && !wasOpen) {
        this.setupTrap();
      } else if (!isOpen && wasOpen) {
        this.teardownTrap();
      }
      this.lastOpen.set(isOpen);
    });
    this.destroyRef.onDestroy(() => this.teardownTrap());
  }

  ngAfterViewInit(): void {
    if (this.open()) {
      this.setupTrap();
    }
  }

  ngOnDestroy(): void {
    this.teardownTrap();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.open()) return;
    if (this.disableEscape()) return;
    event.stopPropagation();
    this.requestClose();
  }

  onBackdropClick(): void {
    this.requestClose();
  }

  /**
   * Close attempt handler. Pristine drawers close straight through; dirty
   * drawers emit a `dirtyCloseAttempt` so the caller can decide (confirm
   * dialog, discard/save, etc) rather than silently swallowing changes.
   */
  requestClose(): void {
    if (this.dirty()) {
      this.dirtyCloseAttempt.emit();
      return;
    }
    this.closed.emit();
  }

  private setupTrap(): void {
    const el = this.panel()?.nativeElement;
    if (!el) return;
    this.trap = this.focusTrapFactory.create(el);
    queueMicrotask(() => {
      const focused = this.trap?.focusInitialElement();
      if (!focused) {
        el.focus({ preventScroll: true });
      }
    });
  }

  private teardownTrap(): void {
    this.trap?.destroy();
    this.trap = null;
    const restore = this.restoreFocusTo();
    if (restore && typeof restore.focus === 'function') {
      // Defer one tick so the close animation / DOM cleanup completes before
      // we move focus. Failing to do so in jsdom also makes the focus() call
      // silently no-op against a detached node.
      queueMicrotask(() => {
        try {
          restore.focus({ preventScroll: true });
        } catch {
          // Element may be gone; caller's aria-live should already have
          // announced the close so letting focus fall to body is acceptable.
        }
      });
    }
  }
}
