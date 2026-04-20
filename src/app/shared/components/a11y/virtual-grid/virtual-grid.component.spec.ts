import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { VirtualGridComponent } from './virtual-grid.component';

interface Row { id: number; name: string }

function stub(n = 100): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `row-${i}` }));
}

function makeComponent(rows: Row[] = stub()): VirtualGridComponent<Row> {
  const injector = Injector.create({
    providers: [
      { provide: ɵChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
      { provide: ɵEffectScheduler, useValue: { add: vi.fn(), remove: vi.fn(), schedule: vi.fn(), flush: vi.fn() } },
    ],
  });
  const c = runInInjectionContext(injector, () => new VirtualGridComponent<Row>());
  (c.rows as any) = () => rows;
  (c.rowHeight as any) = () => 40;
  (c.viewportHeight as any) = () => 200;
  (c.overscan as any) = () => 2;
  (c.keyboardModel as any) = () => 'grid';
  (c.ariaLabel as any) = () => 'Audit log';
  return c;
}

describe('VirtualGridComponent', () => {
  describe('window computation', () => {
    it('renders only the visible window + overscan at scrollTop=0', () => {
      const c = makeComponent(stub(1000));
      // viewport 200 / rowHeight 40 = 5 visible + overscan 2 each side = 9
      const [start, end] = c.window();
      expect(start).toBe(0);
      expect(end).toBe(9);
    });

    it('shifts the window as scrollTop grows', () => {
      const c = makeComponent(stub(1000));
      c.scrollTop.set(400); // 400/40 = 10 -> minus overscan 2 = 8
      const [start, end] = c.window();
      expect(start).toBe(8);
      expect(end).toBe(17);
    });

    it('clamps window.end to rowCount', () => {
      const c = makeComponent(stub(20));
      c.scrollTop.set(10_000);
      const [, end] = c.window();
      expect(end).toBeLessThanOrEqual(20);
    });
  });

  describe('aria-rowindex', () => {
    it('visibleRows exposes real-dataset indices (not 0..visibleLen)', () => {
      const c = makeComponent(stub(1000));
      c.scrollTop.set(400);
      const visible = c.visibleRows();
      expect(visible[0].index).toBe(8);
      expect(visible[visible.length - 1].index).toBeGreaterThan(10);
    });
  });

  describe('keyboard model', () => {
    it('ArrowDown moves focus by 1, clamped to count-1', () => {
      const c = makeComponent(stub(3));
      const event = (key: string, extra: Partial<KeyboardEvent> = {}) =>
        ({ key, preventDefault: vi.fn(), stopPropagation: vi.fn(), ctrlKey: false, metaKey: false, ...extra }) as unknown as KeyboardEvent;
      c.onKeydown(event('ArrowDown'));
      expect(c.focusedIndex()).toBe(1);
      c.onKeydown(event('ArrowDown'));
      c.onKeydown(event('ArrowDown')); // clamped at 2
      expect(c.focusedIndex()).toBe(2);
    });

    it('ArrowUp clamps at 0', () => {
      const c = makeComponent(stub(5));
      const event = (key: string) => ({ key, preventDefault: vi.fn(), ctrlKey: false, metaKey: false }) as unknown as KeyboardEvent;
      c.onKeydown(event('ArrowUp'));
      expect(c.focusedIndex()).toBe(0);
    });

    it('Ctrl+End jumps to the last row; Ctrl+Home jumps to first', () => {
      const c = makeComponent(stub(100));
      const event = (key: string, ctrl = false) => ({ key, preventDefault: vi.fn(), ctrlKey: ctrl, metaKey: false }) as unknown as KeyboardEvent;
      c.onKeydown(event('End', true));
      expect(c.focusedIndex()).toBe(99);
      c.onKeydown(event('Home', true));
      expect(c.focusedIndex()).toBe(0);
    });

    it('plain End/Home clamp to the current visible window', () => {
      const c = makeComponent(stub(1000));
      c.scrollTop.set(400);
      const event = (key: string) => ({ key, preventDefault: vi.fn(), ctrlKey: false, metaKey: false }) as unknown as KeyboardEvent;
      c.onKeydown(event('End'));
      const [, windowEnd] = c.window();
      expect(c.focusedIndex()).toBe(windowEnd - 1);
    });

    it('PageDown moves by pageSize (viewport / rowHeight)', () => {
      const c = makeComponent(stub(1000));
      const event = (key: string) => ({ key, preventDefault: vi.fn(), ctrlKey: false, metaKey: false }) as unknown as KeyboardEvent;
      c.onKeydown(event('PageDown'));
      expect(c.focusedIndex()).toBe(5); // 200/40 = 5
    });

    it('Enter emits rowActivated for the focused row', () => {
      const c = makeComponent(stub(5));
      c.focusedIndex.set(2);
      const spy = vi.fn();
      c.rowActivated.subscribe(spy);
      c.onKeydown({ key: 'Enter', preventDefault: vi.fn(), ctrlKey: false, metaKey: false } as unknown as KeyboardEvent);
      expect(spy).toHaveBeenCalledWith({ id: 2, name: 'row-2' });
    });

    it('ignores unknown keys', () => {
      const c = makeComponent(stub(5));
      c.focusedIndex.set(2);
      const ev = { key: 'a', preventDefault: vi.fn(), ctrlKey: false, metaKey: false } as unknown as KeyboardEvent;
      c.onKeydown(ev);
      expect(c.focusedIndex()).toBe(2);
      expect(ev.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    it('does not throw on empty dataset', () => {
      const c = makeComponent([]);
      expect(c.rowCount()).toBe(0);
      expect(c.window()).toEqual([0, 0]);
      expect(() => c.onKeydown({ key: 'ArrowDown', preventDefault: vi.fn(), ctrlKey: false, metaKey: false } as unknown as KeyboardEvent)).not.toThrow();
    });
  });
});
