import { CommonModule } from '@angular/common';
import { Component, Input, signal, OnChanges } from '@angular/core';

export interface K8sCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface K8sEvent {
  type: 'Normal' | 'Warning';
  reason: string;
  object: string;
  message: string;
  firstSeen: string;
  count: number;
}

@Component({
  selector: 'app-k8s-resource-detail',
  imports: [CommonModule],
  templateUrl: './k8s-resource-detail.component.html',
})
export class K8sResourceDetailComponent implements OnChanges {
  @Input() resourceName = '';
  @Input() resourceKind = 'Pod';

  activeTab = signal<'conditions' | 'events'>('conditions');

  conditions = signal<K8sCondition[]>([]);
  events = signal<K8sEvent[]>([]);

  ngOnChanges(): void {
    this.conditions.set([
      { type: 'Initialized', status: 'True', reason: 'PodCompleted', message: '', lastTransitionTime: '2024-01-15T10:30:00Z' },
      { type: 'Ready', status: 'False', reason: 'ContainersNotReady', message: 'containers with unready status: [app]', lastTransitionTime: '2024-01-15T10:31:00Z' },
      { type: 'ContainersReady', status: 'False', reason: 'ContainersNotReady', message: 'containers with unready status: [app]', lastTransitionTime: '2024-01-15T10:31:00Z' },
      { type: 'PodScheduled', status: 'True', reason: 'PodCompleted', message: '', lastTransitionTime: '2024-01-15T10:29:55Z' },
    ]);
    this.events.set([
      { type: 'Normal', reason: 'Scheduled', object: `${this.resourceKind.toLowerCase()}/${this.resourceName}`, message: 'Successfully assigned default/app to node-02', firstSeen: '10m', count: 1 },
      { type: 'Normal', reason: 'Pulling', object: `${this.resourceKind.toLowerCase()}/${this.resourceName}`, message: 'Pulling image "nginx:1.25"', firstSeen: '10m', count: 1 },
      { type: 'Normal', reason: 'Pulled', object: `${this.resourceKind.toLowerCase()}/${this.resourceName}`, message: 'Successfully pulled image "nginx:1.25"', firstSeen: '9m', count: 1 },
      { type: 'Warning', reason: 'BackOff', object: `${this.resourceKind.toLowerCase()}/${this.resourceName}`, message: 'Back-off restarting failed container app in pod', firstSeen: '5m', count: 4 },
    ]);
  }

  setTab(tab: 'conditions' | 'events'): void {
    this.activeTab.set(tab);
  }

  conditionStatusClass(status: K8sCondition['status']): string {
    switch (status) {
      case 'True': return 'text-green-400';
      case 'False': return 'text-red-400';
      case 'Unknown': return 'text-zinc-400';
    }
  }

  eventTypeClass(type: K8sEvent['type']): string {
    return type === 'Warning' ? 'text-yellow-400' : 'text-blue-400';
  }
}
