import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BackendService } from '../../../core/services/backend.service';
import { PermissionBannerState } from '../../../state/permission-banner.state';
import { ToastState } from '../../../state/toast.state';

/**
 * In-page banner shown after a local role/ACL mutation. CON-126 §4.7 stop-gap
 * until CON-122 pushes invalidations from the server. Renders as an
 * `aria-live="polite"` region so SR users hear it without being yanked out of
 * whatever list they were reviewing.
 */
@Component({
  selector: 'app-permission-banner',
  standalone: true,
  templateUrl: './permission-banner.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionBannerComponent {
  private readonly backend = inject(BackendService);
  private readonly banner = inject(PermissionBannerState);
  private readonly toast = inject(ToastState);

  readonly visible = this.banner.visible;

  readonly connectionLabel = computed<string>(() => {
    const id = this.banner.connectionId();
    if (!id) return '';
    return this.backend.getConnection(id)?.label ?? '';
  });

  async refresh(): Promise<void> {
    const id = this.banner.connectionId();
    if (!id) {
      this.banner.dismiss();
      return;
    }
    try {
      await this.backend.refreshPermissionsFor(id);
      this.toast.success('Permissions refreshed.');
    } catch {
      this.toast.error('Failed to refresh permissions.');
    } finally {
      this.banner.dismiss();
    }
  }

  dismiss(): void {
    this.banner.dismiss();
  }
}
