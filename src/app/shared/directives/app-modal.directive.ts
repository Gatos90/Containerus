import { ConfigurableFocusTrap, ConfigurableFocusTrapFactory } from '@angular/cdk/a11y';
import {
  booleanAttribute,
  DestroyRef,
  Directive,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
} from '@angular/core';

let modalIdSeq = 0;

/**
 * Wires modal panels with the a11y baseline we expect across the app:
 * role=dialog + aria-modal, a focus trap with auto-capture, Esc to close,
 * and focus restoration to the element that opened the modal.
 *
 * Usage:
 *   <div appModal (modalClose)="close.emit()" aria-labelledby="foo-title">...</div>
 */
@Directive({
  selector: '[appModal]',
  standalone: true,
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    tabindex: '-1',
  },
})
export class AppModalDirective implements OnInit, OnDestroy {
  readonly modalClose = output<void>();

  readonly disableEscape = input(false, { transform: booleanAttribute });
  readonly disableFocusTrap = input(false, { transform: booleanAttribute });

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly focusTrapFactory = inject(ConfigurableFocusTrapFactory);
  private readonly destroyRef = inject(DestroyRef);

  private trap: ConfigurableFocusTrap | null = null;
  private previouslyFocused: HTMLElement | null = null;

  ngOnInit(): void {
    const el = this.host.nativeElement;
    if (!el.id) {
      el.id = `app-modal-${++modalIdSeq}`;
    }

    this.previouslyFocused =
      (document.activeElement as HTMLElement | null) ?? null;

    if (!this.disableFocusTrap()) {
      this.trap = this.focusTrapFactory.create(el);
      queueMicrotask(() => {
        const focused = this.trap?.focusInitialElement();
        if (!focused) {
          el.focus({ preventScroll: true });
        }
      });
    }

    this.destroyRef.onDestroy(() => this.cleanup());
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (this.disableEscape()) return;
    event.stopPropagation();
    this.modalClose.emit();
  }

  private cleanup(): void {
    this.trap?.destroy();
    this.trap = null;
    const restore = this.previouslyFocused;
    this.previouslyFocused = null;
    if (restore && typeof restore.focus === 'function') {
      queueMicrotask(() => {
        try {
          restore.focus({ preventScroll: true });
        } catch {
          // Element may be gone; ignore.
        }
      });
    }
  }
}
