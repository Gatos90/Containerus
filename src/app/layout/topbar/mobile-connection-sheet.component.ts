import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { BackendService } from '../../core/services/backend.service';
import { LOCAL_CONNECTION_ID, UiPreferencesState } from '../../state/ui-preferences.state';
import {
  ConnectionBadgeComponent,
  paletteFor,
} from '../../shared/components/a11y';

interface SwitcherOption {
  id: string;
  label: string;
  sub?: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error' | 'local';
}

/**
 * CON-127 Phase 1 — mobile-only connection switcher surfaced below `md:`.
 * Same ARIA model as the desktop ConnectionSwitcher (select-only combobox
 * with a listbox popup), but presented as an always-open list inside a
 * bottom sheet so it's reachable from the mobile nav without a drawer that
 * the topbar (hidden on mobile) normally provides.
 *
 * Tap targets: each option row is ≥44px tall (WCAG SC 2.5.8 clears 24×24).
 */
@Component({
  selector: 'app-mobile-connection-sheet',
  standalone: true,
  imports: [CommonModule, ConnectionBadgeComponent],
  templateUrl: './mobile-connection-sheet.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileConnectionSheetComponent {
  readonly backend = inject(BackendService);
  readonly ui = inject(UiPreferencesState);

  readonly open = input(false, { transform: booleanAttribute });
  readonly closed = output<void>();

  @ViewChild('listbox', { static: false })
  listboxEl?: ElementRef<HTMLUListElement>;

  readonly activeIndex = signal(0);

  readonly options = computed<SwitcherOption[]>(() => {
    const opts: SwitcherOption[] = [
      { id: LOCAL_CONNECTION_ID, label: 'Local', sub: 'This machine', status: 'local' },
    ];
    for (const conn of this.backend.connections()) {
      opts.push({
        id: conn.id,
        label: conn.label,
        sub: conn.user?.displayName ?? conn.serverUrl,
        status: conn.status,
      });
    }
    return opts;
  });

  readonly accentFor = (opt: SwitcherOption): string | null => {
    if (!this.ui.showConnectionTint()) return null;
    if (opt.id === LOCAL_CONNECTION_ID) return null;
    return paletteFor(opt.id).ring;
  };

  readonly listboxId = `mobile-conn-sheet-listbox-${Math.random().toString(36).slice(2, 9)}`;
  optionId(index: number): string {
    return `${this.listboxId}-opt-${index}`;
  }

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const activeId = this.ui.activeConnectionId();
      const idx = Math.max(
        0,
        this.options().findIndex((o) => o.id === activeId),
      );
      this.activeIndex.set(idx);
      queueMicrotask(() => this.listboxEl?.nativeElement.focus());
    });
  }

  statusLabel(status: SwitcherOption['status']): string {
    switch (status) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting';
      case 'disconnected': return 'Disconnected';
      case 'error': return 'Error';
      case 'local': return 'Local';
    }
  }

  statusDotClass(status: SwitcherOption['status']): string {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-amber-500 animate-pulse';
      case 'error': return 'bg-red-500';
      case 'disconnected': return 'bg-zinc-500';
      case 'local': return 'bg-zinc-400';
    }
  }

  selectIndex(index: number): void {
    const opt = this.options()[index];
    if (!opt) return;
    this.ui.setActiveConnection(opt.id);
    this.closed.emit();
  }

  close(): void {
    this.closed.emit();
  }

  onListboxKeydown(event: KeyboardEvent): void {
    const max = this.options().length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex.update((i) => Math.min(max, i + 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.update((i) => Math.max(0, i - 1));
        return;
      case 'Home':
        event.preventDefault();
        this.activeIndex.set(0);
        return;
      case 'End':
        event.preventDefault();
        this.activeIndex.set(max);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.selectIndex(this.activeIndex());
        return;
      case 'Escape':
        event.preventDefault();
        this.close();
        return;
    }
  }
}
