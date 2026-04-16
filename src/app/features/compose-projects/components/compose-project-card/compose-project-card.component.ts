import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Play,
  Square,
  RotateCcw,
  ScrollText,
  ChevronDown,
  ChevronRight,
  Folder,
  AlertCircle,
  Loader2,
} from 'lucide-angular';
import {
  ComposeProject,
  ComposeProjectService,
  getComposeStatusBg,
  getComposeStatusLabel,
} from '../../../../core/models/compose.model';
import { ComposeState } from '../../../../state/compose.state';
import { ContainerState } from '../../../../state/container.state';

@Component({
  selector: 'app-compose-project-card',
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <!-- Card Header -->
      <div class="px-4 py-3 flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-white truncate">{{ project().name }}</span>
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border"
              [class]="statusBg()"
            >
              <span class="w-1.5 h-1.5 rounded-full inline-block"
                [class.bg-green-400]="project().status === 'running'"
                [class.bg-amber-400]="project().status === 'partially_running'"
                [class.bg-zinc-500]="project().status === 'stopped'"
              ></span>
              {{ statusLabel() }}
            </span>
          </div>

          <div class="mt-1 flex items-center gap-3 text-xs text-zinc-500">
            <span>
              <span class="text-zinc-300 font-medium">{{ project().runningCount }}</span>
              /{{ project().serviceCount }} services running
            </span>
            <span class="text-zinc-600">·</span>
            <span class="uppercase tracking-wide">{{ project().runtime }}</span>
            @if (project().workingDir) {
              <span class="text-zinc-600">·</span>
              <span class="flex items-center gap-1 truncate max-w-40" [title]="project().workingDir">
                <lucide-icon [img]="Folder" class="w-3 h-3 flex-shrink-0"></lucide-icon>
                <span class="truncate">{{ shortPath(project().workingDir) }}</span>
              </span>
            }
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center gap-1.5 flex-shrink-0">
          @if (isLoading()) {
            <lucide-icon [img]="Loader2" class="w-4 h-4 animate-spin text-zinc-400"></lucide-icon>
          } @else {
            @if (project().status === 'stopped') {
              <button
                (click)="onUp()"
                class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 transition-colors text-xs font-medium"
                title="Compose Up"
              >
                <lucide-icon [img]="Play" class="w-3.5 h-3.5"></lucide-icon>
                <span class="hidden sm:inline">Up</span>
              </button>
            } @else {
              <button
                (click)="onRestart()"
                class="p-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-800 transition-colors"
                title="Restart all services"
              >
                <lucide-icon [img]="RotateCcw" class="w-3.5 h-3.5 text-zinc-400"></lucide-icon>
              </button>
              <button
                (click)="onDown()"
                class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 transition-colors text-xs font-medium"
                title="Compose Down"
              >
                <lucide-icon [img]="Square" class="w-3.5 h-3.5"></lucide-icon>
                <span class="hidden sm:inline">Down</span>
              </button>
            }
            <button
              (click)="toggleLogs()"
              class="p-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-800 transition-colors"
              [class.bg-zinc-800]="showLogs()"
              title="View logs"
            >
              <lucide-icon [img]="ScrollText" class="w-3.5 h-3.5 text-zinc-400"></lucide-icon>
            </button>
          }

          <!-- Expand services toggle -->
          <button
            (click)="toggleServices()"
            class="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Toggle services"
          >
            <lucide-icon
              [img]="showServices() ? ChevronDown : ChevronRight"
              class="w-3.5 h-3.5 text-zinc-400"
            ></lucide-icon>
          </button>
        </div>
      </div>

      <!-- Error banner -->
      @if (composeState.error()) {
        <div class="mx-4 mb-3 px-3 py-2 bg-red-900/30 border border-red-800/50 rounded-lg text-xs text-red-400 flex items-center gap-2">
          <lucide-icon [img]="AlertCircle" class="w-3.5 h-3.5 flex-shrink-0"></lucide-icon>
          {{ composeState.error() }}
          <button class="ml-auto hover:text-red-300" (click)="composeState.clearError()">✕</button>
        </div>
      }

      <!-- Services list -->
      @if (showServices()) {
        <div class="border-t border-zinc-800 divide-y divide-zinc-800/60">
          @for (service of project().services; track service.name) {
            <div class="px-4 py-2.5 flex items-center justify-between gap-3">
              <div class="flex items-center gap-2 min-w-0">
                <span
                  class="w-2 h-2 rounded-full flex-shrink-0"
                  [class.bg-green-500]="service.status === 'running'"
                  [class.bg-red-500]="service.status === 'exited' || service.status === 'dead'"
                  [class.bg-amber-500]="service.status === 'restarting' || service.status === 'paused'"
                  [class.bg-zinc-500]="service.status === 'stopped' || service.status === 'created'"
                ></span>
                <span class="text-sm text-zinc-300 truncate">{{ service.name }}</span>
                <span class="text-xs text-zinc-600">
                  ({{ service.containers.length }} container{{ service.containers.length !== 1 ? 's' : '' }})
                </span>
              </div>
              <div class="flex items-center gap-1.5">
                @if (composeState.isLoading(serviceLogsKey(service))) {
                  <lucide-icon [img]="Loader2" class="w-3.5 h-3.5 animate-spin text-zinc-400"></lucide-icon>
                } @else {
                  <button
                    (click)="toggleServiceLogs(service)"
                    class="p-1 rounded hover:bg-zinc-800 transition-colors"
                    title="View service logs"
                  >
                    <lucide-icon [img]="ScrollText" class="w-3.5 h-3.5 text-zinc-500"></lucide-icon>
                  </button>
                  @if (service.status === 'running') {
                    <button
                      (click)="onRestartService(service)"
                      class="p-1 rounded hover:bg-zinc-800 transition-colors"
                      title="Restart service"
                    >
                      <lucide-icon [img]="RotateCcw" class="w-3.5 h-3.5 text-zinc-500"></lucide-icon>
                    </button>
                  }
                }
              </div>
            </div>
            <!-- Service logs -->
            @if (serviceLogs(service); as logs) {
              <div class="px-4 pb-3">
                <pre class="bg-zinc-950 text-xs text-zinc-300 rounded-lg p-3 overflow-x-auto max-h-48 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap">{{ logs }}</pre>
                <button
                  (click)="clearServiceLogs(service)"
                  class="mt-1 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Close logs
                </button>
              </div>
            }
          }
        </div>
      }

      <!-- Project logs panel -->
      @if (showLogs()) {
        <div class="border-t border-zinc-800 p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-medium text-zinc-400">Project Logs (last 100 lines)</span>
            <button
              (click)="showLogs.set(false); composeState.clearLogs(project().id)"
              class="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Close
            </button>
          </div>
          @if (composeState.isLoading('logs::' + project().id)) {
            <div class="flex items-center gap-2 text-xs text-zinc-500 py-2">
              <lucide-icon [img]="Loader2" class="w-3.5 h-3.5 animate-spin"></lucide-icon>
              Loading logs...
            </div>
          } @else if (projectLogs(); as logs) {
            <pre class="bg-zinc-950 text-xs text-zinc-300 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap">{{ logs }}</pre>
          } @else {
            <div class="text-xs text-zinc-500 italic">No logs available</div>
          }
        </div>
      }
    </div>
  `,
})
export class ComposeProjectCardComponent {
  readonly project = input.required<ComposeProject>();

  readonly composeState = inject(ComposeState);
  readonly containerState = inject(ContainerState);

  readonly Play = Play;
  readonly Square = Square;
  readonly RotateCcw = RotateCcw;
  readonly ScrollText = ScrollText;
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly Folder = Folder;
  readonly AlertCircle = AlertCircle;
  readonly Loader2 = Loader2;

  showServices = signal(true);
  showLogs = signal(false);

  statusBg() {
    return getComposeStatusBg(this.project().status);
  }

  statusLabel() {
    return getComposeStatusLabel(this.project().status);
  }

  isLoading() {
    return this.composeState.isLoading(this.project().id);
  }

  shortPath(fullPath: string): string {
    const parts = fullPath.replace(/\\/g, '/').split('/');
    return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : fullPath;
  }

  toggleServices(): void {
    this.showServices.update((v) => !v);
  }

  async toggleLogs(): Promise<void> {
    if (this.showLogs()) {
      this.showLogs.set(false);
      this.composeState.clearLogs(this.project().id);
      return;
    }
    this.showLogs.set(true);
    await this.composeState.loadLogs(this.project());
  }

  async onUp(): Promise<void> {
    await this.composeState.composeUp(this.project());
    // Reload containers so the derived state re-computes
    await this.containerState.loadContainers(this.project().systemId);
  }

  async onDown(): Promise<void> {
    await this.composeState.composeDown(this.project());
    await this.containerState.loadContainers(this.project().systemId);
  }

  async onRestart(): Promise<void> {
    await this.composeState.composeRestart(this.project());
    await this.containerState.loadContainers(this.project().systemId);
  }

  async onRestartService(service: ComposeProjectService): Promise<void> {
    await this.composeState.composeRestart(this.project(), service.name);
    await this.containerState.loadContainers(this.project().systemId);
  }

  serviceLogsKey(service: ComposeProjectService): string {
    return `logs::${this.project().id}::${service.name}`;
  }

  serviceLogs(service: ComposeProjectService): string | undefined {
    return this.composeState.expandedLogs()[
      `${this.project().id}::${service.name}`
    ];
  }

  projectLogs(): string | undefined {
    return this.composeState.expandedLogs()[this.project().id];
  }

  async toggleServiceLogs(service: ComposeProjectService): Promise<void> {
    const key = `${this.project().id}::${service.name}`;
    if (this.composeState.expandedLogs()[key]) {
      this.composeState.clearLogs(key);
      return;
    }
    await this.composeState.loadLogs(this.project(), service.name);
  }

  clearServiceLogs(service: ComposeProjectService): void {
    this.composeState.clearLogs(`${this.project().id}::${service.name}`);
  }
}
