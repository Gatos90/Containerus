import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import type { OutputBuffer, OutputSection, RenderedLine } from '../../models/terminal-output.model';
import { OutputSectionComponent } from '../output-section/output-section.component';

interface SectionWithLines {
  section: OutputSection;
  lines: RenderedLine[];
}

@Component({
  selector: 'app-output-viewport',
  imports: [OutputSectionComponent],
  templateUrl: './output-viewport.component.html',
  styleUrl: './output-viewport.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputViewportComponent implements AfterViewInit, OnDestroy {
  @Input() buffer!: OutputBuffer;
  @Input() isRunning = false;
  @Input() highlightLines?: Set<number>;

  @Output() textSelection = new EventEmitter<boolean>();

  @ViewChild('viewport') viewportRef?: ElementRef<HTMLDivElement>;

  /** All sections with their lines for section-based rendering */
  readonly sectionsWithLines = signal<SectionWithLines[]>([]);

  /** Fallback: all lines for blocks with no sections (legacy support) */
  readonly allLines = signal<{ index: number; line: RenderedLine }[]>([]);

  /** Whether to use section-based rendering */
  readonly hasSections = signal(false);

  private readonly injector = inject(Injector);
  private effectRef: ReturnType<typeof effect> | null = null;

  ngAfterViewInit(): void {
    this.updateContent();

    // Create effect within injection context using the injector
    this.effectRef = effect(
      () => {
        this.buffer.version();
        this.updateContent();
      },
      { injector: this.injector }
    );
  }

  ngOnDestroy(): void {
    this.effectRef?.destroy();
  }

  onMouseUp(): void {
    const selection = window.getSelection();
    const viewport = this.viewportRef?.nativeElement;
    if (!selection || !viewport) return;
    const isInside = viewport.contains(selection.anchorNode) || viewport.contains(selection.focusNode);
    this.textSelection.emit(isInside && selection.toString().length > 0);
  }

  toggleSection(sectionId: string): void {
    this.buffer.toggleSectionCollapse(sectionId);
  }

  private updateContent(): void {
    const sections = this.buffer.getSections();

    if (sections.length > 0) {
      // Section-based rendering
      this.hasSections.set(true);
      const sectionsData: SectionWithLines[] = sections.map((section) => ({
        section,
        lines: this.buffer.getLinesForSection(section.id),
      }));
      this.sectionsWithLines.set(sectionsData);
      this.allLines.set([]);
    } else {
      // Fallback: flat line rendering (for legacy or empty state)
      this.hasSections.set(false);
      const total = this.buffer.getLineCount();
      const lines = this.buffer.getLines(0, total).map((line, index) => ({
        index,
        line,
      }));
      this.allLines.set(lines);
      this.sectionsWithLines.set([]);
    }
  }

  /**
   * Convert styleToken to CSS class names.
   * The styleToken contains space-separated tokens like "bold dim fg-1".
   * We prefix each with "ansi-" to get the CSS class.
   */
  getAnsiClasses(styleToken: string): string {
    if (!styleToken || styleToken === 'text') {
      return '';
    }
    return styleToken
      .split(' ')
      .filter((t) => t.length > 0)
      .map((t) => `ansi-${t}`)
      .join(' ');
  }
}
