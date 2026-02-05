import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { AppState } from '../../state/app.state';
import { AiSettingsState } from '../../state/ai-settings.state';
import { TerminalState } from '../../state/terminal.state';
import { TerminalWorkspaceComponent } from '../../shared/components/terminal-workspace/terminal-workspace.component';

@Component({
  selector: 'app-main-layout',
  imports: [CommonModule, RouterOutlet, SidebarComponent, TerminalWorkspaceComponent],
  templateUrl: './main-layout.component.html',
})
export class MainLayoutComponent implements OnInit {
  readonly appState = inject(AppState);
  private aiSettingsState = inject(AiSettingsState);
  readonly terminalState = inject(TerminalState);
  private router = inject(Router);

  private currentUrl = signal(this.router.url);

  readonly isTerminalRoute = computed(() => {
    return this.currentUrl().startsWith('/terminal');
  });

  readonly showTerminalWorkspace = computed(() => {
    return this.terminalState.isDockVisible() && !this.isTerminalRoute();
  });

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects);
      });
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.appState.initialize(),
      this.aiSettingsState.init(),
    ]);
  }
}
