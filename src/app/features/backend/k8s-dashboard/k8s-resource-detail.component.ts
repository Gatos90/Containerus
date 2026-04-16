import {
  Component, Input, Output, EventEmitter, inject, signal, computed,
  OnChanges, SimpleChanges, OnDestroy, HostListener, ElementRef, ViewChild, AfterViewChecked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { TerminalService } from '../../../core/services/terminal.service';
import {
  K8sEvent, K8sContainerInfo, K8sCondition,
  extractContainers, extractConditions, mapEvent,
} from '../../../core/models/backend.model';
import { LucideAngularModule, X, FileText, Terminal, ScrollText, Activity, Eye, ChevronRight, Loader2, Play, Square } from 'lucide-angular';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { MonacoEditorComponent } from '../../../shared/components/monaco-editor/monaco-editor.component';

type DetailTab = 'overview' | 'logs' | 'events' | 'yaml' | 'exec';

@Component({
  selector: 'app-k8s-resource-detail',
  imports: [FormsModule, LucideAngularModule, MonacoEditorComponent],
  template: `
    <!-- Backdrop -->
    <div
      class="fixed inset-0 bg-black/40 z-40"
      (click)="close.emit()"
    ></div>

    <!-- Slide-over panel -->
    <div class="fixed inset-y-0 right-0 z-50 w-full sm:w-[55%] sm:min-w-[540px] max-w-4xl bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col overflow-hidden animate-slide-in">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
        <div class="min-w-0">
          <div class="text-xs text-zinc-500 font-medium uppercase tracking-wide">{{ kind }}</div>
          <div class="text-zinc-100 font-semibold truncate">{{ name }}</div>
          <div class="text-xs text-zinc-500 mt-0.5">{{ namespace }}</div>
        </div>
        <button (click)="close.emit()" class="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800" aria-label="Close">
          <lucide-icon [img]="X" [size]="18" />
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex gap-0.5 px-5 pt-2 border-b border-zinc-800 shrink-0">
        @for (tab of availableTabs(); track tab.key) {
          <button
            (click)="onTabActivate(tab.key)"
            class="px-3 py-2 text-sm transition-colors border-b-2 flex items-center gap-1.5"
            [class]="activeTab() === tab.key ? 'text-blue-400 border-blue-400' : 'text-zinc-400 border-transparent hover:text-zinc-300'"
          >
            <lucide-icon [img]="tab.icon" [size]="13" />
            {{ tab.label }}
          </button>
        }
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-5">
        <!-- OVERVIEW TAB -->
        @if (activeTab() === 'overview') {
          <div class="space-y-4">
            <!-- Status badges -->
            <div class="flex flex-wrap gap-2">
              @if (resourceStatus()) {
                <span class="text-xs px-2 py-0.5 rounded-full font-medium" [class]="statusClass()">
                  {{ resourceStatus() }}
                </span>
              }
              @if (rawResource?.metadata?.labels) {
                @for (entry of labelEntries(); track entry[0]) {
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                    {{ entry[0] }}={{ entry[1] }}
                  </span>
                }
              }
            </div>

            <!-- Key-value pairs -->
            <div class="bg-zinc-900 rounded-lg border border-zinc-800 divide-y divide-zinc-800/50">
              @for (pair of overviewPairs(); track pair.key) {
                <div class="flex px-4 py-2">
                  <div class="w-40 shrink-0 text-xs text-zinc-500 font-medium">{{ pair.key }}</div>
                  <div class="text-xs text-zinc-200 font-mono break-all">{{ pair.value }}</div>
                </div>
              }
            </div>

            <!-- Containers (pods only) -->
            @if (containers().length > 0) {
              <div>
                <h4 class="text-sm font-medium text-zinc-300 mb-2">Containers</h4>
                <div class="space-y-2">
                  @for (c of containers(); track c.name) {
                    <div class="bg-zinc-900 rounded-lg border border-zinc-800 p-3">
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-sm text-zinc-200 font-medium">{{ c.name }}</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded"
                          [class]="c.state === 'running' ? 'bg-green-500/20 text-green-400' :
                                   c.state === 'waiting' || c.state === 'CrashLoopBackOff' ? 'bg-yellow-500/20 text-yellow-400' :
                                   'bg-zinc-700 text-zinc-400'"
                        >{{ c.state }}</span>
                      </div>
                      <div class="text-xs text-zinc-400 font-mono mb-1">{{ c.image }}</div>
                      @if (c.ports.length > 0) {
                        <div class="text-xs text-zinc-500">Ports: {{ c.ports.join(', ') }}</div>
                      }
                      @if (c.restartCount > 0) {
                        <div class="text-xs text-yellow-500">Restarts: {{ c.restartCount }}</div>
                      }
                      @if (c.resources) {
                        <div class="text-xs text-zinc-500 mt-1">
                          @if (c.resources.requests) {
                            Req: {{ formatResources(c.resources.requests) }}
                          }
                          @if (c.resources.limits) {
                            &nbsp;Lim: {{ formatResources(c.resources.limits) }}
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              </div>
            }

            <!-- Conditions -->
            @if (conditions().length > 0) {
              <div>
                <h4 class="text-sm font-medium text-zinc-300 mb-2">Conditions</h4>
                <div class="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
                  <table class="w-full text-xs">
                    <thead>
                      <tr class="border-b border-zinc-800 text-zinc-500">
                        <th class="px-3 py-1.5 text-left font-medium">Type</th>
                        <th class="px-3 py-1.5 text-left font-medium">Status</th>
                        <th class="px-3 py-1.5 text-left font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (cond of conditions(); track cond.type) {
                        <tr class="border-b border-zinc-800/50">
                          <td class="px-3 py-1.5 text-zinc-300">{{ cond.type }}</td>
                          <td class="px-3 py-1.5">
                            <span [class]="cond.status === 'True' ? 'text-green-400' : cond.status === 'False' ? 'text-red-400' : 'text-zinc-400'">
                              {{ cond.status }}
                            </span>
                          </td>
                          <td class="px-3 py-1.5 text-zinc-500">{{ cond.reason ?? '-' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }

            <!-- Owner References -->
            @if (ownerRefs().length > 0) {
              <div>
                <h4 class="text-sm font-medium text-zinc-300 mb-2">Owner References</h4>
                <div class="space-y-1">
                  @for (ref of ownerRefs(); track ref.name) {
                    <div class="flex items-center gap-1.5 text-xs">
                      <lucide-icon [img]="ChevronRight" [size]="12" class="text-zinc-600" />
                      <span class="text-zinc-500">{{ ref.kind }}</span>
                      <span class="text-zinc-300 font-mono">{{ ref.name }}</span>
                    </div>
                  }
                </div>
              </div>
            }

            <!-- Annotations -->
            @if (annotationEntries().length > 0) {
              <div>
                <h4 class="text-sm font-medium text-zinc-300 mb-2">Annotations</h4>
                <div class="bg-zinc-900 rounded-lg border border-zinc-800 divide-y divide-zinc-800/50 max-h-60 overflow-y-auto">
                  @for (entry of annotationEntries(); track entry[0]) {
                    <div class="px-3 py-1.5">
                      <div class="text-[10px] text-zinc-500 font-mono truncate">{{ entry[0] }}</div>
                      <div class="text-xs text-zinc-300 font-mono break-all">{{ entry[1] }}</div>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }

        <!-- LOGS TAB -->
        @if (activeTab() === 'logs') {
          <div class="space-y-3 flex flex-col h-full">
            <!-- Controls -->
            <div class="flex flex-wrap items-center gap-2 shrink-0">
              @if (containers().length > 1) {
                <select
                  class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                  [ngModel]="selectedContainer()"
                  (ngModelChange)="onContainerChange($event)"
                >
                  @for (c of containers(); track c.name) {
                    <option [value]="c.name">{{ c.name }}</option>
                  }
                </select>
              }
              <select
                class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                [ngModel]="logTailLines()"
                (ngModelChange)="logTailLines.set(+$event); fetchLogs()"
              >
                <option [value]="100">100 lines</option>
                <option [value]="500">500 lines</option>
                <option [value]="1000">1000 lines</option>
              </select>
              <label class="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                <input type="checkbox" [checked]="logFollow()" (change)="toggleFollow()" class="rounded" />
                Follow
              </label>
              <label class="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                <input type="checkbox" [checked]="logPrevious()" (change)="logPrevious.set(!logPrevious()); fetchLogs()" class="rounded" />
                Previous
              </label>
              <label class="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                <input type="checkbox" [checked]="logTimestamps()" (change)="logTimestamps.set(!logTimestamps()); fetchLogs()" class="rounded" />
                Timestamps
              </label>
              <div class="flex-1"></div>
              <input
                type="text"
                placeholder="Filter logs..."
                class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 w-40"
                [ngModel]="logFilter()"
                (ngModelChange)="logFilter.set($event)"
              />
            </div>

            <!-- Log output -->
            <div
              #logContainer
              class="flex-1 min-h-[300px] bg-zinc-900 rounded-lg border border-zinc-800 p-3 overflow-y-auto font-mono text-xs text-zinc-300 whitespace-pre-wrap break-all"
            >
              @if (loadingLogs()) {
                <div class="text-zinc-500 flex items-center gap-2">
                  <lucide-icon [img]="Loader2" [size]="14" class="animate-spin" />
                  Loading logs...
                </div>
              } @else if (!logContent()) {
                <div class="text-zinc-500">No logs available.</div>
              } @else {
                @for (line of filteredLogLines(); track $index) {
                  <div class="hover:bg-zinc-800/30 px-1 -mx-1 leading-5" [innerHTML]="highlightLine(line)"></div>
                }
              }
            </div>

            @if (logFollow()) {
              <div class="text-[10px] text-blue-400 shrink-0 flex items-center gap-1">
                <lucide-icon [img]="Loader2" [size]="10" class="animate-spin" />
                Streaming live logs...
              </div>
            }
          </div>
        }

        <!-- EVENTS TAB -->
        @if (activeTab() === 'events') {
          <div>
            @if (loadingEvents()) {
              <div class="text-zinc-500 flex items-center gap-2 py-8 justify-center">
                <lucide-icon [img]="Loader2" [size]="14" class="animate-spin" />
                Loading events...
              </div>
            } @else if (events().length === 0) {
              <div class="text-center py-8 text-zinc-500">No events found for this resource.</div>
            } @else {
              <div class="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="border-b border-zinc-800 text-zinc-500">
                      <th class="px-3 py-2 text-left font-medium">Type</th>
                      <th class="px-3 py-2 text-left font-medium">Reason</th>
                      <th class="px-3 py-2 text-left font-medium">Message</th>
                      <th class="px-3 py-2 text-left font-medium">Count</th>
                      <th class="px-3 py-2 text-left font-medium">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (evt of events(); track $index) {
                      <tr class="border-b border-zinc-800/50">
                        <td class="px-3 py-2">
                          <span class="px-1.5 py-0.5 rounded text-[10px]"
                            [class]="evt.type === 'Warning' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/15 text-blue-400'"
                          >{{ evt.type }}</span>
                        </td>
                        <td class="px-3 py-2 text-zinc-300 font-medium">{{ evt.reason }}</td>
                        <td class="px-3 py-2 text-zinc-400 max-w-sm truncate" [title]="evt.message">{{ evt.message }}</td>
                        <td class="px-3 py-2 text-zinc-400">{{ evt.count }}</td>
                        <td class="px-3 py-2 text-zinc-500">{{ evt.age }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        }

        <!-- EXEC TAB -->
        @if (activeTab() === 'exec') {
          <div class="flex flex-col h-full space-y-3">
            <!-- Controls -->
            @if (!execConnected()) {
              <div class="flex flex-wrap items-center gap-2 shrink-0">
                @if (containers().length > 1) {
                  <select
                    class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                    [ngModel]="execContainer()"
                    (ngModelChange)="execContainer.set($event)"
                  >
                    @for (c of containers(); track c.name) {
                      <option [value]="c.name">{{ c.name }}</option>
                    }
                  </select>
                }
                <select
                  class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                  [ngModel]="execShell()"
                  (ngModelChange)="execShell.set($event)"
                >
                  <option value="/bin/sh">/bin/sh</option>
                  <option value="/bin/bash">/bin/bash</option>
                  <option value="/bin/ash">/bin/ash</option>
                  <option value="/bin/zsh">/bin/zsh</option>
                  <option value="/bin/fish">/bin/fish</option>
                </select>
                <button
                  (click)="connectExec()"
                  [disabled]="execConnecting()"
                  class="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-xs rounded px-3 py-1.5 flex items-center gap-1"
                >
                  @if (execConnecting()) {
                    <lucide-icon [img]="Loader2" [size]="12" class="animate-spin" />
                    Connecting...
                  } @else {
                    <lucide-icon [img]="Play" [size]="12" />
                    Connect
                  }
                </button>
                @if (execError()) {
                  <span class="text-red-400 text-xs">{{ execError() }}</span>
                }
              </div>
            } @else {
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">Connected</span>
                <span class="text-xs text-zinc-500">{{ execShell() }} in {{ execActiveContainer() || name }}</span>
                <div class="flex-1"></div>
                <button
                  (click)="disconnectExec()"
                  class="text-zinc-400 hover:text-red-400 text-xs px-2 py-1 flex items-center gap-1"
                >
                  <lucide-icon [img]="Square" [size]="11" />
                  Disconnect
                </button>
              </div>
            }

            <!-- Terminal -->
            <div
              #execTerminalContainer
              class="flex-1 min-h-[300px] bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden"
              [class.hidden]="!execConnected() && !execConnecting()"
            ></div>

            @if (!execConnected() && !execConnecting()) {
              <div class="flex-1 min-h-[300px] bg-zinc-900 rounded-lg border border-zinc-800 flex items-center justify-center">
                <div class="text-center text-zinc-500">
                  <lucide-icon [img]="TerminalIcon" [size]="32" class="mx-auto mb-2 opacity-40" />
                  <p class="text-sm">Select a shell and click Connect to start an exec session</p>
                </div>
              </div>
            }
          </div>
        }

        <!-- YAML TAB -->
        @if (activeTab() === 'yaml') {
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              @if (!yamlEditing()) {
                <button
                  (click)="yamlEditing.set(true)"
                  class="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded px-3 py-1.5"
                >Edit</button>
              } @else {
                <button
                  (click)="applyYaml()"
                  [disabled]="applyingYaml()"
                  class="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-xs rounded px-3 py-1.5 flex items-center gap-1"
                >
                  @if (applyingYaml()) {
                    <lucide-icon [img]="Loader2" [size]="12" class="animate-spin" />
                  }
                  Apply
                </button>
                <button
                  (click)="yamlEditing.set(false); yamlContent.set(originalYaml())"
                  class="text-zinc-400 hover:text-zinc-300 text-xs px-2 py-1.5"
                >Cancel</button>
              }
              @if (yamlError()) {
                <span class="text-red-400 text-xs">{{ yamlError() }}</span>
              }
              @if (yamlSuccess()) {
                <span class="text-green-400 text-xs">Applied successfully</span>
              }
            </div>
            <div class="h-[500px] rounded-lg border border-zinc-800 overflow-hidden">
              <app-monaco-editor
                [content]="yamlContent()"
                language="yaml"
                [readonly]="!yamlEditing()"
                (contentChange)="yamlContent.set($event)"
                class="h-full"
              />
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    @keyframes slideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
    .animate-slide-in {
      animation: slideIn 0.2s ease-out;
    }
  `],
})
export class K8sResourceDetailComponent implements OnChanges, OnDestroy, AfterViewChecked {
  private backend = inject(BackendService);
  private terminalService = inject(TerminalService);

  @Input() connectionId!: string;
  @Input() clusterId!: string;
  @Input() kind!: string;
  @Input() name!: string;
  @Input() namespace!: string;
  @Input() rawResource: any = null;
  @Output() close = new EventEmitter<void>();

  /** Internal signal mirroring the rawResource @Input() so computed signals react to changes */
  private rawResource$ = signal<any>(null);

  readonly X = X;
  readonly FileText = FileText;
  readonly TerminalIcon = Terminal;
  readonly ScrollText = ScrollText;
  readonly Activity = Activity;
  readonly Eye = Eye;
  readonly ChevronRight = ChevronRight;
  readonly Loader2 = Loader2;
  readonly Play = Play;
  readonly Square = Square;

  activeTab = signal<DetailTab>('overview');
  containers = signal<K8sContainerInfo[]>([]);
  conditions = signal<K8sCondition[]>([]);
  events = signal<K8sEvent[]>([]);
  loadingEvents = signal(false);

  // Logs
  logContent = signal('');
  loadingLogs = signal(false);
  selectedContainer = signal('');
  logTailLines = signal(500);
  logFollow = signal(false);
  logPrevious = signal(false);
  logTimestamps = signal(false);
  logFilter = signal('');
  private logAbortController: AbortController | null = null;

  // YAML
  yamlContent = signal('');
  originalYaml = signal('');
  yamlEditing = signal(false);
  applyingYaml = signal(false);
  yamlError = signal<string | null>(null);
  yamlSuccess = signal(false);

  // Exec
  execConnected = signal(false);
  execConnecting = signal(false);
  execError = signal<string | null>(null);
  execShell = signal('/bin/sh');
  execContainer = signal('');
  execActiveContainer = signal('');
  private execSessionId: string | null = null;
  private execXterm: XTerm | null = null;
  private execFitAddon: FitAddon | null = null;
  private execResizeObserver: ResizeObserver | null = null;
  private needsExecTerminalInit = false;

  @ViewChild('logContainer') logContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('execTerminalContainer') execTerminalContainer!: ElementRef<HTMLDivElement>;

  readonly isPod = computed(() => this.kind?.toLowerCase() === 'pods' || this.kind?.toLowerCase() === 'pod');

  readonly availableTabs = computed(() => {
    const tabs: { key: DetailTab; label: string; icon: any }[] = [
      { key: 'overview', label: 'Overview', icon: this.Eye },
    ];
    if (this.isPod()) {
      tabs.push({ key: 'logs', label: 'Logs', icon: this.ScrollText });
      tabs.push({ key: 'exec', label: 'Exec', icon: this.TerminalIcon });
    }
    tabs.push({ key: 'events', label: 'Events', icon: this.Activity });
    tabs.push({ key: 'yaml', label: 'YAML', icon: this.FileText });
    return tabs;
  });

  readonly filteredLogLines = computed(() => {
    const content = this.logContent();
    if (!content) return [];
    const lines = content.split('\n');
    const filter = this.logFilter().toLowerCase();
    if (!filter) return lines;
    return lines.filter(l => l.toLowerCase().includes(filter));
  });

  readonly overviewPairs = computed(() => {
    const raw = this.rawResource$();
    if (!raw) return [];
    const pairs: { key: string; value: string }[] = [];
    pairs.push({ key: 'Name', value: raw.metadata?.name ?? '-' });
    pairs.push({ key: 'Namespace', value: raw.metadata?.namespace ?? '-' });
    pairs.push({ key: 'Created', value: raw.metadata?.creationTimestamp ?? '-' });

    if (raw.status?.phase) pairs.push({ key: 'Phase', value: raw.status.phase });
    if (raw.status?.podIP) pairs.push({ key: 'Pod IP', value: raw.status.podIP });
    if (raw.spec?.nodeName) pairs.push({ key: 'Node', value: raw.spec.nodeName });
    if (raw.spec?.serviceAccountName) pairs.push({ key: 'Service Account', value: raw.spec.serviceAccountName });
    if (raw.spec?.restartPolicy) pairs.push({ key: 'Restart Policy', value: raw.spec.restartPolicy });

    // Deployment-specific
    if (raw.spec?.replicas != null) pairs.push({ key: 'Replicas', value: String(raw.spec.replicas) });
    if (raw.spec?.strategy?.type) pairs.push({ key: 'Strategy', value: raw.spec.strategy.type });

    // Service-specific
    if (raw.spec?.type) pairs.push({ key: 'Type', value: raw.spec.type });
    if (raw.spec?.clusterIP) pairs.push({ key: 'Cluster IP', value: raw.spec.clusterIP });
    if (raw.spec?.selector) {
      const sel = Object.entries(raw.spec.selector).map(([k, v]) => `${k}=${v}`).join(', ');
      if (sel) pairs.push({ key: 'Selector', value: sel });
    }

    // Node-specific
    if (raw.status?.addresses) {
      const addrs = raw.status.addresses.map((a: any) => `${a.type}: ${a.address}`).join(', ');
      if (addrs) pairs.push({ key: 'Addresses', value: addrs });
    }
    if (raw.spec?.unschedulable) pairs.push({ key: 'Schedulable', value: 'No (cordoned)' });

    pairs.push({ key: 'UID', value: raw.metadata?.uid ?? '-' });
    return pairs;
  });

  readonly labelEntries = computed(() => {
    const labels = this.rawResource$()?.metadata?.labels;
    if (!labels) return [];
    return Object.entries(labels);
  });

  readonly annotationEntries = computed(() => {
    const annos = this.rawResource$()?.metadata?.annotations;
    if (!annos) return [];
    return Object.entries(annos) as [string, string][];
  });

  readonly ownerRefs = computed(() => {
    return (this.rawResource$()?.metadata?.ownerReferences ?? []).map((r: any) => ({
      kind: r.kind,
      name: r.name,
    }));
  });

  readonly resourceStatus = computed(() => {
    const raw = this.rawResource$();
    if (!raw) return '';
    return raw.status?.phase ??
      raw.status?.conditions?.find((c: any) => c.type === 'Ready')?.status ??
      '';
  });

  readonly statusClass = computed(() => {
    const s = this.resourceStatus();
    if (['Running', 'Active', 'True', 'Bound', 'Succeeded'].includes(s)) return 'bg-green-500/20 text-green-400';
    if (['Pending', 'Unknown'].includes(s)) return 'bg-yellow-500/20 text-yellow-400';
    if (['Failed', 'False', 'CrashLoopBackOff'].includes(s)) return 'bg-red-500/20 text-red-400';
    return 'bg-zinc-700 text-zinc-400';
  });

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close.emit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['rawResource'] || changes['name'] || changes['kind']) {
      this.activeTab.set('overview');
      this.yamlEditing.set(false);
      this.yamlSuccess.set(false);
      this.yamlError.set(null);
      this.logContent.set('');
      this.stopLogStream();
      this.logFollow.set(false);
      this.disconnectExec();

      this.rawResource$.set(this.rawResource);

      if (this.rawResource) {
        this.containers.set(this.isPod() ? extractContainers(this.rawResource) : []);
        this.conditions.set(extractConditions(this.rawResource));

        // Set default container for logs and exec
        const ctrs = this.containers();
        if (ctrs.length > 0) {
          if (!this.selectedContainer()) this.selectedContainer.set(ctrs[0].name);
          if (!this.execContainer()) this.execContainer.set(ctrs[0].name);
        }

        // Generate YAML
        this.generateYaml();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopLogStream();
    this.disconnectExec();
  }

  ngAfterViewChecked(): void {
    if (this.needsExecTerminalInit && this.execTerminalContainer?.nativeElement) {
      this.needsExecTerminalInit = false;
      this.initExecTerminal();
    }
  }

  onContainerChange(name: string): void {
    this.selectedContainer.set(name);
    this.fetchLogs();
  }

  async onTabActivate(tab: DetailTab): Promise<void> {
    this.activeTab.set(tab);
    if (tab === 'logs' && !this.logContent() && this.isPod()) {
      await this.fetchLogs();
    }
    if (tab === 'events' && this.events().length === 0) {
      await this.fetchEvents();
    }
  }

  // ============================================================================
  // Logs
  // ============================================================================

  async fetchLogs(): Promise<void> {
    this.stopLogStream();
    this.loadingLogs.set(true);
    try {
      const container = this.containers().length > 1 ? this.selectedContainer() : undefined;
      const result = await this.backend.getPodLogsFor(
        this.connectionId, this.clusterId, this.namespace, this.name,
        {
          container,
          tailLines: this.logTailLines(),
          previous: this.logPrevious(),
          timestamps: this.logTimestamps(),
        }
      );
      this.logContent.set(result.logs || '');
      this.scrollLogsToBottom();

      // Start streaming if follow is on
      if (this.logFollow()) {
        this.startLogStream();
      }
    } catch (e: any) {
      this.logContent.set(`Error fetching logs: ${e.message}`);
    } finally {
      this.loadingLogs.set(false);
    }
  }

  toggleFollow(): void {
    const newFollow = !this.logFollow();
    this.logFollow.set(newFollow);
    if (newFollow) {
      this.startLogStream();
    } else {
      this.stopLogStream();
    }
  }

  private startLogStream(): void {
    this.stopLogStream();
    const container = this.containers().length > 1 ? this.selectedContainer() : undefined;
    const info = this.backend.getLogStreamInfo(
      this.connectionId, this.clusterId, this.namespace, this.name,
      {
        container,
        tailLines: 50,
        previous: this.logPrevious(),
        timestamps: this.logTimestamps(),
      }
    );
    if (!info) return;

    const controller = new AbortController();
    this.logAbortController = controller;

    fetch(info.url, {
      headers: { Authorization: `Bearer ${info.token}` },
      signal: controller.signal,
    }).then(async resp => {
      if (!resp.ok || !resp.body) return;
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const text = line.slice(6);
            this.logContent.update(existing => existing + (existing ? '\n' : '') + text);
            this.scrollLogsToBottom();
          }
        }
      }
    }).catch(_e => {
      // Abort is expected when stopping
    });
  }

  private stopLogStream(): void {
    this.logAbortController?.abort();
    this.logAbortController = null;
  }

  private scrollLogsToBottom(): void {
    setTimeout(() => {
      const el = this.logContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  highlightLine(line: string): string {
    const filter = this.logFilter();
    if (!filter) return this.escapeHtml(line);
    const escaped = this.escapeHtml(line);
    const escapedFilter = this.escapeHtml(filter);
    const regex = new RegExp(`(${escapedFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark class="bg-yellow-500/30 text-yellow-200 rounded-sm px-0.5">$1</mark>');
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================================
  // Events
  // ============================================================================

  async fetchEvents(): Promise<void> {
    this.loadingEvents.set(true);
    try {
      // Map internal kind names to K8s Kind capitalization
      const kindMap: Record<string, string> = {
        pods: 'Pod', deployments: 'Deployment', services: 'Service',
        statefulsets: 'StatefulSet', daemonsets: 'DaemonSet', replicasets: 'ReplicaSet',
        jobs: 'Job', cronjobs: 'CronJob', configmaps: 'ConfigMap', secrets: 'Secret',
        ingresses: 'Ingress', pvcs: 'PersistentVolumeClaim', nodes: 'Node', namespaces: 'Namespace',
      };
      const k8sKind = kindMap[this.kind.toLowerCase()] ?? this.kind;
      const rawEvents = await this.backend.getResourceEventsFor(
        this.connectionId, this.clusterId, this.namespace, k8sKind, this.name
      );
      this.events.set(rawEvents.map(mapEvent));
    } catch (e: any) {
      console.error('Failed to fetch events:', e);
      this.events.set([]);
    } finally {
      this.loadingEvents.set(false);
    }
  }

  // ============================================================================
  // YAML
  // ============================================================================

  private generateYaml(): void {
    if (!this.rawResource) {
      this.yamlContent.set('');
      this.originalYaml.set('');
      return;
    }
    // Simple JSON-to-YAML-like formatted output
    const yaml = this.jsonToYaml(this.rawResource, 0);
    this.yamlContent.set(yaml);
    this.originalYaml.set(yaml);
  }

  private jsonToYaml(obj: any, indent: number): string {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj === 'string') {
      if (obj.includes('\n') || obj.includes(': ') || obj.includes('#')) {
        return `"${obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
      }
      return obj;
    }
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);

    const prefix = '  '.repeat(indent);
    const childPrefix = '  '.repeat(indent + 1);

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      return obj.map(item => {
        if (typeof item === 'object' && item !== null) {
          const inner = this.jsonToYaml(item, indent + 1);
          const firstLine = inner.split('\n')[0];
          const rest = inner.split('\n').slice(1).join('\n');
          return `${prefix}- ${firstLine}${rest ? '\n' + rest : ''}`;
        }
        return `${prefix}- ${this.jsonToYaml(item, 0)}`;
      }).join('\n');
    }

    if (typeof obj === 'object') {
      const entries = Object.entries(obj);
      if (entries.length === 0) return '{}';
      return entries.map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          const inner = this.jsonToYaml(value, indent + 1);
          if (Array.isArray(value) && value.length > 0) {
            return `${prefix}${key}:\n${inner}`;
          }
          if (typeof value === 'object' && Object.keys(value).length > 0) {
            return `${prefix}${key}:\n${inner}`;
          }
          return `${prefix}${key}: ${inner}`;
        }
        return `${prefix}${key}: ${this.jsonToYaml(value, 0)}`;
      }).join('\n');
    }

    return String(obj);
  }

  async applyYaml(): Promise<void> {
    this.applyingYaml.set(true);
    this.yamlError.set(null);
    this.yamlSuccess.set(false);
    try {
      await this.backend.applyYamlFor(
        this.connectionId, this.clusterId, this.yamlContent(), this.namespace
      );
      this.yamlSuccess.set(true);
      this.yamlEditing.set(false);
      this.originalYaml.set(this.yamlContent());
      // Refresh the resource
      const updated = await this.backend.getK8sResourceFor(
        this.connectionId, this.clusterId, this.kind, this.name, this.namespace
      );
      this.rawResource = updated;
      this.generateYaml();
    } catch (e: any) {
      this.yamlError.set(e.message ?? 'Failed to apply');
    } finally {
      this.applyingYaml.set(false);
    }
  }

  formatResources(res: Record<string, string>): string {
    return Object.entries(res).map(([k, v]) => `${k}=${v}`).join(' ');
  }

  // ============================================================================
  // Exec
  // ============================================================================

  async connectExec(): Promise<void> {
    this.execConnecting.set(true);
    this.execError.set(null);

    try {
      const container = this.containers().length > 1 ? this.execContainer() : undefined;
      this.execActiveContainer.set(container || '');

      const session = await this.terminalService.startK8sExecSession(
        this.connectionId,
        this.clusterId,
        this.namespace,
        this.name,
        container,
        this.execShell(),
        80, 24,
      );

      this.execSessionId = session.id;
      this.execConnected.set(true);
      this.needsExecTerminalInit = true;
    } catch (e: any) {
      this.execError.set(e.message ?? 'Failed to connect');
    } finally {
      this.execConnecting.set(false);
    }
  }

  private initExecTerminal(): void {
    if (!this.execTerminalContainer?.nativeElement || !this.execSessionId) return;

    this.disposeExecTerminal();

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      theme: {
        background: '#09090b',
        foreground: '#d4d4d8',
        cursor: '#d4d4d8',
        selectionBackground: '#3f3f4640',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#d4d4d8',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(this.execTerminalContainer.nativeElement);

    this.execXterm = term;
    this.execFitAddon = fitAddon;

    // Fit on next frame
    requestAnimationFrame(() => {
      fitAddon.fit();
      if (this.execSessionId) {
        this.terminalService.resize(this.execSessionId, term.cols, term.rows);
      }
    });

    // Terminal input → WebSocket
    const sessionId = this.execSessionId;
    term.onData((data) => {
      this.terminalService.sendInput(sessionId, data);
    });

    // WebSocket output → Terminal
    this.terminalService.onOutput(sessionId, (data) => {
      term.write(data);
    });

    // Observe container resize
    this.execResizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
        if (this.execSessionId) {
          this.terminalService.resize(this.execSessionId, term.cols, term.rows);
        }
      });
    });
    this.execResizeObserver.observe(this.execTerminalContainer.nativeElement);

    term.focus();
  }

  disconnectExec(): void {
    if (this.execSessionId) {
      this.terminalService.closeSession(this.execSessionId);
      this.execSessionId = null;
    }
    this.disposeExecTerminal();
    this.execConnected.set(false);
    this.execConnecting.set(false);
    this.execError.set(null);
  }

  private disposeExecTerminal(): void {
    this.execResizeObserver?.disconnect();
    this.execResizeObserver = null;
    this.execXterm?.dispose();
    this.execXterm = null;
    this.execFitAddon = null;
  }
}
