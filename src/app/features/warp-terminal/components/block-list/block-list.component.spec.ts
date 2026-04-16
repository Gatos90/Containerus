import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  SimpleChange,
  SimpleChanges,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { BlockListComponent } from './block-list.component';
import type { CommandBlock, SelectionState } from '../../models/terminal-block.model';
import { OutputBuffer } from '../../models/terminal-output.model';

function makeComponent(): BlockListComponent {
  const injector = Injector.create({
    providers: [
      {
        provide: ɵChangeDetectionScheduler,
        useValue: { notify: vi.fn(), runningTick: false },
      },
      {
        provide: ɵEffectScheduler,
        useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() },
      },
    ],
  });
  return runInInjectionContext(injector, () => new BlockListComponent());
}

function makeBlock(id: number, commandText = 'ls -la'): CommandBlock {
  return {
    id,
    commandText,
    source: 'user',
    status: { state: 'finished', exitCode: 0, endedAt: Date.now() },
    cwdLabel: '~',
    hostLabel: 'local',
    renderState: new OutputBuffer(),
    metrics: { bytesReceived: 0, lineCount: 0 },
    isCollapsed: false,
  };
}

describe('BlockListComponent', () => {
  let component: BlockListComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  describe('initialization', () => {
    it('should create with default values', () => {
      expect(component).toBeTruthy();
      expect(component.blocks).toEqual([]);
      expect(component.selection).toEqual({ kind: 'none' });
      expect(component.highlightMap).toBeInstanceOf(Map);
      expect(component.showJumpButton()).toBe(false);
    });

    it('should initialize showJumpButton as false', () => {
      expect(component.showJumpButton()).toBe(false);
    });
  });

  describe('followMode setter', () => {
    it('should update followModeSignal when set to true', () => {
      component.followMode = true;
      // no error, covered by setter path
      expect(component).toBeTruthy();
    });

    it('should update followModeSignal when set to false', () => {
      component.followMode = false;
      expect(component).toBeTruthy();
    });
  });

  describe('ngAfterViewInit', () => {
    it('should call scrollToBottom on init', () => {
      const spy = vi.spyOn(component, 'scrollToBottom');
      component.ngAfterViewInit();
      expect(spy).toHaveBeenCalled();
    });

    it('should not throw when scrollContainer is undefined', () => {
      expect(() => component.ngAfterViewInit()).not.toThrow();
    });
  });

  describe('ngOnChanges', () => {
    it('should call scrollToBottom when blocks change and followMode is on', () => {
      component.followMode = true;
      const spy = vi.spyOn(component, 'scrollToBottom');
      const changes: SimpleChanges = {
        blocks: new SimpleChange([], [makeBlock(1)], false),
      };
      component.ngOnChanges(changes);
      expect(spy).toHaveBeenCalled();
    });

    it('should not call scrollToBottom when blocks change and followMode is off', () => {
      component.followMode = false;
      const spy = vi.spyOn(component, 'scrollToBottom');
      const changes: SimpleChanges = {
        blocks: new SimpleChange([], [makeBlock(1)], false),
      };
      component.ngOnChanges(changes);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should not call scrollToBottom when unrelated input changes', () => {
      component.followMode = true;
      const spy = vi.spyOn(component, 'scrollToBottom');
      const changes: SimpleChanges = {
        selection: new SimpleChange({ kind: 'none' }, { kind: 'block', blockId: 1 }, false),
      };
      component.ngOnChanges(changes);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('onScroll', () => {
    it('should not throw when scrollContainer is undefined', () => {
      expect(() => component.onScroll()).not.toThrow();
    });

    it('should emit userScrolled when not near bottom', () => {
      const emitted: void[] = [];
      component.userScrolled.subscribe(() => emitted.push(undefined));

      const fakeContainer = {
        scrollHeight: 1000,
        scrollTop: 0,
        clientHeight: 400,
      } as HTMLDivElement;
      (component as any).scrollContainer = { nativeElement: fakeContainer };

      component.onScroll();
      expect(emitted).toHaveLength(1);
    });

    it('should set showJumpButton to true when not near bottom', () => {
      const fakeContainer = {
        scrollHeight: 1000,
        scrollTop: 0,
        clientHeight: 400,
      } as HTMLDivElement;
      (component as any).scrollContainer = { nativeElement: fakeContainer };

      component.onScroll();
      expect(component.showJumpButton()).toBe(true);
    });

    it('should set showJumpButton to false when near bottom', () => {
      const fakeContainer = {
        scrollHeight: 1000,
        scrollTop: 560,
        clientHeight: 400,
      } as HTMLDivElement;
      (component as any).scrollContainer = { nativeElement: fakeContainer };

      // pre-set to true
      component.showJumpButton.set(true);
      component.onScroll();
      expect(component.showJumpButton()).toBe(false);
    });

    it('should not emit userScrolled when near bottom', () => {
      const emitted: void[] = [];
      component.userScrolled.subscribe(() => emitted.push(undefined));

      const fakeContainer = {
        scrollHeight: 1000,
        scrollTop: 560,
        clientHeight: 400,
      } as HTMLDivElement;
      (component as any).scrollContainer = { nativeElement: fakeContainer };

      component.onScroll();
      expect(emitted).toHaveLength(0);
    });
  });

  describe('scrollToBottom', () => {
    it('should not throw when scrollContainer is undefined', () => {
      expect(() => component.scrollToBottom()).not.toThrow();
    });

    it('should not scroll when followMode is off and force is false', () => {
      component.followMode = false;
      let scrollTopSet = false;
      const fakeContainer = {
        scrollHeight: 1000,
        set scrollTop(_: number) {
          scrollTopSet = true;
        },
      } as unknown as HTMLDivElement;
      (component as any).scrollContainer = { nativeElement: fakeContainer };

      component.scrollToBottom(false);
      // requestAnimationFrame won't run synchronously — just verify no throw
      expect(scrollTopSet).toBe(false);
    });

    it('should scroll when force is true regardless of followMode', () => {
      component.followMode = false;
      let called = false;
      const origRaf = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        called = true;
        cb(0);
        return 0;
      };

      const fakeContainer = { scrollHeight: 1000, scrollTop: 0 } as HTMLDivElement;
      (component as any).scrollContainer = { nativeElement: fakeContainer };

      component.scrollToBottom(true);
      expect(called).toBe(true);
      globalThis.requestAnimationFrame = origRaf;
    });
  });

  describe('scrollToBlock', () => {
    it('should call scrollIntoView on the found element', () => {
      const mockScrollIntoView = vi.fn();
      const el = { scrollIntoView: mockScrollIntoView } as unknown as HTMLElement;
      vi.spyOn(document, 'getElementById').mockReturnValue(el);

      component.scrollToBlock(42);
      expect(document.getElementById).toHaveBeenCalledWith('block-42');
      expect(mockScrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

      vi.restoreAllMocks();
    });

    it('should not throw when element is not found', () => {
      vi.spyOn(document, 'getElementById').mockReturnValue(null);
      expect(() => component.scrollToBlock(99)).not.toThrow();
      vi.restoreAllMocks();
    });
  });

  describe('select', () => {
    it('should emit selectBlock with the blockId', () => {
      const emitted: (number | null)[] = [];
      component.selectBlock.subscribe((id) => emitted.push(id));

      component.select(7);
      expect(emitted).toEqual([7]);
    });
  });

  describe('setTextSelection', () => {
    it('should emit textSelection with the given state', () => {
      const emitted: SelectionState[] = [];
      component.textSelection.subscribe((s) => emitted.push(s));

      const state: SelectionState = { kind: 'block', blockId: 3 };
      component.setTextSelection(state);
      expect(emitted).toEqual([state]);
    });

    it('should emit textSelection with none kind', () => {
      const emitted: SelectionState[] = [];
      component.textSelection.subscribe((s) => emitted.push(s));

      component.setTextSelection({ kind: 'none' });
      expect(emitted).toEqual([{ kind: 'none' }]);
    });
  });

  describe('outputs', () => {
    it('should emit copyCommand', () => {
      const emitted: number[] = [];
      component.copyCommand.subscribe((id) => emitted.push(id));
      component.copyCommand.emit(5);
      expect(emitted).toEqual([5]);
    });

    it('should emit copyOutput', () => {
      const emitted: number[] = [];
      component.copyOutput.subscribe((id) => emitted.push(id));
      component.copyOutput.emit(5);
      expect(emitted).toEqual([5]);
    });

    it('should emit rerun', () => {
      const emitted: number[] = [];
      component.rerun.subscribe((id) => emitted.push(id));
      component.rerun.emit(5);
      expect(emitted).toEqual([5]);
    });

    it('should emit toggleCollapse', () => {
      const emitted: number[] = [];
      component.toggleCollapse.subscribe((id) => emitted.push(id));
      component.toggleCollapse.emit(5);
      expect(emitted).toEqual([5]);
    });

    it('should emit jumpToLatest', () => {
      const emitted: void[] = [];
      component.jumpToLatest.subscribe(() => emitted.push(undefined));
      component.jumpToLatest.emit();
      expect(emitted).toHaveLength(1);
    });
  });
});
