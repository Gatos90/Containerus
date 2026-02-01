import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Network, Copy, Settings, ChevronDown, ChevronUp } from 'lucide-angular';
import { PortMapping } from '../../../../core/models/container.model';
import { ClipboardService } from '../../../../core/services/clipboard.service';
import { PortBadgeComponent } from '../port-badge/port-badge.component';

@Component({
  selector: 'app-port-section',
  imports: [LucideAngularModule, PortBadgeComponent],
  templateUrl: './port-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortSectionComponent {
  private clipboard = inject(ClipboardService);

  ports = input.required<PortMapping[]>();
  containerId = input.required<string>();
  systemId = input.required<string>();
  showManageButton = input(false);

  manageForwards = output<void>();

  readonly Network = Network;
  readonly Copy = Copy;
  readonly Settings = Settings;
  readonly ChevronDown = ChevronDown;
  readonly ChevronUp = ChevronUp;

  // Collapse threshold - show expand/collapse when more than this many ports
  readonly COLLAPSE_THRESHOLD = 2;

  // Track expanded state
  readonly expanded = signal(false);

  // Whether we need to show expand/collapse controls
  readonly isCollapsible = computed(() => this.ports().length > this.COLLAPSE_THRESHOLD);

  // Ports to display based on expanded state
  readonly visiblePorts = computed(() => {
    const allPorts = this.ports();
    if (!this.isCollapsible() || this.expanded()) {
      return allPorts;
    }
    return allPorts.slice(0, this.COLLAPSE_THRESHOLD);
  });

  // Number of hidden ports
  readonly hiddenCount = computed(() => {
    if (!this.isCollapsible() || this.expanded()) {
      return 0;
    }
    return this.ports().length - this.COLLAPSE_THRESHOLD;
  });

  toggleExpanded(): void {
    this.expanded.update(v => !v);
  }

  async copyAllPorts(): Promise<void> {
    await this.clipboard.copyPorts(this.ports());
  }
}
