import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import {
  LucideAngularModule,
  Star,
  Copy,
  Trash2,
  Edit,
  MoreHorizontal,
  Ship,
  Container,
  Apple,
  Lock,
} from 'lucide-angular';
import {
  CommandTemplate,
  getCategoryIcon,
  getRuntimeLabel,
} from '../../../../core/models/command-template.model';
import { ContainerRuntime } from '../../../../core/models/container.model';

@Component({
  selector: 'app-command-card',
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div
      class="relative group bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 rounded-lg p-3 cursor-pointer transition-all"
      [class.ring-2]="selected()"
      [class.ring-blue-500]="selected()"
      [class.border-blue-500]="selected()"
    >
      <!-- Header -->
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="flex items-center gap-2 min-w-0">
          <button
            (click)="onToggleFavorite($event)"
            class="p-1 rounded hover:bg-zinc-700 transition-colors shrink-0"
            [class.text-yellow-500]="template().isFavorite"
            [class.text-zinc-500]="!template().isFavorite"
            title="Toggle favorite"
          >
            <lucide-icon [img]="Star" class="w-4 h-4" [class.fill-current]="template().isFavorite"></lucide-icon>
          </button>
          <h3 class="text-sm font-medium truncate">{{ template().name }}</h3>
        </div>

        <!-- Actions Menu -->
        <div class="relative shrink-0">
          <button
            (click)="toggleMenu($event)"
            class="p-1 rounded hover:bg-zinc-700 transition-colors text-zinc-500 hover:text-zinc-300 opacity-0 group-hover:opacity-100"
          >
            <lucide-icon [img]="MoreHorizontal" class="w-4 h-4"></lucide-icon>
          </button>

          @if (showMenu) {
            <div
              class="absolute right-0 top-8 z-10 w-36 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1"
              (click)="$event.stopPropagation()"
            >
              <button
                (click)="onEdit()"
                class="w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
              >
                <lucide-icon [img]="Edit" class="w-3.5 h-3.5"></lucide-icon>
                Edit
              </button>
              <button
                (click)="onDuplicate()"
                class="w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
              >
                <lucide-icon [img]="Copy" class="w-3.5 h-3.5"></lucide-icon>
                Duplicate
              </button>
              @if (!template().isBuiltIn) {
                <button
                  (click)="onDelete()"
                  class="w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-700 text-red-400 flex items-center gap-2"
                >
                  <lucide-icon [img]="Trash2" class="w-3.5 h-3.5"></lucide-icon>
                  Delete
                </button>
              }
            </div>
          }
        </div>
      </div>

      <!-- Description -->
      <p class="text-xs text-zinc-400 line-clamp-2 mb-2">{{ template().description }}</p>

      <!-- Command Preview -->
      <div class="bg-zinc-900/50 rounded px-2 py-1.5 mb-2">
        <code class="text-xs text-zinc-300 font-mono line-clamp-1">{{ template().command }}</code>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between gap-2">
        <!-- Runtime Icons -->
        <div class="flex items-center gap-1">
          @for (runtime of template().compatibility.runtimes; track runtime) {
            <span
              class="text-xs px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400"
              [title]="getRuntimeLabel(runtime)"
            >
              <lucide-icon [img]="getRuntimeIcon(runtime)" class="w-3 h-3"></lucide-icon>
            </span>
          }
          @if (template().compatibility.runtimes.length === 0) {
            <span class="text-xs text-zinc-500">All runtimes</span>
          }
        </div>

        <!-- Built-in Badge -->
        @if (template().isBuiltIn) {
          <span class="flex items-center gap-1 text-xs text-zinc-500" title="Built-in command">
            <lucide-icon [img]="Lock" class="w-3 h-3"></lucide-icon>
          </span>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'closeMenu()',
  },
})
export class CommandCardComponent {
  readonly template = input.required<CommandTemplate>();
  readonly selected = input(false);

  readonly toggleFavorite = output<CommandTemplate>();
  readonly duplicate = output<CommandTemplate>();
  readonly delete = output<CommandTemplate>();
  readonly edit = output<CommandTemplate>();

  // Icons
  readonly Star = Star;
  readonly Copy = Copy;
  readonly Trash2 = Trash2;
  readonly Edit = Edit;
  readonly MoreHorizontal = MoreHorizontal;
  readonly Ship = Ship;
  readonly Container = Container;
  readonly Apple = Apple;
  readonly Lock = Lock;

  readonly getCategoryIcon = getCategoryIcon;
  readonly getRuntimeLabel = getRuntimeLabel;

  showMenu = false;

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

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.showMenu = !this.showMenu;
  }

  closeMenu(): void {
    this.showMenu = false;
  }

  onToggleFavorite(event: Event): void {
    event.stopPropagation();
    this.toggleFavorite.emit(this.template());
  }

  onEdit(): void {
    this.showMenu = false;
    this.edit.emit(this.template());
  }

  onDuplicate(): void {
    this.showMenu = false;
    this.duplicate.emit(this.template());
  }

  onDelete(): void {
    this.showMenu = false;
    this.delete.emit(this.template());
  }
}
