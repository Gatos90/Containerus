import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Link,
  ArrowLeftRight,
  X,
  Radio,
  Loader2,
} from 'lucide-angular';
import { PortMapping } from '../../../../core/models/container.model';
import { PortForwardState } from '../../../../state/port-forward.state';

@Component({
  selector: 'app-port-badge',
  imports: [LucideAngularModule],
  templateUrl: './port-badge.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortBadgeComponent {
  private portForwardState = inject(PortForwardState);

  port = input.required<PortMapping>();
  containerId = input.required<string>();
  systemId = input.required<string>();

  readonly Link = Link;
  readonly ArrowLeftRight = ArrowLeftRight;
  readonly X = X;
  readonly Radio = Radio;
  readonly Loader2 = Loader2;

  private _localLoading = signal(false);

  isForwarded = computed(() =>
    this.portForwardState.isPortForwarded(
      this.containerId(),
      this.port().containerPort
    )
  );

  activeForward = computed(() =>
    this.portForwardState.getForward(
      this.containerId(),
      this.port().containerPort
    )
  );

  loading = computed(() => {
    return (
      this._localLoading() ||
      this.portForwardState.isLoading(
        this.containerId(),
        this.port().containerPort
      )
    );
  });

  async toggleForward(): Promise<void> {
    if (this.isForwarded()) {
      const forward = this.portForwardState.getForward(
        this.containerId(),
        this.port().containerPort
      );
      if (forward) {
        await this.portForwardState.stopForward(forward.id);
      }
    } else {
      this._localLoading.set(true);
      try {
        await this.portForwardState.createForward({
          systemId: this.systemId(),
          containerId: this.containerId(),
          containerPort: this.port().containerPort,
          hostPort: this.port().hostPort,
          localPort: this.port().hostPort,
          protocol: this.port().protocol,
          remoteHost: this.port().hostIp || 'localhost', // Use actual bind address (e.g., 127.0.1.1 for rootless Podman)
        });
      } finally {
        this._localLoading.set(false);
      }
    }
  }

  async openInBrowser(): Promise<void> {
    if (!this.isForwarded()) return;

    const forward = this.portForwardState.getForward(
      this.containerId(),
      this.port().containerPort
    );
    if (forward) {
      await this.portForwardState.openInBrowser(forward.id);
    }
  }
}
