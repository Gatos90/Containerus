import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, X, Sparkles, Tag } from 'lucide-angular';
import { ChangelogEntry } from '../../../state/changelog.state';

@Component({
  selector: 'app-whats-new-modal',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './whats-new-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onDismiss()',
  },
})
export class WhatsNewModalComponent {
  readonly entries = input.required<ChangelogEntry[]>();
  readonly dismiss = output<void>();

  readonly X = X;
  readonly Sparkles = Sparkles;
  readonly Tag = Tag;

  onDismiss(): void {
    this.dismiss.emit();
  }

  parseSections(content: string): { title: string; items: string[] }[] {
    const sections: { title: string; items: string[] }[] = [];
    const sectionRegex = /^### (.+)/;
    const lines = content.split('\n');

    let currentTitle: string | null = null;
    let currentItems: string[] = [];

    for (const line of lines) {
      const match = line.match(sectionRegex);
      if (match) {
        if (currentTitle) {
          sections.push({ title: currentTitle, items: currentItems });
        }
        currentTitle = match[1];
        currentItems = [];
      } else if (currentTitle) {
        const trimmed = line.replace(/^- /, '').trim();
        if (trimmed) {
          currentItems.push(trimmed);
        }
      }
    }

    if (currentTitle) {
      sections.push({ title: currentTitle, items: currentItems });
    }

    return sections;
  }

  getSectionBadge(title: string): string {
    switch (title.toLowerCase()) {
      case 'added': return 'bg-green-500/20 text-green-400';
      case 'changed': return 'bg-blue-500/20 text-blue-400';
      case 'fixed': return 'bg-yellow-500/20 text-yellow-400';
      case 'removed': return 'bg-red-500/20 text-red-400';
      default: return 'bg-zinc-500/20 text-zinc-400';
    }
  }
}
