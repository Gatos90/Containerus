import { Component, signal } from '@angular/core';
import { MainLayoutComponent } from './layout/main-layout/main-layout.component';
import { CommandPaletteComponent } from './shared/components/command-palette/command-palette.component';
import { CommandTemplate } from './core/models/command-template.model';

@Component({
  selector: 'app-root',
  imports: [MainLayoutComponent, CommandPaletteComponent],
  template: `
    <app-main-layout></app-main-layout>

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
})
export class AppComponent {
  readonly showCommandPalette = signal(false);

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
