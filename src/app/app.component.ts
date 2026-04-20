import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { MainLayoutComponent } from './layout/main-layout/main-layout.component';
import { CommandPaletteComponent } from './shared/components/command-palette/command-palette.component';
import { ToastContainerComponent } from './shared/components/toast-container/toast-container.component';
import { CommandTemplate } from './core/models/command-template.model';
import { PermissionsWsService } from './core/services/permissions-ws.service';
import { SystemState } from './state/system.state';
import { ToastState } from './state/toast.state';

@Component({
  selector: 'app-root',
  imports: [MainLayoutComponent, CommandPaletteComponent, ToastContainerComponent],
  template: `
    <app-main-layout></app-main-layout>
    <app-toast-container />

    @if (showCommandPalette()) {
      <app-command-palette
        (close)="closeCommandPalette()"
        (execute)="onCommandExecute($event)"
      />
    }
  `,
  host: {
    '(document:keydown)': 'onKeyDown($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private readonly systemState = inject(SystemState);
  private readonly toast = inject(ToastState);
  // CON-122: construct the permissions WS service at bootstrap so its
  // effect() starts watching BackendService.connections immediately.
  // The service opens/tears down per-connection sockets on its own.
  private readonly _permissionsWs = inject(PermissionsWsService);
  readonly showCommandPalette = signal(false);
  private previousStates = new Map<string, string>();

  constructor() {
    // Watch for connection state changes and show toasts
    effect(() => {
      const systems = this.systemState.systems();
      const states = this.systemState.connectionStates();

      for (const system of systems) {
        const state = states[system.id] ?? 'disconnected';
        const prev = this.previousStates.get(system.id);

        if (prev && prev !== state) {
          if (state === 'connected') {
            this.toast.success(`${system.name} connected`);
          } else if (state === 'disconnected' && prev === 'connected') {
            this.toast.warning(`${system.name} disconnected`);
          } else if (state === 'error') {
            this.toast.error(`${system.name} connection failed`);
          }
        }

        this.previousStates.set(system.id, state);
      }
    });
  }

  onKeyDown(event: KeyboardEvent): void {
    // Ctrl+K or Cmd+K to open command palette
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      this.showCommandPalette.set(true);
    }
  }

  closeCommandPalette(): void {
    this.showCommandPalette.set(false);
  }

  onCommandExecute(event: { command: string; template: CommandTemplate }): void {
    // For now, just close the palette
    // Terminal integration will be added in Phase 5
    console.log('Execute command:', event.command, event.template);
    this.showCommandPalette.set(false);
  }
}
