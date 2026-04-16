import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  X,
  Monitor,
  Server,
  Cloud,
  ChevronRight,
  ChevronLeft,
  Check,
  Loader,
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Wifi,
} from 'lucide-angular';
import { LucideIconData } from 'lucide-angular';
import { SystemService } from '../../../core/services/system.service';
import { NewSystemRequest, SshAuthMethod } from '../../../core/models/system.model';

export type WizardConnectionType = 'local' | 'remote-ssh' | 'backend';

interface ConnectionOption {
  id: WizardConnectionType;
  label: string;
  subtitle: string;
  icon: LucideIconData;
  badge?: string;
}

@Component({
  selector: 'app-setup-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './setup-wizard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onCancel()',
  },
})
export class SetupWizardComponent {
  private readonly systemService = inject(SystemService);

  readonly completed = output<void>();
  readonly cancelled = output<void>();

  // Icons
  readonly X = X;
  readonly Monitor = Monitor;
  readonly Server = Server;
  readonly Cloud = Cloud;
  readonly ChevronRight = ChevronRight;
  readonly ChevronLeft = ChevronLeft;
  readonly Check = Check;
  readonly Loader = Loader;
  readonly AlertCircle = AlertCircle;
  readonly Eye = Eye;
  readonly EyeOff = EyeOff;
  readonly KeyRound = KeyRound;
  readonly Lock = Lock;
  readonly Wifi = Wifi;

  // Wizard state
  readonly step = signal<1 | 2 | 3>(1);
  readonly connectionType = signal<WizardConnectionType | null>(null);
  readonly verifying = signal(false);
  readonly verifyError = signal<string | null>(null);
  readonly verifySuccess = signal(false);
  readonly showPassword = signal(false);
  readonly showPassphrase = signal(false);

  // Form fields
  systemName = '';
  hostname = '';
  port = 22;
  username = '';
  authMethod: SshAuthMethod = 'password';
  password = '';
  privateKeyContent = '';
  passphrase = '';
  backendUrl = '';
  backendToken = '';

  readonly connectionOptions: ConnectionOption[] = [
    {
      id: 'local',
      label: 'Local Docker',
      subtitle: 'Connect to Docker running on this machine',
      icon: Monitor,
    },
    {
      id: 'remote-ssh',
      label: 'Remote SSH',
      subtitle: 'Connect to a remote host via SSH tunnel',
      icon: Server,
    },
    {
      id: 'backend',
      label: 'Backend Server',
      subtitle: 'Connect to a Containerus backend deployment',
      icon: Cloud,
      badge: 'Enterprise',
    },
  ];

  readonly isStep2Valid = computed(() => {
    const type = this.connectionType();
    if (!type) return false;
    if (type === 'local') return this.systemName.trim().length > 0;
    if (type === 'remote-ssh') {
      const hasAuth = this.authMethod === 'password'
        ? this.password.length > 0
        : this.privateKeyContent.trim().length > 0;
      return this.systemName.trim().length > 0 && this.hostname.trim().length > 0 && this.username.trim().length > 0 && hasAuth;
    }
    if (type === 'backend') {
      return this.systemName.trim().length > 0 && this.backendUrl.trim().length > 0;
    }
    return false;
  });

  readonly stepLabels = ['Connection type', 'Credentials', 'Verify'];

  selectType(type: WizardConnectionType): void {
    this.connectionType.set(type);
    if (type === 'local') {
      this.hostname = 'localhost';
      if (!this.systemName) this.systemName = 'Local Docker';
    } else {
      if (this.hostname === 'localhost') this.hostname = '';
      if (this.systemName === 'Local Docker') this.systemName = '';
    }
  }

  nextStep(): void {
    const current = this.step();
    if (current === 1 && this.connectionType()) {
      this.step.set(2);
    } else if (current === 2 && this.isStep2Valid()) {
      this.step.set(3);
      this.runVerification();
    }
  }

  prevStep(): void {
    const current = this.step();
    if (current === 2) {
      this.step.set(1);
    } else if (current === 3) {
      this.verifying.set(false);
      this.verifyError.set(null);
      this.verifySuccess.set(false);
      this.step.set(2);
    }
  }

  async runVerification(): Promise<void> {
    this.verifying.set(true);
    this.verifyError.set(null);
    this.verifySuccess.set(false);

    try {
      const request = this.buildSystemRequest();
      await this.systemService.addSystem(request);
      this.verifySuccess.set(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed. Check your credentials and try again.';
      this.verifyError.set(msg);
    } finally {
      this.verifying.set(false);
    }
  }

  finish(): void {
    this.completed.emit();
  }

  retry(): void {
    this.runVerification();
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  private buildSystemRequest(): NewSystemRequest {
    const type = this.connectionType()!;
    if (type === 'local') {
      return {
        name: this.systemName.trim(),
        hostname: 'localhost',
        connectionType: 'local',
        primaryRuntime: 'docker',
        availableRuntimes: ['docker'],
        autoConnect: true,
      };
    }
    if (type === 'remote-ssh') {
      return {
        name: this.systemName.trim(),
        hostname: this.hostname.trim(),
        connectionType: 'remote',
        primaryRuntime: 'docker',
        availableRuntimes: ['docker'],
        autoConnect: true,
        sshConfig: {
          username: this.username.trim(),
          port: this.port,
          authMethod: this.authMethod,
          privateKeyContent: this.authMethod === 'publicKey' ? this.privateKeyContent.trim() : null,
          connectionTimeout: 10,
        },
      };
    }
    // backend — treated as remote for now
    return {
      name: this.systemName.trim(),
      hostname: this.backendUrl.trim(),
      connectionType: 'remote',
      primaryRuntime: 'docker',
      availableRuntimes: ['docker'],
      autoConnect: true,
    };
  }
}
