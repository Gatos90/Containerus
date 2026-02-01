import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  OnChanges,
  SimpleChanges,
  effect,
  signal,
} from '@angular/core';
import type { CommandBlock, SelectionState, BlockId } from '../../models/terminal-block.model';
import { CommandBlockCardComponent } from '../command-block-card/command-block-card.component';

@Component({
  selector: 'app-block-list',
  standalone: true,
  imports: [CommonModule, CommandBlockCardComponent],
  templateUrl: './block-list.component.html',
  styleUrl: './block-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockListComponent implements AfterViewInit, OnChanges {
  @Input() blocks: CommandBlock[] = [];
  @Input() selection: SelectionState = { kind: 'none' };
  @Input() set followMode(value: boolean) {
    this.followModeSignal.set(value);
  }
  @Input() highlightMap = new Map<BlockId, Set<number>>();

  @Output() selectBlock = new EventEmitter<BlockId | null>();
  @Output() textSelection = new EventEmitter<SelectionState>();
  @Output() copyCommand = new EventEmitter<BlockId>();
  @Output() copyOutput = new EventEmitter<BlockId>();
  @Output() rerun = new EventEmitter<BlockId>();
  @Output() toggleCollapse = new EventEmitter<BlockId>();
  @Output() userScrolled = new EventEmitter<void>();
  @Output() jumpToLatest = new EventEmitter<void>();

  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLDivElement>;

  readonly showJumpButton = signal(false);
  private readonly followModeSignal = signal(true);

  constructor() {
    effect(() => {
      const container = this.scrollContainer?.nativeElement;
      if (!container) return;
      if (this.followModeSignal()) {
        this.scrollToBottom();
        this.showJumpButton.set(false);
      }
    });
  }

  ngAfterViewInit(): void {
    this.scrollToBottom();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['blocks'] && this.followModeSignal()) {
      this.scrollToBottom();
    }
  }

  onScroll(): void {
    const container = this.scrollContainer?.nativeElement;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 48;
    this.showJumpButton.set(!nearBottom);
    if (!nearBottom) {
      this.userScrolled.emit();
    }
  }

  scrollToBottom(force = false): void {
    const container = this.scrollContainer?.nativeElement;
    if (!container) return;
    if (!force && !this.followModeSignal()) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  scrollToBlock(blockId: BlockId): void {
    const element = document.getElementById(`block-${blockId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  select(blockId: BlockId): void {
    this.selectBlock.emit(blockId);
  }

  setTextSelection(selection: SelectionState): void {
    this.textSelection.emit(selection);
  }
}
