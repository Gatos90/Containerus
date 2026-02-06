import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import {
  LucideAngularModule,
  X,
  Terminal,
  FileText,
  FolderOpen,
} from 'lucide-angular';
import {
  Container,
  getDisplayName,
  getStatusText,
  isRunning,
} from '../../../../core/models/container.model';
import { ContainerDetailsComponent } from '../container-details/container-details.component';
import { TerminalState, DockedFileBrowser, DEFAULT_TERMINAL_OPTIONS } from '../../../../state/terminal.state';
import { TerminalService } from '../../../../core/services/terminal.service';
import { SystemState } from '../../../../state/system.state';
import { ToastState } from '../../../../state/toast.state';

@Component({
  selector: 'app-container-detail-modal',
  imports: [LucideAngularModule, ContainerDetailsComponent],
  templateUrl: './container-detail-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainerDetailModalComponent {
  private readonly terminalState = inject(TerminalState);
  private readonly terminalService = inject(TerminalService);
  private readonly systemState = inject(SystemState);
  private readonly toast = inject(ToastState);

  container = input.required<Container>();

  close = output<void>();
  viewLogs = output<void>();

  readonly X = X;
  readonly Terminal = Terminal;
  readonly FileText = FileText;
  readonly FolderOpen = FolderOpen;

  readonly getDisplayName = getDisplayName;
  readonly getStatusText = getStatusText;
  readonly isRunning = isRunning;

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }

  async dockTerminal(): Promise<void> {
    const c = this.container();
    const system = this.systemState.systems().find(s => s.id === c.systemId);
    if (!system) return;
    try {
      const session = await this.terminalService.startSession(c.systemId, c.id);
      this.terminalState.addTerminal({
        id: this.terminalState.generateTerminalId(),
        session,
        systemId: c.systemId,
        systemName: system.name,
        containerName: getDisplayName(c),
        serializedState: '',
        terminalOptions: DEFAULT_TERMINAL_OPTIONS,
      });
      this.close.emit();
    } catch (err: any) {
      this.toast.error(`Failed to open terminal: ${err?.message ?? err}`);
    }
  }

  dockFileBrowser(): void {
    const c = this.container();
    const system = this.systemState.systems().find(s => s.id === c.systemId);
    if (!system) return;
    const fb: DockedFileBrowser = {
      id: this.terminalState.generateFileBrowserId(),
      systemId: c.systemId,
      systemName: system.name,
      containerId: c.id,
      containerName: getDisplayName(c),
      runtime: c.runtime,
      currentPath: '/',
    };
    this.terminalState.addFileBrowser(fb);
    this.close.emit();
  }
}
