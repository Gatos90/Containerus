import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  LucideAngularModule,
  Search,
  Star,
  Ship,
  Container,
  Apple,
  ArrowRight,
  Settings,
  Command,
} from 'lucide-angular';
import {
  CommandTemplate,
  substituteVariables,
  parseVariables,
  getRuntimeLabel,
  getRuntimePrefix,
} from '../../../core/models/command-template.model';
import { ContainerRuntime } from '../../../core/models/container.model';
import { CommandTemplateState } from '../../../state/command-template.state';
import { SystemState } from '../../../state/system.state';

@Component({
  selector: 'app-command-palette',
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './command-palette.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onClose()',
  },
})
export class CommandPaletteComponent implements OnInit {
  // Inputs
  readonly systemId = input<string | null>(null);

  // Outputs
  readonly close = output<void>();
  readonly execute = output<{ command: string; template: CommandTemplate }>();

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  readonly commandState = inject(CommandTemplateState);
  readonly systemState = inject(SystemState);
  readonly router = inject(Router);

  // Icons
  readonly Search = Search;
  readonly Star = Star;
  readonly Ship = Ship;
  readonly Container = Container;
  readonly Apple = Apple;
  readonly ArrowRight = ArrowRight;
  readonly Settings = Settings;
  readonly Command = Command;

  readonly getRuntimeLabel = getRuntimeLabel;

  readonly searchQuery = signal('');
  readonly selectedIndex = signal(0);
  readonly selectedRuntime = signal<ContainerRuntime | null>(null);

  /**
   * Get the current system based on systemId input or fallback to first connected
   */
  readonly currentSystem = computed(() => {
    const id = this.systemId();
    if (id) {
      return this.systemState.systems().find((s) => s.id === id) ?? null;
    }
    const connected = this.systemState.connectedSystems();
    return connected.length > 0 ? connected[0] : null;
  });

  /**
   * Get the default runtime from the current system
   */
  readonly currentRuntime = computed(() => {
    return this.currentSystem()?.primaryRuntime ?? ('docker' as ContainerRuntime);
  });

  /**
   * Get available runtimes from the current system
   */
  readonly availableRuntimes = computed(() => {
    const system = this.currentSystem();
    return system?.availableRuntimes ?? [];
  });

  /**
   * Get the effective runtime (user-selected or default)
   */
  readonly effectiveRuntime = computed(() => {
    return this.selectedRuntime() ?? this.currentRuntime();
  });

  // Filtered templates based on search and current system's runtimes
  readonly filteredTemplates = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    let templates = this.commandState.templates();

    // Filter by current system's available runtimes
    const runtimes = this.availableRuntimes();
    if (runtimes.length > 0) {
      templates = templates.filter((t) => {
        if (t.compatibility.runtimes.length === 0) return true;
        return t.compatibility.runtimes.some((r) => runtimes.includes(r));
      });
    }

    if (!query) {
      // Show favorites first, then by category and name
      return templates.slice().sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        // Sort by category, then name
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return a.name.localeCompare(b.name);
      });
    }

    // Filter by search query
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        t.command.toLowerCase().includes(query) ||
        t.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  async ngOnInit(): Promise<void> {
    // Load templates if not already loaded
    if (this.commandState.templates().length === 0) {
      await this.commandState.loadTemplates();
    }

    // Focus search input
    setTimeout(() => {
      this.searchInput?.nativeElement?.focus();
    }, 100);
  }

  onSearchChange(query: string): void {
    this.searchQuery.set(query);
    this.selectedIndex.set(0);
  }

  onKeydown(event: KeyboardEvent): void {
    const templates = this.filteredTemplates();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update((i) => Math.min(i + 1, templates.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (templates.length > 0) {
          this.selectTemplate(templates[this.selectedIndex()], event.shiftKey);
        }
        break;
    }
  }

  selectTemplate(template: CommandTemplate, closeAfter = false): void {
    const variables = parseVariables(template.command);

    // Check if RUNTIME is the only variable - auto-substitute it
    const nonRuntimeVars = variables.filter((v) => v !== 'RUNTIME');

    if (nonRuntimeVars.length > 0) {
      // Has variables besides RUNTIME - emit for parent to handle variable input
      this.execute.emit({ command: template.command, template });
    } else {
      // No variables or only RUNTIME - auto-substitute and execute
      const command = substituteVariables(
        template.command,
        {},
        this.effectiveRuntime()
      );
      this.execute.emit({ command, template });
    }

    if (closeAfter) {
      this.close.emit();
    }
  }

  selectRuntime(runtime: ContainerRuntime): void {
    this.selectedRuntime.set(runtime);
  }

  onClose(): void {
    this.close.emit();
  }

  goToCommands(): void {
    this.close.emit();
    this.router.navigate(['/commands']);
  }

  getRuntimeIcon(runtime: ContainerRuntime): typeof Ship {
    switch (runtime) {
      case 'docker':
        return Ship;
      case 'podman':
        return Container;
      case 'apple':
        return Apple;
      default:
        return Container;
    }
  }

  async onToggleFavorite(event: Event, template: CommandTemplate): Promise<void> {
    event.stopPropagation();
    await this.commandState.toggleFavorite(template.id);
  }
}
