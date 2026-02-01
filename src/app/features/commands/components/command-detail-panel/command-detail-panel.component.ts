import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import {
  LucideAngularModule,
  X,
  Star,
  Copy,
  Trash2,
  Edit,
  Play,
  Ship,
  Container,
  Apple,
  Lock,
  Tag,
  Variable,
  Globe,
} from 'lucide-angular';
import {
  CommandTemplate,
  getCategoryLabel,
  getCategoryIcon,
  getRuntimeLabel,
  parseVariables,
} from '../../../../core/models/command-template.model';
import { ContainerRuntime } from '../../../../core/models/container.model';

@Component({
  selector: 'app-command-detail-panel',
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="h-full flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-zinc-800">
        <div class="flex items-center gap-2">
          <button
            (click)="onToggleFavorite()"
            class="p-1.5 rounded hover:bg-zinc-800 transition-colors"
            [class.text-yellow-500]="template().isFavorite"
            [class.text-zinc-500]="!template().isFavorite"
            title="Toggle favorite"
          >
            <lucide-icon [img]="Star" class="w-5 h-5" [class.fill-current]="template().isFavorite"></lucide-icon>
          </button>
          <h2 class="text-lg font-semibold truncate">{{ template().name }}</h2>
        </div>
        <button
          (click)="close.emit()"
          class="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <lucide-icon [img]="X" class="w-5 h-5"></lucide-icon>
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <!-- Description -->
        <div>
          <p class="text-sm text-zinc-400">{{ template().description }}</p>
        </div>

        <!-- Category & Tags -->
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400">
            {{ getCategoryLabel(template().category) }}
          </span>
          @for (tag of template().tags; track tag) {
            <span class="text-xs px-2 py-1 rounded-full bg-zinc-700 text-zinc-400">
              {{ tag }}
            </span>
          }
        </div>

        <!-- Command Section -->
        <div class="space-y-2">
          <h3 class="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <lucide-icon [img]="Play" class="w-4 h-4 text-zinc-500"></lucide-icon>
            Command
          </h3>
          <div class="bg-zinc-800 rounded-lg p-3">
            <code class="text-sm text-green-400 font-mono whitespace-pre-wrap break-all">{{ template().command }}</code>
          </div>
        </div>

        <!-- Variables Section -->
        @if (template().variables.length > 0) {
          <div class="space-y-2">
            <h3 class="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <lucide-icon [img]="Variable" class="w-4 h-4 text-zinc-500"></lucide-icon>
              Template Variables
            </h3>
            <div class="space-y-2">
              @for (variable of template().variables; track variable.name) {
                <div class="bg-zinc-800/50 rounded-lg p-3">
                  <div class="flex items-center justify-between mb-1">
                    <code class="text-sm text-yellow-400 font-mono">\${{ '{' }}{{ variable.name }}{{ '}' }}</code>
                    @if (variable.required) {
                      <span class="text-xs text-red-400">Required</span>
                    }
                  </div>
                  <p class="text-xs text-zinc-400">{{ variable.description }}</p>
                  @if (variable.defaultValue) {
                    <p class="text-xs text-zinc-500 mt-1">Default: {{ variable.defaultValue }}</p>
                  }
                </div>
              }
            </div>
          </div>
        }

        <!-- Detected Variables (if not defined) -->
        @if (detectedVariables.length > 0 && template().variables.length === 0) {
          <div class="space-y-2">
            <h3 class="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <lucide-icon [img]="Variable" class="w-4 h-4 text-zinc-500"></lucide-icon>
              Detected Variables
            </h3>
            <div class="flex flex-wrap gap-2">
              @for (v of detectedVariables; track v) {
                <code class="text-xs px-2 py-1 rounded bg-zinc-800 text-yellow-400 font-mono">\${{ '{' }}{{ v }}{{ '}' }}</code>
              }
            </div>
          </div>
        }

        <!-- Compatibility Section -->
        <div class="space-y-2">
          <h3 class="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <lucide-icon [img]="Globe" class="w-4 h-4 text-zinc-500"></lucide-icon>
            Compatibility
          </h3>
          <div class="space-y-2">
            <div>
              <span class="text-xs text-zinc-500">Runtimes:</span>
              <div class="flex items-center gap-2 mt-1">
                @if (template().compatibility.runtimes.length === 0) {
                  <span class="text-sm text-zinc-400">All runtimes</span>
                } @else {
                  @for (runtime of template().compatibility.runtimes; track runtime) {
                    <span
                      class="flex items-center gap-1 text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300"
                    >
                      <lucide-icon [img]="getRuntimeIcon(runtime)" class="w-3 h-3"></lucide-icon>
                      {{ getRuntimeLabel(runtime) }}
                    </span>
                  }
                }
              </div>
            </div>
            @if (template().compatibility.systemIds && template().compatibility.systemIds!.length > 0) {
              <div>
                <span class="text-xs text-zinc-500">Systems:</span>
                <p class="text-sm text-zinc-400 mt-1">
                  {{ template().compatibility.systemIds!.length }} specific system(s)
                </p>
              </div>
            }
          </div>
        </div>

        <!-- Metadata -->
        <div class="text-xs text-zinc-500 space-y-1 pt-2 border-t border-zinc-800">
          @if (template().isBuiltIn) {
            <div class="flex items-center gap-1">
              <lucide-icon [img]="Lock" class="w-3 h-3"></lucide-icon>
              Built-in command
            </div>
          }
          <p>Created: {{ formatDate(template().createdAt) }}</p>
          <p>Updated: {{ formatDate(template().updatedAt) }}</p>
        </div>
      </div>

      <!-- Actions -->
      <div class="p-4 border-t border-zinc-800 space-y-2">
        <button
          (click)="onEdit()"
          class="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors"
        >
          <lucide-icon [img]="Edit" class="w-4 h-4"></lucide-icon>
          Edit
        </button>
        <div class="flex gap-2">
          <button
            (click)="onDuplicate()"
            class="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            <lucide-icon [img]="Copy" class="w-4 h-4"></lucide-icon>
            Duplicate
          </button>
          @if (!template().isBuiltIn) {
            <button
              (click)="onDelete()"
              class="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 transition-colors"
            >
              <lucide-icon [img]="Trash2" class="w-4 h-4"></lucide-icon>
              Delete
            </button>
          }
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandDetailPanelComponent {
  readonly template = input.required<CommandTemplate>();

  readonly close = output<void>();
  readonly edit = output<CommandTemplate>();
  readonly duplicate = output<CommandTemplate>();
  readonly delete = output<CommandTemplate>();
  readonly toggleFavorite = output<CommandTemplate>();

  // Icons
  readonly X = X;
  readonly Star = Star;
  readonly Copy = Copy;
  readonly Trash2 = Trash2;
  readonly Edit = Edit;
  readonly Play = Play;
  readonly Ship = Ship;
  readonly Container = Container;
  readonly Apple = Apple;
  readonly Lock = Lock;
  readonly Tag = Tag;
  readonly Variable = Variable;
  readonly Globe = Globe;

  readonly getCategoryLabel = getCategoryLabel;
  readonly getCategoryIcon = getCategoryIcon;
  readonly getRuntimeLabel = getRuntimeLabel;

  get detectedVariables(): string[] {
    return parseVariables(this.template().command);
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

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  onToggleFavorite(): void {
    this.toggleFavorite.emit(this.template());
  }

  onEdit(): void {
    this.edit.emit(this.template());
  }

  onDuplicate(): void {
    this.duplicate.emit(this.template());
  }

  onDelete(): void {
    this.delete.emit(this.template());
  }
}
