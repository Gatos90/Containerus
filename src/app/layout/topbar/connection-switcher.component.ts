import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { BackendService } from '../../core/services/backend.service';
import { UiPreferencesState, LOCAL_CONNECTION_ID } from '../../state/ui-preferences.state';
import {
  ConnectionBadgeComponent,
  paletteFor,
  glyphFor,
} from '../../shared/components/a11y';

interface SwitcherOption {
  id: string;
  label: string;
  sub?: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error' | 'local';
}

/**
 * Topbar connection switcher (CON-124 §1). WAI-ARIA 1.2 combobox with a
 * listbox popup — keyboard model: ArrowDown opens + moves focus to first
 * option, Home/End jump to ends, Enter/Space picks, Esc closes and restores
 * focus to the trigger. `aria-activedescendant` drives the active option so
 * focus never leaves the trigger input, which keeps the announce model the
 * same as a native `<select>`.
 */
@Component({
  selector: 'app-connection-switcher',
  standalone: true,
  imports: [CommonModule, ConnectionBadgeComponent],
  templateUrl: './connection-switcher.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionSwitcherComponent {
  readonly backend = inject(BackendService);
  readonly ui = inject(UiPreferencesState);

  @ViewChild('trigger', { static: true })
  triggerEl!: ElementRef<HTMLButtonElement>;

  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly open = signal(false);
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

  readonly activeOption = computed<SwitcherOption>(() => {
    const active = this.ui.activeConnectionId();
    return (
      this.options().find((o) => o.id === active) ??
      this.options()[0]
    );
  });

  readonly accentColor = computed(() => {
    if (!this.ui.showConnectionTint()) return null;
    const active = this.activeOption();
    if (active.id === LOCAL_CONNECTION_ID) return null;
    return paletteFor(active.id).ring;
  });

  readonly glyph = (id: string): string => glyphFor(id);

  readonly listboxId = `conn-switcher-listbox-${Math.random().toString(36).slice(2, 9)}`;
  optionId(index: number): string {
    return `${this.listboxId}-opt-${index}`;
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

  toggle(): void {
    if (this.open()) {
      this.close();
    } else {
      this.openList();
    }
  }

  openList(): void {
    const activeId = this.ui.activeConnectionId();
    const idx = Math.max(0, this.options().findIndex((o) => o.id === activeId));
    this.activeIndex.set(idx);
    this.open.set(true);
  }

  close(restoreFocus = true): void {
    if (!this.open()) return;
    this.open.set(false);
    if (restoreFocus) {
      queueMicrotask(() => this.triggerEl.nativeElement.focus());
    }
  }

  selectIndex(index: number): void {
    const opt = this.options()[index];
    if (!opt) return;
    this.ui.setActiveConnection(opt.id);
    this.close();
  }

  /**
   * Single keydown handler. Select-Only Combobox keeps focus on the trigger
   * (`<ul>` is never focused), so all navigation keys must route through here —
   * they don't bubble from the button to its sibling listbox.
   */
  onTriggerKeydown(event: KeyboardEvent): void {
    const max = this.options().length - 1;

    if (this.open()) {
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
        case 'Tab':
          this.close(false);
          return;
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.openList();
        return;
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocClick(event: MouseEvent): void {
    if (!this.open()) return;
    const target = event.target as Node | null;
    if (target && !this.hostEl.nativeElement.contains(target)) {
      this.close(false);
    }
  }
}
