import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { PermissionCatalogService } from './permission-catalog.service';

let popoverSeq = 0;

/**
 * Renders a permission key (e.g. `container:exec`) and — when a description
 * exists in the backend-served permission catalog — an (i) affordance that
 * opens a keyboard-accessible popover.
 *
 * Rules (§5 contract):
 * - If no description is available, the affordance is OMITTED. No hover-only
 *   tooltips, no `title=` attributes, no disabled-looking icons. The rest of
 *   the UI must not rely on hover to expose meaning.
 * - The popover is opened by Click/Enter/Space and closed by Esc. It is
 *   positioned *next to* the key, not overlaid on it — SRs announce the
 *   description as part of the button's `aria-describedby`.
 * - Rendered as `<code>` for monospace alignment in permission tables.
 */
@Component({
  selector: 'app-permission-key',
  standalone: true,
  templateUrl: './permission-key.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionKeyComponent implements OnInit {
  readonly value = input.required<string>();

  private readonly catalog = inject(PermissionCatalogService);
  private readonly popoverId = `permission-popover-${++popoverSeq}`;

  readonly open = signal(false);
  readonly description = computed(() => this.catalog.descriptionFor(this.value()));
  readonly hasDescription = computed(() => !!this.description());
  readonly popoverIdSignal = computed(() => this.popoverId);

  ngOnInit(): void {
    // Fire-and-forget. The catalog signal will update the component when the
    // fetch resolves; until then we simply show the key without affordance.
    void this.catalog.ensureLoaded();
  }

  toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.open.update((o) => !o);
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.open.update((o) => !o);
    } else if (event.key === 'Escape' && this.open()) {
      event.preventDefault();
      event.stopPropagation();
      this.open.set(false);
    }
  }

  close(): void {
    this.open.set(false);
  }
}
