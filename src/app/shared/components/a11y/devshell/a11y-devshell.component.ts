import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  signal,
  viewChild,
  TemplateRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConnectionBadgeComponent } from '../connection-badge/connection-badge.component';
import { StatusChipComponent } from '../status-chip/status-chip.component';
import { DrawerDialogComponent } from '../drawer-dialog/drawer-dialog.component';
import { VirtualGridComponent } from '../virtual-grid/virtual-grid.component';
import { ListStatesComponent } from '../list-states/list-states.component';
import { PermissionKeyComponent } from '../permission-key/permission-key.component';
import { PermissionCatalogService } from '../permission-key/permission-catalog.service';
import { MfaCodeInputComponent } from '../mfa-code-input/mfa-code-input.component';

interface DemoRow {
  id: number;
  actor: string;
  action: string;
}

/**
 * Development-only storybook for the §5 a11y library. Mounted at
 * `/a11y-devshell`, it demonstrates each component across its
 * loading / empty / error / interactive states so the AccessibilitySpecialist
 * can sign off by driving the actual rendered UI with NVDA / VoiceOver.
 */
@Component({
  selector: 'app-a11y-devshell',
  standalone: true,
  imports: [
    CommonModule,
    ConnectionBadgeComponent,
    StatusChipComponent,
    DrawerDialogComponent,
    VirtualGridComponent,
    ListStatesComponent,
    PermissionKeyComponent,
    MfaCodeInputComponent,
  ],
  templateUrl: './a11y-devshell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class A11yDevshellComponent {
  private readonly catalog = inject(PermissionCatalogService);

  readonly drawerOpen = signal(false);
  readonly drawerDirty = signal(false);
  readonly drawerTrigger = viewChild<ElementRef<HTMLButtonElement>>('drawerTrigger');

  readonly listMode = signal<'loading' | 'empty' | 'error' | 'idle'>('idle');
  readonly gridTemplate = viewChild.required<TemplateRef<{ $implicit: DemoRow }>>('gridTemplate');

  readonly rows: DemoRow[] = Array.from({ length: 5000 }, (_, i) => ({
    id: i,
    actor: `user-${i % 17}`,
    action: i % 3 === 0 ? 'container:exec' : 'cluster:read',
  }));

  constructor() {
    // Seed the permission catalog so the PermissionKey demo shows popovers
    // even without a live server.
    this.catalog.seed({
      'container:exec': 'Open a shell session inside any container on this system.',
      'cluster:read': 'View Kubernetes cluster state — read-only access to pods, services, events.',
    });
  }

  openDrawer(event: MouseEvent): void {
    (event.currentTarget as HTMLElement).focus();
    this.drawerOpen.set(true);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  confirmDiscard(): void {
    this.drawerDirty.set(false);
    this.drawerOpen.set(false);
  }

  onMfaCode(code: string): void {
    console.info('[a11y-devshell] MFA code entered:', code);
  }
}
