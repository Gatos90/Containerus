import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, HelpCircle, X } from 'lucide-angular';

export type HelpFeature =
  | 'ai-terminal'
  | 'k8s-topology'
  | 'jump-hosts'
  | 'runtime-selector'
  | 'command-templates';

interface FeatureCopy {
  title: string;
  body: string;
  badge?: string;
}

const FEATURE_COPY: Record<HelpFeature, FeatureCopy> = {
  'ai-terminal': {
    title: 'AI Terminal',
    badge: 'AI',
    body: 'An embedded terminal with an AI co-pilot. Type naturally — the AI can suggest commands, explain output, fix errors, and run multi-step tasks for you. Powered by your configured LLM provider.',
  },
  'k8s-topology': {
    title: 'K8s Topology',
    badge: 'Kubernetes',
    body: 'Visual graph of your Kubernetes cluster — nodes, namespaces, deployments, pods, and services. Click any resource to drill into logs, events, and live status.',
  },
  'jump-hosts': {
    title: 'Jump Hosts (ProxyJump)',
    body: 'Chain SSH connections through one or more bastion hosts to reach private servers. Configure jump hosts per system — Containerus handles the tunnel automatically.',
  },
  'runtime-selector': {
    title: 'Runtime Selector',
    body: 'Switch between Docker, Podman, and Apple Container Runtime on the same host. Containerus auto-detects available runtimes and lets you choose the active one per system.',
  },
  'command-templates': {
    title: 'Command Templates',
    body: 'Save and re-run shell commands with variable placeholders. Templates are scoped per system and can be shared across your team in Backend mode.',
  },
};

@Component({
  selector: 'app-help-tooltip',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './help-tooltip.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpTooltipComponent {
  private readonly elRef = inject(ElementRef);

  readonly feature = input.required<HelpFeature>();

  readonly HelpCircle = HelpCircle;
  readonly X = X;

  readonly open = signal(false);

  get copy(): FeatureCopy {
    return FEATURE_COPY[this.feature()];
  }

  toggle(): void {
    this.open.update(v => !v);
  }

  close(): void {
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elRef.nativeElement.contains(event.target)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }
}
