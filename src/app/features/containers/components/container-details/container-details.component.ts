import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { LucideAngularModule, AlertTriangle } from 'lucide-angular';
import {
  Container,
  getStatusText,
  NetworkInfo,
} from '../../../../core/models/container.model';
import { ClipboardService } from '../../../../core/services/clipboard.service';
import { DetailFieldComponent } from '../../../../shared/components/detail-field/detail-field.component';
import { DetailSectionComponent } from '../../../../shared/components/detail-section/detail-section.component';
import { PortSectionComponent } from '../port-section/port-section.component';

@Component({
  selector: 'app-container-details',
  imports: [
    LucideAngularModule,
    DetailFieldComponent,
    DetailSectionComponent,
    PortSectionComponent,
  ],
  templateUrl: './container-details.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContainerDetailsComponent {
  private clipboard = inject(ClipboardService);

  container = input.required<Container>();

  readonly AlertTriangle = AlertTriangle;
  readonly getStatusText = getStatusText;

  envVarCount = computed(() => {
    const c = this.container();
    const count = Object.keys(c.environmentVariables).length;
    return `${count} variable${count !== 1 ? 's' : ''}`;
  });

  volumeCount = computed(() => {
    const c = this.container();
    return `${c.volumes.length} mounted`;
  });

  labelCount = computed(() => {
    const c = this.container();
    const count = Object.keys(c.labels).length;
    return `${count} label${count !== 1 ? 's' : ''} configured`;
  });

  envVarsArray = computed(() => {
    const c = this.container();
    return Object.entries(c.environmentVariables).map(([key, value]) => ({
      key,
      value,
    }));
  });

  labelsArray = computed(() => {
    const c = this.container();
    return Object.entries(c.labels).map(([key, value]) => ({
      key,
      value,
    }));
  });

  logConfigEntries = computed(() => {
    const c = this.container();
    if (!c.hostConfig.logConfig?.config) return [];
    return Object.entries(c.hostConfig.logConfig.config).map(([key, value]) => ({
      key,
      value,
    }));
  });

  networksArray = computed((): { name: string; info: NetworkInfo }[] => {
    const c = this.container();
    return Object.entries(c.networkSettings.networks).map(([name, info]) => ({
      name,
      info,
    }));
  });

  hasCommandInfo(): boolean {
    const cfg = this.container().config;
    return !!(cfg.entrypoint?.length || cfg.cmd?.length || cfg.workingDir || cfg.user || cfg.hostname);
  }

  hasSecurityInfo(): boolean {
    const hc = this.container().hostConfig;
    return hc.capAdd.length > 0 || hc.capDrop.length > 0 || hc.securityOpt.length > 0;
  }

  hasDevicesInfo(): boolean {
    const hc = this.container().hostConfig;
    return hc.devices.length > 0 || !!hc.shmSize || hc.ulimits.length > 0;
  }

  formatDate(dateString: string): string {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  }

  formatMemory(bytes?: number | null): string {
    if (!bytes) return 'No limit';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  formatCpuLimit(): string {
    const { cpuQuota, cpuPeriod } = this.container().resourceLimits;
    if (cpuQuota && cpuPeriod) {
      const percentage = (cpuQuota / cpuPeriod) * 100;
      return `${percentage.toFixed(0)}%`;
    }
    return 'Not set';
  }

  formatRestartPolicy(): string {
    const { name, maximumRetryCount } = this.container().restartPolicy;
    if (name === 'on-failure' && maximumRetryCount > 0) {
      return `${name} (max ${maximumRetryCount})`;
    }
    return name;
  }

  copyAllEnvVars = async (): Promise<void> => {
    await this.clipboard.copyEnvVars(this.container().environmentVariables);
  };

  copyAllLabels = async (): Promise<void> => {
    const text = Object.entries(this.container().labels)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    await this.clipboard.copy(text);
  };

  async copyEnvVar(key: string, value: string): Promise<void> {
    await this.clipboard.copy(`${key}=${value}`);
  }
}
