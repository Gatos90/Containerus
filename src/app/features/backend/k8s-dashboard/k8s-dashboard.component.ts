import { Component, inject, signal, computed, Input, OnInit, OnChanges, SimpleChanges, HostListener, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../../../core/services/backend.service';
import { K8sWatchService, K8sWatchEvent } from '../../../core/services/k8s-watch.service';
import { K8sCluster, K8sNamespace, K8sPod, K8sDeployment, K8sService as K8sSvc, K8sTopology, K8sApiResource, Project, Environment } from '../../../core/models/backend.model';
import { LucideAngularModule, Cloud, Plus, Trash2, Loader2, RefreshCw, ChevronDown, Box, Layers, Globe, Scale, Play, CheckCircle, XCircle, RotateCw, Network, Shield, ShieldOff, ShieldAlert, Search, Radio, Pencil } from 'lucide-angular';
import { K8sResourceDetailComponent } from './k8s-resource-detail.component';
import { K8sTopologyComponent } from './k8s-topology.component';
import { MonacoEditorComponent } from '../../../shared/components/monaco-editor/monaco-editor.component';
import { K8sCreateResourceModalComponent } from './k8s-create-resource/k8s-create-resource-modal.component';
import { K8sResourceHelperService } from './k8s-resource-helper.service';

type K8sTab = 'pods' | 'deployments' | 'services' | 'statefulsets' | 'daemonsets' | 'jobs' | 'cronjobs'
  | 'configmaps' | 'secrets' | 'ingresses' | 'pvcs' | 'nodes'
  | 'networkpolicies' | 'resourcequotas' | 'limitranges' | 'serviceaccounts'
  | 'roles' | 'rolebindings' | 'clusterroles' | 'clusterrolebindings'
  | 'horizontalpodautoscalers' | 'poddisruptionbudgets' | 'endpoints'
  | 'persistentvolumes' | 'storageclasses' | 'ingressclasses';
type K8sCategory = 'workloads' | 'networking' | 'config' | 'storage' | 'access' | 'cluster' | 'custom';

export interface ClusterGroup {
  project: Project;
  environment: Environment;
  clusters: K8sCluster[];
}

@Component({
  selector: 'app-k8s-dashboard',
  imports: [FormsModule, LucideAngularModule, K8sResourceDetailComponent, K8sTopologyComponent, MonacoEditorComponent, K8sCreateResourceModalComponent],
  template: `
    <div class="p-4 space-y-6">
      <!-- ================================================================ -->
      <!-- MANAGE VIEW: cluster list (when no cluster selected or manage)   -->
      <!-- ================================================================ -->
      @if (manageMode() || !selectedCluster()) {
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <lucide-icon [img]="Cloud" [size]="18" class="text-zinc-400" />
              <h2 class="text-lg font-medium text-zinc-200">Clusters</h2>
              <span class="bg-zinc-800 text-zinc-400 text-xs font-medium px-2 py-0.5 rounded-full">
                {{ allClusters().length }}
              </span>
            </div>
            <button
              (click)="openAddClusterModal()"
              class="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5"
            >
              <lucide-icon [img]="Plus" [size]="14" />
              Add Cluster
            </button>
          </div>

          <div class="grid gap-2">
            @if (allClusters().length === 0) {
              <div class="text-center py-12 text-zinc-500">
                <lucide-icon [img]="Cloud" [size]="32" class="mx-auto mb-3 opacity-50" />
                <p class="text-sm">No clusters registered.</p>
                <p class="text-xs mt-1">Click "Add Cluster" to get started.</p>
              </div>
            } @else {
              @for (cluster of allClusters(); track cluster.id) {
                <div
                  class="bg-zinc-900 rounded-xl border border-zinc-800 p-3 cursor-pointer hover:border-zinc-700 transition-colors"
                  [class.border-blue-600]="selectedCluster()?.id === cluster.id"
                  (click)="selectCluster(cluster)"
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3 min-w-0">
                      <div
                        class="w-2.5 h-2.5 rounded-full shrink-0"
                        [class]="getClusterStatusDotClass(cluster.id)"
                      ></div>
                      <div class="min-w-0">
                        <div class="text-sm font-medium text-zinc-200 truncate">{{ cluster.name }}</div>
                        <div class="text-xs text-zinc-500 truncate">{{ cluster.apiServerUrl }}</div>
                      </div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                      <button
                        (click)="openEditClusterModal(cluster); $event.stopPropagation()"
                        class="text-zinc-400 hover:text-blue-400 p-1.5"
                        title="Edit cluster"
                        aria-label="Edit cluster"
                      >
                        <lucide-icon [img]="Pencil" [size]="14" />
                      </button>
                      @if (confirmingRemoveCluster()?.id === cluster.id) {
                        <button
                          (click)="confirmingRemoveCluster.set(null); $event.stopPropagation()"
                          class="text-[11px] text-zinc-400 hover:text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors"
                        >Cancel</button>
                        <button
                          (click)="removeCluster(cluster); $event.stopPropagation()"
                          class="text-[11px] text-red-400 bg-red-950/40 hover:bg-red-950/60 px-1.5 py-0.5 rounded transition-colors"
                        >Remove</button>
                      } @else {
                        <button
                          (click)="promptRemoveCluster(cluster); $event.stopPropagation()"
                          class="text-zinc-400 hover:text-red-400 p-1.5"
                          title="Remove cluster"
                          aria-label="Remove cluster"
                        >
                          <lucide-icon [img]="Trash2" [size]="14" />
                        </button>
                      }
                    </div>
                  </div>
                </div>
              }
            }
          </div>
        </div>
      }

      <!-- ================================================================ -->
      <!-- RESOURCE VIEW: tabs + tables (when cluster selected)             -->
      <!-- ================================================================ -->
      @if (!manageMode() && selectedCluster()) {
        <div class="space-y-4">
          <!-- Topology toggle + live status -->
          <div class="flex items-center gap-3">
            <button
              (click)="showTopology.set(!showTopology())"
              class="text-sm px-3 py-1 rounded-lg flex items-center gap-1.5 transition-colors"
              [class]="showTopology() ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:bg-zinc-800'"
            >
              <lucide-icon [img]="NetworkIcon" [size]="14" />
              Topology
            </button>
            @if (watchStatus() !== 'disconnected') {
              <span class="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
                [class]="watchStatus() === 'live' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'"
              >
                <lucide-icon [img]="RadioIcon" [size]="10" [class.animate-pulse]="watchStatus() === 'live'" />
                {{ watchStatus() === 'live' ? 'Live' : 'Connecting...' }}
              </span>
            }
          </div>

          <!-- Topology View -->
          @if (showTopology()) {
            <div class="h-[450px]">
              <app-k8s-topology
                [topology]="topologyData()"
                [loading]="loadingTopology"
                (resourceSelect)="selectResource($event.kind, $event.name, $event.namespace)"
              />
            </div>
          }

          <!-- Category row -->
          <div class="flex gap-1.5 mb-2">
            @for (cat of k8sCategories; track cat.key) {
              <button
                (click)="setCategory(cat.key)"
                class="px-3 py-1.5 text-xs rounded-lg transition-colors"
                [class]="activeCategory() === cat.key ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'"
              >
                {{ cat.label }}
              </button>
            }
            <button
              (click)="setCategory('custom')"
              class="px-3 py-1.5 text-xs rounded-lg transition-colors"
              [class]="activeCategory() === 'custom' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'"
            >
              Custom Resources
            </button>
          </div>

          <!-- Sub-tab row -->
          <div class="flex gap-1 border-b border-zinc-800">
            @if (activeCategory() === 'custom') {
              @for (crd of crdTabs(); track crd.crd.plural) {
                <button
                  (click)="onCrdTabChange(crd.crd)"
                  class="px-3 py-2 text-sm transition-colors border-b-2 whitespace-nowrap"
                  [class]="activeCrd()?.plural === crd.crd.plural ? 'text-blue-400 border-blue-400' : 'text-zinc-400 border-transparent hover:text-zinc-300'"
                >
                  {{ crd.label }}
                </button>
              } @empty {
                <span class="px-3 py-2 text-sm text-zinc-500">No custom resources found in this cluster</span>
              }
            } @else {
              @for (tab of activeCategoryTabs(); track tab.key) {
                <button
                  (click)="onTabChange(tab.key)"
                  class="px-3 py-2 text-sm transition-colors border-b-2 whitespace-nowrap flex items-center gap-1"
                  [class]="activeTab() === tab.key ? 'text-blue-400 border-blue-400' : 'text-zinc-400 border-transparent hover:text-zinc-300'"
                >
                  {{ tab.label }}
                  @if (getTabCount(tab.key) > 0) {
                    <span class="text-[10px] px-1 py-0 rounded-full bg-zinc-700 text-zinc-400">{{ getTabCount(tab.key) }}</span>
                  }
                </button>
              }
            }
            <div class="ml-auto flex items-center gap-1 py-1">
              <button
                (click)="openCreateResourceModal()"
                class="text-zinc-400 hover:text-blue-400 p-1.5 rounded-lg hover:bg-zinc-800/50 transition-colors"
                title="Create resource"
              >
                <lucide-icon [img]="Plus" [size]="15" />
              </button>
            </div>
          </div>

          <!-- Pods -->
          @if (activeTab() === 'pods') {
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-800 text-zinc-400 text-left">
                    <th class="px-4 py-2 font-medium">Name</th>
                    <th class="px-4 py-2 font-medium">Ready</th>
                    <th class="px-4 py-2 font-medium">Status</th>
                    <th class="px-4 py-2 font-medium">Restarts</th>
                    <th class="px-4 py-2 font-medium">Age</th>
                    <th class="px-4 py-2 font-medium">Node</th>
                  </tr>
                </thead>
                <tbody>
                  @for (pod of filteredPods(); track pod.name) {
                    <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer" (click)="selectResource('pods', pod.name, pod.namespace)">
                      <td class="px-4 py-2 text-zinc-200 font-mono text-xs">{{ pod.name }}</td>
                      <td class="px-4 py-2 text-zinc-300">{{ pod.ready }}</td>
                      <td class="px-4 py-2">
                        <span class="text-xs px-1.5 py-0.5 rounded" [class]="getPodStatusClass(pod.status)">
                          {{ pod.status }}
                        </span>
                      </td>
                      <td class="px-4 py-2 text-zinc-300">{{ pod.restarts }}</td>
                      <td class="px-4 py-2 text-zinc-400">{{ pod.age }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ pod.node ?? '-' }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="text-center py-8 text-zinc-500">No pods found</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <!-- Deployments -->
          @if (activeTab() === 'deployments') {
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-800 text-zinc-400 text-left">
                    <th class="px-4 py-2 font-medium">Name</th>
                    <th class="px-4 py-2 font-medium">Ready</th>
                    <th class="px-4 py-2 font-medium">Up-to-date</th>
                    <th class="px-4 py-2 font-medium">Available</th>
                    <th class="px-4 py-2 font-medium">Age</th>
                    <th class="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (dep of filteredDeployments(); track dep.name) {
                    <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer" (click)="selectResource('deployments', dep.name, dep.namespace)">
                      <td class="px-4 py-2 text-zinc-200 font-mono text-xs">{{ dep.name }}</td>
                      <td class="px-4 py-2 text-zinc-300">{{ dep.ready }}</td>
                      <td class="px-4 py-2 text-zinc-300">{{ dep.upToDate }}</td>
                      <td class="px-4 py-2 text-zinc-300">{{ dep.available }}</td>
                      <td class="px-4 py-2 text-zinc-400">{{ dep.age }}</td>
                      <td class="px-4 py-2">
                        <div class="flex items-center gap-1">
                          <button (click)="scaleDown(dep)" [disabled]="scalingDeployment() === dep.name" class="text-zinc-400 hover:text-zinc-200 text-xs px-1 disabled:opacity-50 disabled:cursor-not-allowed" [attr.aria-label]="'Scale down ' + dep.name" title="Scale down">-</button>
                          <button (click)="scaleUp(dep)" [disabled]="scalingDeployment() === dep.name" class="text-zinc-400 hover:text-zinc-200 text-xs px-1 disabled:opacity-50 disabled:cursor-not-allowed" [attr.aria-label]="'Scale up ' + dep.name" title="Scale up">+</button>
                          <button (click)="restartDeployment(dep)" [disabled]="scalingDeployment() === dep.name" class="text-zinc-400 hover:text-orange-400 p-1 disabled:opacity-50" [attr.aria-label]="'Restart ' + dep.name" title="Rolling restart">
                            @if (scalingDeployment() === dep.name) {
                              <lucide-icon [img]="Loader2" [size]="13" class="animate-spin" />
                            } @else {
                              <lucide-icon [img]="RotateCw" [size]="13" />
                            }
                          </button>
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="text-center py-8 text-zinc-500">No deployments found</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <!-- Services -->
          @if (activeTab() === 'services') {
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-800 text-zinc-400 text-left">
                    <th class="px-4 py-2 font-medium">Name</th>
                    <th class="px-4 py-2 font-medium">Type</th>
                    <th class="px-4 py-2 font-medium">Cluster IP</th>
                    <th class="px-4 py-2 font-medium">External IP</th>
                    <th class="px-4 py-2 font-medium">Ports</th>
                    <th class="px-4 py-2 font-medium">Age</th>
                  </tr>
                </thead>
                <tbody>
                  @for (svc of filteredServices(); track svc.name) {
                    <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer" (click)="selectResource('services', svc.name, svc.namespace)">
                      <td class="px-4 py-2 text-zinc-200 font-mono text-xs">{{ svc.name }}</td>
                      <td class="px-4 py-2 text-zinc-300">{{ svc.serviceType }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ svc.clusterIp ?? '-' }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ svc.externalIp ?? '-' }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ svc.ports?.join(', ') || '-' }}</td>
                      <td class="px-4 py-2 text-zinc-400">{{ svc.age }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="text-center py-8 text-zinc-500">No services found</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <!-- Nodes (specialized table) -->
          @if (activeTab() === 'nodes') {
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-800 text-zinc-400 text-left">
                    <th class="px-4 py-2 font-medium">Name</th>
                    <th class="px-4 py-2 font-medium">Status</th>
                    <th class="px-4 py-2 font-medium">Roles</th>
                    <th class="px-4 py-2 font-medium">Version</th>
                    <th class="px-4 py-2 font-medium">CPU/Mem</th>
                    <th class="px-4 py-2 font-medium">Taints</th>
                    <th class="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (node of filteredGenericResources(); track node.metadata?.name) {
                    <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer" (click)="selectResource('nodes', node.metadata?.name, node.metadata?.namespace)">
                      <td class="px-4 py-2 text-zinc-200 font-mono text-xs">{{ node.metadata?.name ?? '-' }}</td>
                      <td class="px-4 py-2">
                        <span class="text-xs px-1.5 py-0.5 rounded" [class]="resourceHelper.getNodeStatusClass(node)">
                          {{ resourceHelper.getNodeStatus(node) }}
                        </span>
                      </td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ resourceHelper.getNodeRoles(node) }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ node.status?.nodeInfo?.kubeletVersion ?? '-' }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ resourceHelper.getNodeCapacity(node) }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ resourceHelper.getNodeTaints(node) }}</td>
                      <td class="px-4 py-2">
                        <div class="flex items-center gap-1">
                          @if (node.spec?.unschedulable) {
                            <button
                              (click)="uncordonNode(node.metadata?.name); $event.stopPropagation()"
                              class="text-zinc-400 hover:text-green-400 p-1 flex items-center gap-0.5"
                              title="Uncordon: make node schedulable"
                              [disabled]="nodeActionInProgress()"
                            >
                              <lucide-icon [img]="ShieldOff" [size]="13" />
                              <span class="text-[10px]">Uncordon</span>
                            </button>
                          } @else {
                            <button
                              (click)="cordonNode(node.metadata?.name); $event.stopPropagation()"
                              class="text-zinc-400 hover:text-yellow-400 p-1 flex items-center gap-0.5"
                              title="Cordon: prevent new pod scheduling"
                              [disabled]="nodeActionInProgress()"
                            >
                              <lucide-icon [img]="Shield" [size]="13" />
                              <span class="text-[10px]">Cordon</span>
                            </button>
                          }
                          @if (confirmingDrainNode() === node.metadata?.name) {
                            <button
                              (click)="confirmingDrainNode.set(null); $event.stopPropagation()"
                              class="text-[10px] text-zinc-400 hover:text-zinc-300 px-1 py-0.5 rounded hover:bg-zinc-800"
                            >Cancel</button>
                            <button
                              (click)="drainNode(node.metadata?.name); $event.stopPropagation()"
                              class="text-[10px] text-red-400 bg-red-950/40 hover:bg-red-950/60 px-1 py-0.5 rounded"
                            >Drain</button>
                          } @else {
                            <button
                              (click)="confirmingDrainNode.set(node.metadata?.name); $event.stopPropagation()"
                              class="text-zinc-400 hover:text-red-400 p-1 flex items-center gap-0.5"
                              title="Drain: evict all pods and cordon"
                              [disabled]="nodeActionInProgress()"
                            >
                              <lucide-icon [img]="ShieldAlert" [size]="13" />
                              <span class="text-[10px]">Drain</span>
                            </button>
                          }
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="text-center py-8 text-zinc-500">No nodes found</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <!-- Generic resource table for additional resource types -->
          @if (!['pods', 'deployments', 'services', 'nodes'].includes(activeTab())) {
            <div class="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-800 text-zinc-400 text-left">
                    <th class="px-4 py-2 font-medium">Name</th>
                    <th class="px-4 py-2 font-medium">Namespace</th>
                    <th class="px-4 py-2 font-medium">Status</th>
                    <th class="px-4 py-2 font-medium">Age</th>
                    <th class="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (res of filteredGenericResources(); track res.metadata?.name) {
                    <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer" (click)="selectResource(activeTab(), res.metadata?.name, res.metadata?.namespace)">
                      <td class="px-4 py-2 text-zinc-200 font-mono text-xs">{{ res.metadata?.name ?? '-' }}</td>
                      <td class="px-4 py-2 text-zinc-400 text-xs">{{ res.metadata?.namespace ?? '-' }}</td>
                      <td class="px-4 py-2">
                        <span class="text-xs px-1.5 py-0.5 rounded" [class]="resourceHelper.getGenericStatusClass(res)">
                          {{ resourceHelper.getGenericStatus(res) }}
                        </span>
                      </td>
                      <td class="px-4 py-2 text-zinc-400">{{ resourceHelper.getResourceAge(res) }}</td>
                      <td class="px-4 py-2">
                        <div class="flex items-center gap-1">
                          @if (activeTab() === 'statefulsets') {
                            <button (click)="scaleStatefulSet(res, -1); $event.stopPropagation()" [disabled]="scalingDeployment() === res.metadata?.name" class="text-zinc-400 hover:text-zinc-200 text-xs px-1 disabled:opacity-50" title="Scale down">-</button>
                            <button (click)="scaleStatefulSet(res, 1); $event.stopPropagation()" [disabled]="scalingDeployment() === res.metadata?.name" class="text-zinc-400 hover:text-zinc-200 text-xs px-1 disabled:opacity-50" title="Scale up">+</button>
                          }
                          @if (activeTab() === 'statefulsets' || activeTab() === 'daemonsets') {
                            <button (click)="restartWorkload(res); $event.stopPropagation()" class="text-zinc-400 hover:text-orange-400 p-1" title="Rolling restart">
                              <lucide-icon [img]="RotateCw" [size]="13" />
                            </button>
                          }
                          @if (confirmingDeleteResource() === res.metadata?.name) {
                            <button
                              (click)="confirmingDeleteResource.set(null); $event.stopPropagation()"
                              class="text-[11px] text-zinc-400 hover:text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800"
                            >Cancel</button>
                            <button
                              (click)="deleteGenericResource(res); $event.stopPropagation()"
                              class="text-[11px] text-red-400 bg-red-950/40 hover:bg-red-950/60 px-1.5 py-0.5 rounded"
                            >Delete</button>
                          } @else {
                            <button
                              (click)="confirmingDeleteResource.set(res.metadata?.name); $event.stopPropagation()"
                              class="text-zinc-500 hover:text-red-400 p-1"
                              title="Delete resource"
                              aria-label="Delete resource"
                            >
                              <lucide-icon [img]="Trash2" [size]="13" />
                            </button>
                          }
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="5" class="text-center py-8 text-zinc-500">No resources found</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }

      <!-- Resource Detail Slide-over -->
      @if (detailResource()) {
        <app-k8s-resource-detail
          [connectionId]="connectionId"
          [clusterId]="selectedCluster()!.id"
          [kind]="detailKind()"
          [name]="detailName()"
          [namespace]="detailNamespace()"
          [rawResource]="detailResource()"
          (close)="closeDetail()"
        />
      }

      <!-- Add Cluster Modal -->
      @if (showAddCluster()) {
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="add-cluster-title" (click)="showAddCluster.set(false)" (keydown.escape)="showAddCluster.set(false)">
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-6 w-full max-w-lg space-y-4" (click)="$event.stopPropagation()">
            <h3 id="add-cluster-title" class="text-lg font-medium text-zinc-100">Add Kubernetes Cluster</h3>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Project</label>
              <select
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:border-blue-500 focus:outline-none"
                [ngModel]="selectedProjectId()"
                (ngModelChange)="onProjectSelected($event)"
              >
                @for (project of availableProjects(); track project.id) {
                  <option [value]="project.id">{{ project.name }}</option>
                }
              </select>
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Environment</label>
              <select
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:border-blue-500 focus:outline-none"
                [ngModel]="selectedEnvironmentId()"
                (ngModelChange)="selectedEnvironmentId.set($event)"
              >
                @for (env of availableEnvironments(); track env.id) {
                  <option [value]="env.id">{{ env.name }}</option>
                }
              </select>
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Cluster Name</label>
              <input
                type="text"
                [(ngModel)]="newClusterName"
                placeholder="production-cluster"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Kubeconfig (YAML)</label>
              <p class="text-xs text-yellow-500/80 mb-1">Contains sensitive credentials. Transmitted encrypted to the server.</p>
              <div class="h-[250px] rounded-lg border border-zinc-700 overflow-hidden">
                <app-monaco-editor
                  [content]="newKubeconfig"
                  language="yaml"
                  (contentChange)="newKubeconfig = $event"
                  class="h-full"
                />
              </div>
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Context (optional)</label>
              <input
                type="text"
                [(ngModel)]="newContextName"
                placeholder="Leave empty for default context"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            @if (addClusterError()) {
              <div class="text-red-400 text-sm">{{ addClusterError() }}</div>
            }

            <div class="flex gap-2 justify-end">
              <button (click)="showAddCluster.set(false)" class="px-4 py-2 text-zinc-400 hover:text-zinc-300 text-sm">
                Cancel
              </button>
              <button
                (click)="addCluster()"
                [disabled]="addingCluster() || !newClusterName.trim() || !newKubeconfig.trim() || !selectedProjectId() || !selectedEnvironmentId()"
                class="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm rounded-lg px-4 py-2"
              >
                @if (addingCluster()) {
                  <lucide-icon [img]="Loader2" [size]="14" class="animate-spin" />
                }
                Add Cluster
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Edit Cluster Modal -->
      @if (showEditCluster()) {
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-cluster-title" (click)="showEditCluster.set(false)" (keydown.escape)="showEditCluster.set(false)">
          <div class="bg-zinc-900 rounded-xl border border-zinc-800 p-6 w-full max-w-lg space-y-4" (click)="$event.stopPropagation()">
            <h3 id="edit-cluster-title" class="text-lg font-medium text-zinc-100">Edit Cluster</h3>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Cluster Name</label>
              <input
                type="text"
                [(ngModel)]="editClusterName"
                placeholder="production-cluster"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Kubeconfig (YAML)</label>
              <p class="text-xs text-zinc-500 mb-1">Leave empty to keep the existing kubeconfig.</p>
              <div class="h-[250px] rounded-lg border border-zinc-700 overflow-hidden">
                <app-monaco-editor
                  [content]="editKubeconfig"
                  language="yaml"
                  (contentChange)="editKubeconfig = $event"
                  class="h-full"
                />
              </div>
            </div>

            <div>
              <label class="block text-sm text-zinc-300 mb-1">Context (optional)</label>
              <input
                type="text"
                [(ngModel)]="editContextName"
                placeholder="Leave empty for default context"
                class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            @if (editClusterError()) {
              <div class="text-red-400 text-sm">{{ editClusterError() }}</div>
            }

            <div class="flex gap-2 justify-end">
              <button (click)="showEditCluster.set(false)" class="px-4 py-2 text-zinc-400 hover:text-zinc-300 text-sm">
                Cancel
              </button>
              <button
                (click)="saveEditCluster()"
                [disabled]="editingCluster() || !editClusterName.trim()"
                class="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm rounded-lg px-4 py-2"
              >
                @if (editingCluster()) {
                  <lucide-icon [img]="Loader2" [size]="14" class="animate-spin" />
                }
                Save Changes
              </button>
            </div>
          </div>
        </div>
      }
      <!-- Create Resource Modal -->
      @if (showCreateResource() && selectedCluster()) {
        <app-k8s-create-resource-modal
          [resourceType]="activeTab()"
          [namespace]="selectedNs()"
          [namespaces]="namespaces()"
          [connectionId]="connectionId"
          [clusterId]="selectedCluster()!.id"
          [activeCrd]="activeCrd()"
          (close)="showCreateResource.set(false)"
          (created)="onResourceCreated()"
        />
      }
    </div>
  `,
})
export class K8sDashboardComponent implements OnInit, OnChanges, OnDestroy {
  private backend = inject(BackendService);
  private watchService = inject(K8sWatchService);
  readonly resourceHelper = inject(K8sResourceHelperService);

  @Input() connectionId!: string;

  readonly Cloud = Cloud;
  readonly Plus = Plus;
  readonly Trash2 = Trash2;
  readonly Loader2 = Loader2;
  readonly RefreshCw = RefreshCw;
  readonly ChevronDown = ChevronDown;
  readonly Box = Box;
  readonly Layers = Layers;
  readonly Globe = Globe;
  readonly Scale = Scale;
  readonly Play = Play;
  readonly CheckCircle = CheckCircle;
  readonly XCircle = XCircle;
  readonly RotateCw = RotateCw;
  readonly NetworkIcon = Network;
  readonly Shield = Shield;
  readonly ShieldOff = ShieldOff;
  readonly ShieldAlert = ShieldAlert;
  readonly SearchIcon = Search;
  readonly RadioIcon = Radio;
  readonly Pencil = Pencil;

  confirmingRemoveCluster = signal<K8sCluster | null>(null);
  clusterTestResults = signal<Map<string, string>>(new Map());
  manageMode = signal(false);

  // Resource detail panel
  detailResource = signal<any>(null);
  detailKind = signal('');
  detailName = signal('');
  detailNamespace = signal('');
  clusterGroups = signal<ClusterGroup[]>([]);
  allClusters = computed(() => this.clusterGroups().flatMap(g => g.clusters));
  selectedCluster = signal<K8sCluster | null>(null);
  namespaces = signal<K8sNamespace[]>([]);
  selectedNs = signal<string>('default');
  pods = signal<K8sPod[]>([]);
  deployments = signal<K8sDeployment[]>([]);
  services = signal<K8sSvc[]>([]);
  refreshing = signal(false);
  genericResources = signal<any[]>([]);
  confirmingDeleteResource = signal<string | null>(null);

  // Topology
  showTopology = signal(false);
  topologyData = signal<K8sTopology | null>(null);
  loadingTopology = signal(false);

  // Node management
  confirmingDrainNode = signal<string | null>(null);
  nodeActionInProgress = signal(false);

  // Create resource modal
  showCreateResource = signal(false);

  // Search & watch
  searchFilter = signal('');
  watchStatus = signal<'live' | 'disconnected' | 'connecting'>('disconnected');
  private watchUnsubscribe: (() => void) | null = null;

  activeTab = signal<K8sTab>('pods');
  activeCategory = signal<K8sCategory>('workloads');

  readonly k8sCategories: { key: K8sCategory; label: string; tabs: { key: K8sTab; label: string }[] }[] = [
    { key: 'workloads', label: 'Workloads', tabs: [
      { key: 'pods', label: 'Pods' },
      { key: 'deployments', label: 'Deployments' },
      { key: 'statefulsets', label: 'StatefulSets' },
      { key: 'daemonsets', label: 'DaemonSets' },
      { key: 'jobs', label: 'Jobs' },
      { key: 'cronjobs', label: 'CronJobs' },
      { key: 'horizontalpodautoscalers', label: 'HPAs' },
      { key: 'poddisruptionbudgets', label: 'PDBs' },
    ]},
    { key: 'networking', label: 'Networking', tabs: [
      { key: 'services', label: 'Services' },
      { key: 'ingresses', label: 'Ingresses' },
      { key: 'ingressclasses', label: 'IngressClasses' },
      { key: 'networkpolicies', label: 'NetworkPolicies' },
      { key: 'endpoints', label: 'Endpoints' },
    ]},
    { key: 'config', label: 'Config', tabs: [
      { key: 'configmaps', label: 'ConfigMaps' },
      { key: 'secrets', label: 'Secrets' },
      { key: 'resourcequotas', label: 'ResourceQuotas' },
      { key: 'limitranges', label: 'LimitRanges' },
    ]},
    { key: 'storage', label: 'Storage', tabs: [
      { key: 'pvcs', label: 'PVCs' },
      { key: 'persistentvolumes', label: 'PVs' },
      { key: 'storageclasses', label: 'StorageClasses' },
    ]},
    { key: 'access', label: 'Access Control', tabs: [
      { key: 'serviceaccounts', label: 'ServiceAccounts' },
      { key: 'roles', label: 'Roles' },
      { key: 'rolebindings', label: 'RoleBindings' },
      { key: 'clusterroles', label: 'ClusterRoles' },
      { key: 'clusterrolebindings', label: 'ClusterRoleBindings' },
    ]},
    { key: 'cluster', label: 'Cluster', tabs: [
      { key: 'nodes', label: 'Nodes' },
    ]},
  ];

  // CRD discovery
  discoveredCrds = signal<K8sApiResource[]>([]);
  crdTabs = computed(() => this.discoveredCrds().map(crd => ({
    key: crd.plural as K8sTab,
    label: crd.kind,
    crd,
  })));
  activeCrd = signal<K8sApiResource | null>(null);

  // Cluster-scoped tab detection
  private readonly clusterScopedTabs = new Set([
    'nodes', 'persistentvolumes', 'storageclasses', 'clusterroles', 'clusterrolebindings', 'ingressclasses',
  ]);

  activeCategoryTabs = computed(() =>
    this.k8sCategories.find(c => c.key === this.activeCategory())?.tabs ?? []
  );

  showAddCluster = signal(false);
  newClusterName = '';
  newKubeconfig = '';
  newContextName = '';
  addingCluster = signal(false);
  addClusterError = signal<string | null>(null);
  operationError = signal<string | null>(null);

  // Edit cluster modal
  showEditCluster = signal(false);
  editClusterId = signal<string | null>(null);
  editClusterName = '';
  editKubeconfig = '';
  editContextName = '';
  editingCluster = signal(false);
  editClusterError = signal<string | null>(null);

  // Project/environment selector state for Add Cluster modal
  selectedProjectId = signal<string>('');
  selectedEnvironmentId = signal<string>('');
  availableEnvironments = signal<Environment[]>([]);
  availableProjects = computed(() => this.backend.getConnection(this.connectionId)?.projects ?? []);

  // Filtered signals for search
  filteredPods = computed(() => {
    const filter = this.searchFilter().toLowerCase();
    if (!filter) return this.pods();
    return this.pods().filter(p => p.name.toLowerCase().includes(filter));
  });
  filteredDeployments = computed(() => {
    const filter = this.searchFilter().toLowerCase();
    if (!filter) return this.deployments();
    return this.deployments().filter(d => d.name.toLowerCase().includes(filter));
  });
  filteredServices = computed(() => {
    const filter = this.searchFilter().toLowerCase();
    if (!filter) return this.services();
    return this.services().filter(s => s.name.toLowerCase().includes(filter));
  });
  filteredGenericResources = computed(() => {
    const filter = this.searchFilter().toLowerCase();
    if (!filter) return this.genericResources();
    return this.genericResources().filter(r =>
      (r.metadata?.name ?? '').toLowerCase().includes(filter)
    );
  });

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.showAddCluster.set(false);
  }

  ngOnInit(): void {
    this.loadClusters();
  }

  ngOnDestroy(): void {
    this.stopWatch();
    this.watchService.disconnectAll();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['connectionId'] && !changes['connectionId'].firstChange) {
      this.selectedCluster.set(null);
      this.pods.set([]);
      this.deployments.set([]);
      this.services.set([]);
      this.genericResources.set([]);
      this.namespaces.set([]);
      this.selectedNs.set('default');
      this.loadClusters();
    }
  }

  async loadClusters(): Promise<void> {
    try {
      const conn = this.backend.getConnection(this.connectionId);
      const projects = conn?.projects ?? [];
      const groups: ClusterGroup[] = [];

      for (const project of projects) {
        let envs: Environment[] = [];
        try {
          envs = await this.backend.listEnvironmentsFor(this.connectionId, project.id);
        } catch (e) {
          console.warn(`Failed to load environments for project ${project.id}:`, e);
        }

        for (const env of envs) {
          let clusters: K8sCluster[] = [];
          try {
            clusters = await this.backend.listClustersInEnvironmentFor(this.connectionId, project.id, env.id);
          } catch (e) {
            console.warn(`Failed to load clusters for ${project.id}/${env.id}:`, e);
          }

          if (clusters.length > 0) {
            groups.push({ project, environment: env, clusters });
          }
        }
      }

      this.clusterGroups.set(groups);

      // Auto-test all clusters in parallel
      const all = groups.flatMap(g => g.clusters);
      all.forEach(c => this.testCluster(c));

      // Auto-select first cluster if none selected
      if (!this.selectedCluster() && all.length > 0) {
        this.selectCluster(all[0]);
      }
    } catch (e) {
      console.error('Failed to load clusters:', e);
    }
  }

  showManageView(): void {
    this.manageMode.set(true);
  }

  showResourceView(): void {
    this.manageMode.set(false);
  }

  async openAddClusterModal(): Promise<void> {
    this.showAddCluster.set(true);
    this.addClusterError.set(null);
    this.newClusterName = '';
    this.newKubeconfig = '';
    this.newContextName = '';

    // Initialize project selector
    const projects = this.availableProjects();
    if (projects.length > 0) {
      await this.onProjectSelected(projects[0].id);
    } else {
      this.selectedProjectId.set('');
      this.selectedEnvironmentId.set('');
      this.availableEnvironments.set([]);
    }
  }

  async onProjectSelected(projectId: string): Promise<void> {
    this.selectedProjectId.set(projectId);
    this.availableEnvironments.set([]);
    this.selectedEnvironmentId.set('');

    if (!projectId) return;

    try {
      const envs = await this.backend.listEnvironmentsFor(this.connectionId, projectId);
      this.availableEnvironments.set(envs);

      // Default to the default environment, or the first one
      const defaultEnv = envs.find(e => e.isDefault) ?? envs[0];
      if (defaultEnv) {
        this.selectedEnvironmentId.set(defaultEnv.id);
      }
    } catch (e) {
      console.error('Failed to load environments:', e);
    }
  }

  async selectCluster(cluster: K8sCluster): Promise<void> {
    this.selectedCluster.set(cluster);
    this.manageMode.set(false);
    try {
      this.namespaces.set(await this.backend.listNamespacesFor(this.connectionId, cluster.id));
      if (this.namespaces().length > 0) {
        await this.selectNamespace(this.namespaces()[0].name);
      }
    } catch (e) {
      console.error('Failed to select cluster:', e);
    }
  }

  async selectNamespace(ns: string): Promise<void> {
    this.selectedNs.set(ns);
    await this.refreshData();
  }

  async refreshData(): Promise<void> {
    const cluster = this.selectedCluster();
    const ns = this.selectedNs();
    if (!cluster || !ns) return;

    this.refreshing.set(true);
    this.confirmingDeleteResource.set(null);
    const tab = this.activeTab();
    try {
      // Always load the three typed resource lists
      const [pods, deps, svcs] = await Promise.all([
        this.backend.listPodsFor(this.connectionId, cluster.id, ns),
        this.backend.listDeploymentsFor(this.connectionId, cluster.id, ns),
        this.backend.listServicesFor(this.connectionId, cluster.id, ns),
      ]);
      this.pods.set(pods);
      this.deployments.set(deps);
      this.services.set(svcs);

      // Load generic resources for other tabs
      const typedTabs: K8sTab[] = ['pods', 'deployments', 'services'];
      if (!typedTabs.includes(tab)) {
        const clusterScoped = this.clusterScopedTabs.has(tab);
        const resources = await this.backend.listK8sResourcesFor(
          this.connectionId, cluster.id, tab, clusterScoped ? undefined : ns
        );
        this.genericResources.set(resources);
      }

      // Load topology if visible
      if (this.showTopology()) {
        this.loadTopology(cluster.id, ns);
      }
      // Start real-time watch
      this.startWatch();
    } catch (e) {
      console.error('Failed to refresh data:', e);
    }
    this.refreshing.set(false);
  }

  /** When switching tabs, reload generic resources for the new tab */
  setCategory(cat: K8sCategory): void {
    this.activeCategory.set(cat);
    if (cat === 'custom') {
      this.loadCrdDiscovery();
      return;
    }
    const firstTab = this.k8sCategories.find(c => c.key === cat)?.tabs[0];
    if (firstTab) {
      this.onTabChange(firstTab.key);
    }
  }

  private async loadCrdDiscovery(): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    try {
      const crds = await this.backend.discoverApiResourcesFor(this.connectionId, cluster.id);
      this.discoveredCrds.set(crds);
      if (crds.length > 0) {
        this.onCrdTabChange(crds[0]);
      }
    } catch (e) {
      console.error('Failed to discover CRDs:', e);
      this.discoveredCrds.set([]);
    }
  }

  async onTabChange(tab: K8sTab): Promise<void> {
    this.activeTab.set(tab);
    this.activeCrd.set(null);
    const typedTabs: K8sTab[] = ['pods', 'deployments', 'services'];
    if (!typedTabs.includes(tab)) {
      const cluster = this.selectedCluster();
      const ns = this.selectedNs();
      if (!cluster) return;
      this.confirmingDeleteResource.set(null);
      try {
        const clusterScoped = this.clusterScopedTabs.has(tab);
        const resources = await this.backend.listK8sResourcesFor(
          this.connectionId, cluster.id, tab, clusterScoped ? undefined : ns
        );
        this.genericResources.set(resources);
      } catch (e) {
        console.error('Failed to load resources:', e);
        this.genericResources.set([]);
      }
    }
  }

  async onCrdTabChange(crd: K8sApiResource): Promise<void> {
    this.activeCrd.set(crd);
    this.activeTab.set(crd.plural as K8sTab);
    const cluster = this.selectedCluster();
    const ns = this.selectedNs();
    if (!cluster) return;
    this.confirmingDeleteResource.set(null);
    try {
      const resources = await this.backend.listCustomResourcesFor(
        this.connectionId, cluster.id, crd.group, crd.version, crd.plural,
        crd.scope === 'Namespaced' ? ns : undefined
      );
      this.genericResources.set(resources);
    } catch (e) {
      console.error('Failed to load CRD resources:', e);
      this.genericResources.set([]);
    }
  }

  async addCluster(): Promise<void> {
    this.addingCluster.set(true);
    this.addClusterError.set(null);
    try {
      const projectId = this.selectedProjectId();
      const environmentId = this.selectedEnvironmentId();
      if (!projectId) throw new Error('No project selected. Create a project first.');
      if (!environmentId) throw new Error('No environment selected.');

      await this.backend.createClusterInEnvironmentFor(this.connectionId, projectId, environmentId, {
        name: this.newClusterName.trim(),
        kubeconfig: this.newKubeconfig.trim(),
        contextName: this.newContextName.trim() || undefined,
      });
      this.showAddCluster.set(false);
      this.newClusterName = '';
      this.newKubeconfig = '';
      this.newContextName = '';
      await this.loadClusters();
    } catch (e: unknown) {
      this.addClusterError.set(e instanceof Error ? e.message : 'Failed to add cluster');
    } finally {
      this.addingCluster.set(false);
    }
  }

  openEditClusterModal(cluster: K8sCluster): void {
    this.editClusterId.set(cluster.id);
    this.editClusterName = cluster.name;
    this.editKubeconfig = '';
    this.editContextName = cluster.contextName ?? '';
    this.editClusterError.set(null);
    this.showEditCluster.set(true);
  }

  async saveEditCluster(): Promise<void> {
    const clusterId = this.editClusterId();
    if (!clusterId || !this.editClusterName.trim()) return;
    this.editingCluster.set(true);
    this.editClusterError.set(null);
    try {
      const data: { name?: string; kubeconfig?: string; contextName?: string } = {
        name: this.editClusterName.trim(),
      };
      if (this.editKubeconfig.trim()) {
        data.kubeconfig = this.editKubeconfig.trim();
      }
      data.contextName = this.editContextName.trim() || undefined;

      await this.backend.updateClusterFor(this.connectionId, clusterId, data);
      this.showEditCluster.set(false);
      await this.loadClusters();
    } catch (e: unknown) {
      this.editClusterError.set(e instanceof Error ? e.message : 'Failed to update cluster');
    } finally {
      this.editingCluster.set(false);
    }
  }

  promptRemoveCluster(cluster: K8sCluster): void {
    this.confirmingRemoveCluster.set(cluster);
  }

  async removeCluster(cluster: K8sCluster): Promise<void> {
    this.confirmingRemoveCluster.set(null);
    try {
      await this.backend.deleteClusterFor(this.connectionId, cluster.id);
      if (this.selectedCluster()?.id === cluster.id) {
        this.selectedCluster.set(null);
      }
      await this.loadClusters();
    } catch (e: unknown) {
      console.error('Failed to remove cluster:', e);
      this.operationError.set(e instanceof Error ? e.message : 'Failed to remove cluster');
    }
  }

  async testCluster(cluster: K8sCluster): Promise<void> {
    this.clusterTestResults.update(m => { const n = new Map(m); n.set(cluster.id, 'testing'); return n; });
    try {
      await this.backend.testClusterFor(this.connectionId, cluster.id);
      this.clusterTestResults.update(m => { const n = new Map(m); n.set(cluster.id, 'success'); return n; });
    } catch (e: any) {
      console.error('Failed to test cluster:', e);
      this.clusterTestResults.update(m => { const n = new Map(m); n.set(cluster.id, 'error'); return n; });
    }
  }

  private readonly MAX_REPLICAS = 50;
  scalingDeployment = signal<string | null>(null);

  private parseReplicaCount(ready: string): number | null {
    const parts = ready.split('/');
    if (parts.length !== 2) return null;
    const count = parseInt(parts[1], 10);
    return isNaN(count) ? null : count;
  }

  async scaleUp(dep: K8sDeployment): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster || this.scalingDeployment()) return;
    const current = this.parseReplicaCount(dep.ready);
    if (current === null) return;
    if (current >= this.MAX_REPLICAS) {
      console.warn(`Cannot scale beyond ${this.MAX_REPLICAS} replicas`);
      return;
    }
    this.scalingDeployment.set(dep.name);
    try {
      await this.backend.scaleDeploymentFor(this.connectionId, cluster.id, dep.namespace, dep.name, current + 1);
      await this.refreshData();
    } catch (e) {
      console.error('Failed to scale up deployment:', e);
    } finally {
      this.scalingDeployment.set(null);
    }
  }

  async scaleDown(dep: K8sDeployment): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster || this.scalingDeployment()) return;
    const current = this.parseReplicaCount(dep.ready);
    if (current === null || current <= 0) return;
    this.scalingDeployment.set(dep.name);
    try {
      await this.backend.scaleDeploymentFor(this.connectionId, cluster.id, dep.namespace, dep.name, current - 1);
      await this.refreshData();
    } catch (e) {
      console.error('Failed to scale down deployment:', e);
    } finally {
      this.scalingDeployment.set(null);
    }
  }

  getClusterStatusDotClass(clusterId: string): string {
    const result = this.clusterTestResults().get(clusterId);
    if (result === 'success') return 'bg-green-500';
    if (result === 'error') return 'bg-red-500';
    if (result === 'testing') return 'bg-zinc-500 animate-pulse';
    return 'bg-zinc-600';
  }

  getPodStatusClass(status: string): string {
    switch (status) {
      case 'Running': return 'bg-green-500/20 text-green-400';
      case 'Pending': return 'bg-yellow-500/20 text-yellow-400';
      case 'Failed': return 'bg-red-500/20 text-red-400';
      case 'Succeeded': return 'bg-blue-500/20 text-blue-400';
      default: return 'bg-zinc-700 text-zinc-400';
    }
  }

  // ---------- Deployment actions ----------

  async restartDeployment(dep: K8sDeployment): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    try {
      await this.backend.restartDeploymentFor(this.connectionId, cluster.id, dep.namespace, dep.name);
      await this.refreshData();
    } catch (e) {
      console.error('Failed to restart deployment:', e);
    }
  }

  // ---------- Resource detail panel ----------

  async selectResource(kind: string, name: string, namespace?: string): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster || !name) return;
    const ns = namespace || this.selectedNs();
    try {
      const clusterScoped = this.clusterScopedTabs.has(kind) || kind === 'namespaces';
      const raw = await this.backend.getK8sResourceFor(
        this.connectionId, cluster.id, kind, name, clusterScoped ? undefined : ns
      );
      this.detailKind.set(kind);
      this.detailName.set(name);
      this.detailNamespace.set(ns);
      this.detailResource.set(raw);
    } catch (e) {
      console.error('Failed to load resource details:', e);
    }
  }

  closeDetail(): void {
    this.detailResource.set(null);
  }


  async deleteGenericResource(res: any): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    const name = res.metadata?.name;
    const ns = res.metadata?.namespace;
    if (!name) return;
    this.confirmingDeleteResource.set(null);
    try {
      await this.backend.deleteK8sResourceFor(this.connectionId, cluster.id, this.activeTab(), name, ns);
      await this.refreshData();
    } catch (e) {
      console.error('Failed to delete resource:', e);
    }
  }

  // ---------- Topology ----------

  private async loadTopology(clusterId: string, ns: string): Promise<void> {
    this.loadingTopology.set(true);
    try {
      const topo = await this.backend.getNamespaceTopologyFor(this.connectionId, clusterId, ns);
      this.topologyData.set(topo);
    } catch (e) {
      console.error('Failed to load topology:', e);
      this.topologyData.set(null);
    } finally {
      this.loadingTopology.set(false);
    }
  }


  async cordonNode(nodeName: string): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster || !nodeName) return;
    this.nodeActionInProgress.set(true);
    try {
      await this.backend.cordonNodeFor(this.connectionId, cluster.id, nodeName);
      await this.onTabChange('nodes');
    } catch (e) {
      console.error('Failed to cordon node:', e);
    } finally {
      this.nodeActionInProgress.set(false);
    }
  }

  async uncordonNode(nodeName: string): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster || !nodeName) return;
    this.nodeActionInProgress.set(true);
    try {
      await this.backend.uncordonNodeFor(this.connectionId, cluster.id, nodeName);
      await this.onTabChange('nodes');
    } catch (e) {
      console.error('Failed to uncordon node:', e);
    } finally {
      this.nodeActionInProgress.set(false);
    }
  }

  async drainNode(nodeName: string): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster || !nodeName) return;
    this.confirmingDrainNode.set(null);
    this.nodeActionInProgress.set(true);
    try {
      await this.backend.drainNodeFor(this.connectionId, cluster.id, nodeName);
      await this.onTabChange('nodes');
    } catch (e) {
      console.error('Failed to drain node:', e);
    } finally {
      this.nodeActionInProgress.set(false);
    }
  }

  // ---------- StatefulSet / DaemonSet actions ----------

  async scaleStatefulSet(res: any, delta: number): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster || this.scalingDeployment()) return;
    const name = res.metadata?.name;
    const ns = res.metadata?.namespace ?? this.selectedNs();
    const current = res.spec?.replicas ?? 0;
    const target = current + delta;
    if (target < 0 || target > this.MAX_REPLICAS) return;
    this.scalingDeployment.set(name);
    try {
      await this.backend.scaleStatefulSetFor(this.connectionId, cluster.id, ns, name, target);
      await this.onTabChange(this.activeTab());
    } catch (e) {
      console.error('Failed to scale statefulset:', e);
    } finally {
      this.scalingDeployment.set(null);
    }
  }

  async restartWorkload(res: any): Promise<void> {
    const cluster = this.selectedCluster();
    if (!cluster) return;
    const name = res.metadata?.name;
    const ns = res.metadata?.namespace ?? this.selectedNs();
    const tab = this.activeTab();
    try {
      if (tab === 'statefulsets') {
        await this.backend.restartStatefulSetFor(this.connectionId, cluster.id, ns, name);
      } else if (tab === 'daemonsets') {
        await this.backend.restartDaemonSetFor(this.connectionId, cluster.id, ns, name);
      }
      await this.onTabChange(tab);
    } catch (e) {
      console.error('Failed to restart workload:', e);
    }
  }

  // ---------- Create resource ----------

  openCreateResourceModal(): void {
    this.showCreateResource.set(true);
  }

  onResourceCreated(): void {
    const crd = this.activeCrd();
    if (crd) {
      this.onCrdTabChange(crd);
    } else {
      this.onTabChange(this.activeTab());
    }
  }

  // ---------- Tab badge counts ----------

  getTabCount(tab: K8sTab): number {
    switch (tab) {
      case 'pods': return this.pods().length;
      case 'deployments': return this.deployments().length;
      case 'services': return this.services().length;
      default: return 0; // Generic tabs don't have counts until loaded
    }
  }

  // ---------- Real-time watch ----------

  private startWatch(): void {
    this.stopWatch();
    const cluster = this.selectedCluster();
    const ns = this.selectedNs();
    if (!cluster || !ns) return;

    const kinds = ['pods', 'deployments', 'services', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs',
      'configmaps', 'secrets', 'ingresses', 'pvcs'];
    this.watchUnsubscribe = this.watchService.subscribe(
      this.connectionId,
      cluster.id,
      ns,
      kinds,
      (event: K8sWatchEvent) => this.handleWatchEvent(event),
      (status) => this.watchStatus.set(status),
    );
  }

  private stopWatch(): void {
    if (this.watchUnsubscribe) {
      this.watchUnsubscribe();
      this.watchUnsubscribe = null;
    }
    this.watchStatus.set('disconnected');
  }

  private handleWatchEvent(event: K8sWatchEvent): void {
    const name = event.resource?.metadata?.name;
    if (!name) return;

    if (event.kind === 'pods') {
      this.pods.update(current => {
        if (event.eventType === 'DELETED') {
          return current.filter(p => p.name !== name);
        }
        // MODIFIED: update or add
        const pod = this.resourceHelper.mapPodFromRaw(event.resource);
        const idx = current.findIndex(p => p.name === name);
        if (idx >= 0) {
          const updated = [...current];
          updated[idx] = pod;
          return updated;
        }
        return [...current, pod];
      });
    } else if (event.kind === 'deployments') {
      this.deployments.update(current => {
        if (event.eventType === 'DELETED') {
          return current.filter(d => d.name !== name);
        }
        const dep = this.resourceHelper.mapDeploymentFromRaw(event.resource);
        const idx = current.findIndex(d => d.name === name);
        if (idx >= 0) {
          const updated = [...current];
          updated[idx] = dep;
          return updated;
        }
        return [...current, dep];
      });
    } else if (event.kind === 'services') {
      this.services.update(current => {
        if (event.eventType === 'DELETED') {
          return current.filter(s => s.name !== name);
        }
        const svc = this.resourceHelper.mapServiceFromRaw(event.resource);
        const idx = current.findIndex(s => s.name === name);
        if (idx >= 0) {
          const updated = [...current];
          updated[idx] = svc;
          return updated;
        }
        return [...current, svc];
      });
    } else if (event.kind === this.activeTab()) {
      // Generic resource watch update (statefulsets, daemonsets, etc.)
      this.genericResources.update(current => {
        if (event.eventType === 'DELETED') {
          return current.filter(r => r.metadata?.name !== name);
        }
        const idx = current.findIndex(r => r.metadata?.name === name);
        if (idx >= 0) {
          const updated = [...current];
          updated[idx] = event.resource;
          return updated;
        }
        return [...current, event.resource];
      });
    }
  }

}
