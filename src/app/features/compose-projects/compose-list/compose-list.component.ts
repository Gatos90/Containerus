import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Search,
  RefreshCw,
  Layers,
  SlidersHorizontal,
} from 'lucide-angular';
import { ComposeState } from '../../../state/compose.state';
import { ContainerState } from '../../../state/container.state';
import { SystemState } from '../../../state/system.state';
import { ComposeProjectCardComponent } from '../components/compose-project-card/compose-project-card.component';
import { ComposeProject } from '../../../core/models/compose.model';

@Component({
  selector: 'app-compose-list',
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    ComposeProjectCardComponent,
  ],
  templateUrl: './compose-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComposeListComponent implements OnInit {
  readonly composeState = inject(ComposeState);
  readonly containerState = inject(ContainerState);
  readonly systemState = inject(SystemState);

  readonly Search = Search;
  readonly RefreshCw = RefreshCw;
  readonly Layers = Layers;
  readonly SlidersHorizontal = SlidersHorizontal;

  readonly showMobileFilters = signal(false);
  refreshing = false;

  /** Projects grouped by systemId, post-filter */
  readonly filteredProjectsBySystem = computed(() => {
    const filtered = this.composeState.filteredProjects();
    const grouped: Record<string, ComposeProject[]> = {};
    for (const project of filtered) {
      if (!grouped[project.systemId]) {
        grouped[project.systemId] = [];
      }
      grouped[project.systemId].push(project);
    }
    return grouped;
  });

  async ngOnInit(): Promise<void> {
    // Containers are the source of truth for compose discovery.
    // Load them for every connected system if not already loaded.
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      const systemIds = this.systemState.connectedSystems().map((s) => s.id);
      await Promise.all(
        systemIds.map((id) => this.containerState.loadContainers(id)),
      );
    } finally {
      this.refreshing = false;
    }
  }
}
