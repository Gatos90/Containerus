import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { K8sCluster } from '../../../../core/models/backend.model';

/**
 * CON-131 §3 — cluster switcher for the Phase-2 overview. Follows the same
 * WAI-ARIA 1.2 select-only combobox pattern as CON-124's connection
 * switcher: trigger button owns focus, listbox popup uses
 * `aria-activedescendant` for arrow-nav, Home/End jump to ends, Esc closes
 * and restores focus to the trigger. Clusters with `isActive=false` are
 * rendered as disabled options (per ARIA 1.2: `aria-disabled="true"` on
 * `role="option"`, the option is navigable but non-selectable).
 */
@Component({
  selector: 'app-k8s-cluster-switcher',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="relative">
      <label [attr.for]="triggerId" class="sr-only">Kubernetes cluster</label>
      <button
        #trigger
        [id]="triggerId"
        type="button"
        class="flex min-w-[12rem] items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 hover:border-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
        role="combobox"
        [attr.aria-controls]="listboxId"
        [attr.aria-expanded]="open()"
        aria-haspopup="listbox"
        [attr.aria-activedescendant]="activeDescendantId()"
        (click)="toggle()"
        (keydown)="onTriggerKeydown($event)"
      >
        <span class="flex-1 truncate text-left">{{ activeCluster()?.name ?? 'No cluster selected' }}</span>
        <span aria-hidden="true" class="text-xs text-zinc-500">▾</span>
      </button>

      @if (open()) {
        <ul
          [id]="listboxId"
          role="listbox"
          [attr.aria-labelledby]="triggerId"
          class="absolute left-0 top-full z-20 mt-1 max-h-72 w-full min-w-[16rem] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        >
          @for (c of clusters(); track c.id; let i = $index) {
            <li
              [id]="optionId(i)"
              role="option"
              [attr.aria-selected]="c.id === activeClusterId()"
              [attr.aria-disabled]="!c.isActive || null"
              class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"
              [class.bg-blue-600]="i === activeIndex()"
              [class.text-white]="i === activeIndex()"
              [class.text-zinc-100]="i !== activeIndex() && c.isActive"
              [class.text-zinc-500]="!c.isActive"
              (mousedown)="activateIndex(i, $event)"
              (mousemove)="activeIndex.set(i)"
            >
              <span class="flex-1 truncate">{{ c.name }}</span>
              @if (!c.isActive) {
                <span class="text-[10px] uppercase tracking-wide text-zinc-500">offline</span>
              }
            </li>
          }
          @if (clusters().length === 0) {
            <li role="option" aria-disabled="true" class="px-3 py-2 text-xs text-zinc-500">
              No clusters configured.
            </li>
          }
        </ul>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class K8sClusterSwitcherComponent {
  readonly clusters = input.required<ReadonlyArray<K8sCluster>>();
  readonly activeClusterId = input<string | null>(null);
  readonly select = output<string>();

  @ViewChild('trigger', { static: true })
  triggerEl!: ElementRef<HTMLButtonElement>;

  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly seq = Math.random().toString(36).slice(2, 9);
  readonly triggerId = `k8s-cluster-switcher-trigger-${this.seq}`;
  readonly listboxId = `k8s-cluster-switcher-listbox-${this.seq}`;

  readonly open = signal(false);
  readonly activeIndex = signal(0);

  readonly activeCluster = computed(() =>
    this.clusters().find((c) => c.id === this.activeClusterId()) ?? this.clusters()[0] ?? null,
  );

  optionId(index: number): string {
    return `${this.listboxId}-opt-${index}`;
  }

  /**
   * `aria-activedescendant` must point at a real element id or be absent —
   * NVDA/JAWS silently swallow dangling ids. Only expose the attribute when
   * the listbox is open AND has at least one concrete option to point at.
   */
  readonly activeDescendantId = computed(() => {
    if (!this.open()) return null;
    if (this.clusters().length === 0) return null;
    return this.optionId(this.activeIndex());
  });

  toggle(): void {
    if (this.open()) this.close();
    else this.openList();
  }

  openList(): void {
    const list = this.clusters();
    const active = this.activeClusterId();
    const idx = Math.max(0, list.findIndex((c) => c.id === active));
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

  activateIndex(index: number, event?: Event): void {
    event?.preventDefault();
    const opt = this.clusters()[index];
    if (!opt || !opt.isActive) return;
    this.select.emit(opt.id);
    this.close();
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    const max = this.clusters().length - 1;
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
          this.activateIndex(this.activeIndex());
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
