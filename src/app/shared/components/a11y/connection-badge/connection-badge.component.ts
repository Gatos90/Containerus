import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import { paletteFor, glyphFor } from '../connection-palette';

export type ConnectionBadgeSize = 'sm' | 'md';

/**
 * Small, dense identity marker for a backend connection. Renders a filled
 * circle with a ring halo and a stable single-character glyph so connection
 * colorblind-accessible in combination with the glyph (dot + ring carries the
 * color, glyph carries the identity).
 *
 * Decorative-vs-interactive: when `interactive=false` (default), the badge is
 * emitted as a `<span aria-hidden="true">` so screen readers skip over it —
 * the calling surface is expected to already name the connection in text.
 * When `interactive=true`, it becomes a proper `<button>` with a full
 * `aria-label` that names the connection, and emits `activated` on click.
 */
@Component({
  selector: 'app-connection-badge',
  standalone: true,
  templateUrl: './connection-badge.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionBadgeComponent {
  readonly connectionId = input.required<string>();
  /** Optional label surfaced only for `interactive=true` aria-label text. */
  readonly connectionLabel = input<string | null>(null);
  readonly size = input<ConnectionBadgeSize>('md');
  readonly interactive = input(false, { transform: booleanAttribute });

  readonly activated = output<void>();

  readonly palette = computed(() => paletteFor(this.connectionId()));
  readonly glyph = computed(() => glyphFor(this.connectionId()));

  /**
   * The container dimension. `md` (24px) matches the WCAG 2.5.5 hit-target
   * recommendation; `sm` (16px) is decorative only and is only used in the
   * non-interactive path.
   */
  readonly dimension = computed(() => (this.size() === 'sm' ? 16 : 24));

  /** Aria-label for the interactive path. Falls back to the connection id. */
  readonly ariaLabel = computed(() => {
    const label = this.connectionLabel();
    const id = this.connectionId();
    return label ? `Connection ${label}` : `Connection ${id}`;
  });

  onClick(event: MouseEvent): void {
    if (!this.interactive()) return;
    event.stopPropagation();
    this.activated.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.interactive()) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.activated.emit();
    }
  }
}
