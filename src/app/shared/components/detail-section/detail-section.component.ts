import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Box,
  Network,
  Cpu,
  Variable,
  HardDrive,
  Server,
  Info,
  Copy,
  ChevronDown,
  ChevronRight,
  Shield,
  Settings,
  FileText,
  Tag,
  Terminal,
  LucideIconData,
} from 'lucide-angular';

const ICON_MAP: Record<string, LucideIconData> = {
  box: Box,
  network: Network,
  cpu: Cpu,
  variable: Variable,
  'hard-drive': HardDrive,
  server: Server,
  info: Info,
  shield: Shield,
  settings: Settings,
  'file-text': FileText,
  tag: Tag,
  terminal: Terminal,
};

@Component({
  selector: 'app-detail-section',
  imports: [LucideAngularModule],
  templateUrl: './detail-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailSectionComponent {
  title = input.required<string>();
  icon = input<string>('info');
  showCopyAll = input(false);
  copyAllFn = input<(() => void) | null>(null);
  collapsible = input(false);

  collapsed = signal(true);

  readonly Copy = Copy;
  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;

  getIcon(): LucideIconData {
    return ICON_MAP[this.icon()] ?? Info;
  }

  toggle(): void {
    this.collapsed.update((v) => !v);
  }

  onCopyAll(): void {
    const fn = this.copyAllFn();
    if (fn) {
      fn();
    }
  }
}
