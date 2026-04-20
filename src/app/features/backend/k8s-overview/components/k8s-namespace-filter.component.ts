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
import { FormsModule } from '@angular/forms';

/**
 * CON-131 §4 — namespace combobox with type-ahead filtering and
 * URL-synced value (the URL side is driven by the page; this component
 * only exposes `select` + a current value). Keeps the same select-only
 * combobox keyboard model as the cluster switcher so the overview stays
 * consistent — the filter is type-ahead, so we additionally filter the
 * listbox by the trigger's current text.
 *
 * "All namespaces" is represented by the empty string value. We emit `null`
 * upstream to keep the URL query tidy (dropping `ns=` rather than
 * serialising the empty string).
 */
@Component({
  selector: 'app-k8s-namespace-filter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="relative">
      <label [attr.for]="triggerId" class="sr-only">Namespace filter</label>
      <input
        #trigger
        [id]="triggerId"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-autocomplete="list"
        [attr.aria-controls]="listboxId"
        [attr.aria-expanded]="open()"
        aria-haspopup="listbox"
        [attr.aria-activedescendant]="activeDescendantId()"
        class="w-48 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
        [placeholder]="allLabel"
        [value]="displayValue()"
        (input)="onInput($event)"
        (focus)="openList()"
        (keydown)="onKeydown($event)"
      />
      @if (open()) {
        <ul
          [id]="listboxId"
          role="listbox"
          class="absolute left-0 top-full z-20 mt-1 max-h-72 w-full min-w-[16rem] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        >
          @for (opt of filteredOptions(); track opt.value; let i = $index) {
            <li
              [id]="optionId(i)"
              role="option"
              [attr.aria-selected]="opt.value === (activeNamespace() ?? '')"
              class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"
              [class.bg-blue-600]="i === activeIndex()"
              [class.text-white]="i === activeIndex()"
              [class.text-zinc-100]="i !== activeIndex()"
              (mousedown)="activateIndex(i, $event)"
              (mousemove)="activeIndex.set(i)"
            >
              <span class="flex-1 truncate">{{ opt.label }}</span>
            </li>
          }
          @if (filteredOptions().length === 0) {
            <li role="option" aria-disabled="true" class="px-3 py-2 text-xs text-zinc-500">
              No matching namespaces.
            </li>
          }
        </ul>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class K8sNamespaceFilterComponent {
  readonly namespaces = input.required<ReadonlyArray<string>>();
  /** `null` means "All namespaces". */
  readonly activeNamespace = input<string | null>(null);
  readonly select = output<string | null>();

  readonly allLabel = 'All namespaces';

  @ViewChild('trigger', { static: true })
  triggerEl!: ElementRef<HTMLInputElement>;

  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly seq = Math.random().toString(36).slice(2, 9);
  readonly triggerId = `k8s-ns-filter-trigger-${this.seq}`;
  readonly listboxId = `k8s-ns-filter-listbox-${this.seq}`;

  readonly open = signal(false);
  readonly activeIndex = signal(0);
  readonly query = signal('');

  readonly options = computed(() => {
    const opts: { value: string; label: string }[] = [{ value: '', label: this.allLabel }];
    for (const ns of this.namespaces()) opts.push({ value: ns, label: ns });
    return opts;
  });

  readonly filteredOptions = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.options();
    return this.options().filter((o) => o.label.toLowerCase().includes(q));
  });

  readonly displayValue = computed(() => {
    if (this.open()) return this.query();
    const ns = this.activeNamespace();
    return ns ?? '';
  });

  optionId(index: number): string {
    return `${this.listboxId}-opt-${index}`;
  }

  /**
   * Suppress `aria-activedescendant` whenever the filtered list is empty
   * (type-ahead narrowed everything out) so the attribute never points at
   * a non-existent id. NVDA/JAWS silently ignore dangling ids otherwise.
   */
  readonly activeDescendantId = computed(() => {
    if (!this.open()) return null;
    if (this.filteredOptions().length === 0) return null;
    return this.optionId(this.activeIndex());
  });

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.open.set(true);
    this.activeIndex.set(0);
  }

  openList(): void {
    // Preserve any prior query on refocus — wiping it on tab-back is
    // disorienting. The displayValue() computed already falls back to the
    // active namespace when `query` is empty.
    this.open.set(true);
    const active = this.activeNamespace() ?? '';
    const idx = Math.max(0, this.filteredOptions().findIndex((o) => o.value === active));
    this.activeIndex.set(idx);
  }

  close(restoreFocus = true): void {
    if (!this.open()) return;
    this.open.set(false);
    this.query.set('');
    if (restoreFocus) {
      queueMicrotask(() => this.triggerEl.nativeElement.focus());
    }
  }

  activateIndex(index: number, event?: Event): void {
    event?.preventDefault();
    const opt = this.filteredOptions()[index];
    if (!opt) return;
    this.select.emit(opt.value === '' ? null : opt.value);
    this.close();
  }

  onKeydown(event: KeyboardEvent): void {
    const max = this.filteredOptions().length - 1;
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
        // Home/End intentionally fall through to caret navigation: this is a
        // text input first and a listbox second (APG allows either behavior
        // for editable comboboxes; caret nav matches user expectation here).
        case 'Enter':
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
