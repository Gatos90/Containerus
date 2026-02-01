import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Search,
  RefreshCw,
  Plus,
  Star,
  Circle,
  SlidersHorizontal,
  Package,
  Bug,
  Network,
  Terminal,
  Copy,
  Trash2,
  Play,
  Edit,
  ChevronDown,
  ChevronRight,
  Command,
  Layers,
  HardDrive,
  Settings,
  Boxes,
} from 'lucide-angular';
import {
  CommandTemplate,
  CommandCategory,
  getCategoryLabel,
  getCategoryIcon,
  getRuntimeLabel,
} from '../../../core/models/command-template.model';
import { CommandTemplateState } from '../../../state/command-template.state';
import { SystemState } from '../../../state/system.state';
import { CommandCardComponent } from '../components/command-card/command-card.component';
import { CommandDetailPanelComponent } from '../components/command-detail-panel/command-detail-panel.component';
import { CommandFormModalComponent } from '../components/command-form-modal/command-form-modal.component';

type CategoryInfo = {
  key: CommandCategory;
  label: string;
  icon: typeof Package;
  count: number;
  collapsed: boolean;
};

@Component({
  selector: 'app-command-list',
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    CommandCardComponent,
    CommandDetailPanelComponent,
    CommandFormModalComponent,
  ],
  templateUrl: './command-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-full min-w-0',
  },
})
export class CommandListComponent implements OnInit {
  readonly commandState = inject(CommandTemplateState);
  readonly systemState = inject(SystemState);

  // Icons
  readonly Search = Search;
  readonly RefreshCw = RefreshCw;
  readonly Plus = Plus;
  readonly Star = Star;
  readonly Circle = Circle;
  readonly SlidersHorizontal = SlidersHorizontal;
  readonly Package = Package;
  readonly Bug = Bug;
  readonly Network = Network;
  readonly Terminal = Terminal;
  readonly Copy = Copy;
  readonly Trash2 = Trash2;
  readonly Play = Play;
  readonly Edit = Edit;
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly Command = Command;
  readonly Layers = Layers;
  readonly HardDrive = HardDrive;
  readonly Settings = Settings;
  readonly Boxes = Boxes;

  // Utility functions
  readonly getCategoryLabel = getCategoryLabel;
  readonly getCategoryIcon = getCategoryIcon;
  readonly getRuntimeLabel = getRuntimeLabel;

  // UI state
  readonly showMobileFilters = signal(false);
  readonly showCreateModal = signal(false);
  readonly editingTemplate = signal<CommandTemplate | null>(null);
  readonly collapsedCategories = signal<Set<CommandCategory>>(new Set());
  refreshing = false;

  // Category icon mapping
  readonly categoryIcons: Record<CommandCategory, typeof Package> = {
    'container-management': Package,
    debugging: Bug,
    networking: Network,
    images: Layers,
    volumes: HardDrive,
    system: Settings,
    pods: Boxes,
    custom: Terminal,
  };

  // Computed categories with counts
  readonly categories = computed<CategoryInfo[]>(() => {
    const counts = this.commandState.categoryCounts();
    const collapsed = this.collapsedCategories();

    return [
      {
        key: 'container-management' as CommandCategory,
        label: 'Container Management',
        icon: Package,
        count: counts['container-management'],
        collapsed: collapsed.has('container-management'),
      },
      {
        key: 'debugging' as CommandCategory,
        label: 'Debugging',
        icon: Bug,
        count: counts.debugging,
        collapsed: collapsed.has('debugging'),
      },
      {
        key: 'networking' as CommandCategory,
        label: 'Networking',
        icon: Network,
        count: counts.networking,
        collapsed: collapsed.has('networking'),
      },
      {
        key: 'images' as CommandCategory,
        label: 'Images',
        icon: Layers,
        count: counts.images,
        collapsed: collapsed.has('images'),
      },
      {
        key: 'volumes' as CommandCategory,
        label: 'Volumes',
        icon: HardDrive,
        count: counts.volumes,
        collapsed: collapsed.has('volumes'),
      },
      {
        key: 'system' as CommandCategory,
        label: 'System',
        icon: Settings,
        count: counts.system,
        collapsed: collapsed.has('system'),
      },
      {
        key: 'pods' as CommandCategory,
        label: 'Pods',
        icon: Boxes,
        count: counts.pods,
        collapsed: collapsed.has('pods'),
      },
      {
        key: 'custom' as CommandCategory,
        label: 'Custom',
        icon: Terminal,
        count: counts.custom,
        collapsed: collapsed.has('custom'),
      },
    ];
  });

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      await this.commandState.loadTemplates();
    } finally {
      this.refreshing = false;
    }
  }

  toggleCategory(category: CommandCategory): void {
    this.collapsedCategories.update((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  openCreateModal(): void {
    this.editingTemplate.set(null);
    this.showCreateModal.set(true);
  }

  openEditModal(template: CommandTemplate): void {
    this.editingTemplate.set(template);
    this.showCreateModal.set(true);
  }

  closeModal(): void {
    this.showCreateModal.set(false);
    this.editingTemplate.set(null);
  }

  async onToggleFavorite(template: CommandTemplate): Promise<void> {
    await this.commandState.toggleFavorite(template.id);
  }

  async onDuplicate(template: CommandTemplate): Promise<void> {
    await this.commandState.duplicateTemplate(template.id);
  }

  async onDelete(template: CommandTemplate): Promise<void> {
    if (template.isBuiltIn) {
      return;
    }
    if (confirm(`Delete "${template.name}"? This action cannot be undone.`)) {
      await this.commandState.deleteTemplate(template.id);
    }
  }

  selectTemplate(template: CommandTemplate): void {
    this.commandState.selectTemplate(template.id);
  }

  clearSelection(): void {
    this.commandState.selectTemplate(null);
  }

  onCategoryFilterChange(value: string): void {
    if (value === 'all') {
      this.commandState.setCategoryFilter(null);
      this.commandState.setShowFavoritesOnly(false);
    } else if (value === 'favorites') {
      this.commandState.setCategoryFilter(null);
      this.commandState.setShowFavoritesOnly(true);
    } else {
      this.commandState.setCategoryFilter(value as CommandCategory);
      this.commandState.setShowFavoritesOnly(false);
    }
  }
}
