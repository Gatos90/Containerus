import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { AppState } from '../../state/app.state';
import { AiSettingsState } from '../../state/ai-settings.state';
import { TerminalState } from '../../state/terminal.state';
import { UpdateState } from '../../state/update.state';
import { ChangelogState } from '../../state/changelog.state';
import { TerminalWorkspaceComponent } from '../../shared/components/terminal-workspace/terminal-workspace.component';
import { WhatsNewModalComponent } from '../../shared/components/whats-new-modal/whats-new-modal.component';

@Component({
  selector: 'app-main-layout',
  imports: [CommonModule, RouterOutlet, SidebarComponent, TerminalWorkspaceComponent, WhatsNewModalComponent],
  templateUrl: './main-layout.component.html',
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  readonly appState = inject(AppState);
  private aiSettingsState = inject(AiSettingsState);
  readonly terminalState = inject(TerminalState);
  readonly updateState = inject(UpdateState);
  readonly changelogState = inject(ChangelogState);
  private router = inject(Router);

  private currentUrl = signal(this.router.url);

  readonly isTerminalRoute = computed(() => {
    return this.currentUrl().startsWith('/terminal');
  });

  readonly showTerminalWorkspace = computed(() => {
    return !this.isTerminalRoute();
  });

  readonly showDockGrid = computed(() => {
    return this.terminalState.hasDockedItems() && !this.isTerminalRoute();
  });

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects);
      });
  }

  private resizing = false;
  private containerEl: HTMLElement | null = null;

  private boundOnMouseMove = this.onResizeMove.bind(this);
  private boundOnMouseUp = this.onResizeEnd.bind(this);

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.appState.initialize(),
      this.aiSettingsState.init(),
    ]);
    // Check for updates after app is initialized (non-blocking)
    this.updateState.checkForUpdate();
    // Show "What's New" if version changed since last seen
    this.changelogState.checkForChangelog();
  }

  ngOnDestroy(): void {
    this.onResizeEnd();
  }

  onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    this.resizing = true;
    this.containerEl = (event.target as HTMLElement).parentElement;
    document.addEventListener('mousemove', this.boundOnMouseMove);
    document.addEventListener('mouseup', this.boundOnMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }

  private onResizeMove(event: MouseEvent): void {
    if (!this.resizing || !this.containerEl) return;
    const rect = this.containerEl.getBoundingClientRect();
    const totalHeight = rect.height;
    const offsetFromTop = event.clientY - rect.top;
    const contentPercent = (offsetFromTop / totalHeight) * 100;
    const dockPercent = 100 - contentPercent;
    this.terminalState.setDockHeightPercent(dockPercent);
  }

  private onResizeEnd(): void {
    if (!this.resizing) return;
    this.resizing = false;
    this.containerEl = null;
    document.removeEventListener('mousemove', this.boundOnMouseMove);
    document.removeEventListener('mouseup', this.boundOnMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
}
