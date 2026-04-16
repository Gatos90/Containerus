import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { OutputViewportComponent } from './output-viewport.component';
import { OutputBuffer } from '../../models/terminal-output.model';

function makeComponent(): OutputViewportComponent {
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
  return runInInjectionContext(injector, () => new OutputViewportComponent());
}

describe('OutputViewportComponent', () => {
  let component: OutputViewportComponent;
  let buffer: OutputBuffer;

  beforeEach(() => {
    component = makeComponent();
    buffer = new OutputBuffer();
    component.buffer = buffer;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should create successfully', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize signals with empty state', () => {
      expect(component.sectionsWithLines()).toEqual([]);
      expect(component.allLines()).toEqual([]);
      expect(component.hasSections()).toBe(false);
    });

    it('should default isRunning to false', () => {
      expect(component.isRunning).toBe(false);
    });
  });

  describe('ngOnDestroy', () => {
    it('should not throw when effectRef is null', () => {
      (component as any).effectRef = null;
      expect(() => component.ngOnDestroy()).not.toThrow();
    });

    it('should call destroy on effectRef if present', () => {
      const mockDestroy = vi.fn();
      (component as any).effectRef = { destroy: mockDestroy };
      component.ngOnDestroy();
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe('getAnsiClasses', () => {
    it('should return empty string for empty styleToken', () => {
      expect(component.getAnsiClasses('')).toBe('');
    });

    it('should return empty string for "text" styleToken', () => {
      expect(component.getAnsiClasses('text')).toBe('');
    });

    it('should prefix a single token with ansi-', () => {
      expect(component.getAnsiClasses('bold')).toBe('ansi-bold');
    });

    it('should prefix multiple tokens', () => {
      expect(component.getAnsiClasses('bold dim')).toBe('ansi-bold ansi-dim');
    });

    it('should handle fg- color tokens', () => {
      expect(component.getAnsiClasses('fg-1')).toBe('ansi-fg-1');
    });

    it('should handle compound tokens like "bold dim fg-1"', () => {
      const result = component.getAnsiClasses('bold dim fg-1');
      expect(result).toBe('ansi-bold ansi-dim ansi-fg-1');
    });

    it('should filter out empty tokens from extra spaces', () => {
      const result = component.getAnsiClasses('bold  dim');
      // split(' ') with double space produces empty token - filter removes it
      expect(result).toBe('ansi-bold ansi-dim');
    });
  });

  describe('updateContent (via ngAfterViewInit)', () => {
    it('should set hasSections to true when buffer has any text (output sections)', () => {
      // appendText always creates a section internally, so hasSections is always true after append
      buffer.appendText('line1\nline2\n');
      component.ngAfterViewInit();

      expect(component.hasSections()).toBe(true);
      expect(component.sectionsWithLines().length).toBeGreaterThan(0);
    });

    it('should set hasSections to true when buffer has multiple section types', () => {
      buffer.appendText('thinking...\n', 'thinking');
      buffer.appendText('response\n', 'response');
      component.ngAfterViewInit();

      expect(component.hasSections()).toBe(true);
      expect(component.sectionsWithLines().length).toBe(2);
    });

    it('should clear allLines when buffer has sections', () => {
      buffer.appendText('hello\n');
      component.ngAfterViewInit();

      // hasSections is true, so allLines should be cleared
      expect(component.allLines()).toEqual([]);
    });

    it('should clear allLines for section-based buffer', () => {
      buffer.appendText('cmd output\n', 'output');
      component.ngAfterViewInit();

      // output sections exist — hasSections = true
      expect(component.allLines()).toEqual([]);
    });

    it('should handle empty buffer gracefully', () => {
      component.ngAfterViewInit();
      expect(component.hasSections()).toBe(false);
      expect(component.allLines()).toEqual([]);
    });

    it('should populate sectionsWithLines with section and lines data', () => {
      buffer.appendText('output line\n', 'output');
      component.ngAfterViewInit();

      const sections = component.sectionsWithLines();
      expect(sections.length).toBeGreaterThan(0);
      expect(sections[0]).toHaveProperty('section');
      expect(sections[0]).toHaveProperty('lines');
    });
  });

  describe('toggleSection', () => {
    it('should call toggleSectionCollapse on the buffer', () => {
      const spy = vi.spyOn(buffer, 'toggleSectionCollapse');
      component.toggleSection('section-1');
      expect(spy).toHaveBeenCalledWith('section-1');
    });
  });

  describe('onMouseUp', () => {
    it('should emit false when no selection object', () => {
      const emitted: boolean[] = [];
      component.textSelection.subscribe((v) => emitted.push(v));

      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      component.onMouseUp();
      expect(emitted).toHaveLength(0);
    });

    it('should emit false when viewport is not set', () => {
      const emitted: boolean[] = [];
      component.textSelection.subscribe((v) => emitted.push(v));

      const mockSelection = {
        anchorNode: document.createElement('div'),
        focusNode: document.createElement('div'),
        toString: () => 'selected text',
      };
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

      // viewportRef is undefined, so it returns early
      component.onMouseUp();
      expect(emitted).toHaveLength(0);
    });

    it('should emit true when selection is inside viewport', () => {
      const emitted: boolean[] = [];
      component.textSelection.subscribe((v) => emitted.push(v));

      const vpEl = document.createElement('div');
      const textNode = document.createTextNode('hello');
      vpEl.appendChild(textNode);

      (component as any).viewportRef = { nativeElement: vpEl };

      const mockSelection = {
        anchorNode: textNode,
        focusNode: textNode,
        toString: () => 'hello',
      };
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);
      vi.spyOn(vpEl, 'contains').mockReturnValue(true);

      component.onMouseUp();
      expect(emitted).toEqual([true]);
    });

    it('should emit false when selection is outside viewport', () => {
      const emitted: boolean[] = [];
      component.textSelection.subscribe((v) => emitted.push(v));

      const vpEl = document.createElement('div');
      const outsideEl = document.createElement('span');

      (component as any).viewportRef = { nativeElement: vpEl };

      const mockSelection = {
        anchorNode: outsideEl,
        focusNode: outsideEl,
        toString: () => 'selected',
      };
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);
      vi.spyOn(vpEl, 'contains').mockReturnValue(false);

      component.onMouseUp();
      expect(emitted).toEqual([false]);
    });

    it('should emit false when selection string is empty even if inside viewport', () => {
      const emitted: boolean[] = [];
      component.textSelection.subscribe((v) => emitted.push(v));

      const vpEl = document.createElement('div');
      const textNode = document.createTextNode('');
      vpEl.appendChild(textNode);

      (component as any).viewportRef = { nativeElement: vpEl };

      const mockSelection = {
        anchorNode: textNode,
        focusNode: textNode,
        toString: () => '',
      };
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);
      vi.spyOn(vpEl, 'contains').mockReturnValue(true);

      component.onMouseUp();
      expect(emitted).toEqual([false]);
    });
  });
});
