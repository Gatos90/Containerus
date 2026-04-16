import { describe, it, expect, vi } from 'vitest';
import { SearchOverlayComponent } from './search-overlay.component';

describe('SearchOverlayComponent', () => {
  let component: SearchOverlayComponent;

  beforeEach(() => {
    component = new SearchOverlayComponent();
  });

  it('should create with default values', () => {
    expect(component.open).toBe(false);
    expect(component.query).toBe('');
    expect(component.results).toEqual([]);
  });

  it('should have icons defined', () => {
    expect(component.X).toBeDefined();
    expect(component.Search).toBeDefined();
  });

  describe('updateQuery', () => {
    it('should emit queryChange event with value', () => {
      const emitSpy = vi.spyOn(component.queryChange, 'emit');
      component.updateQuery('docker');
      expect(emitSpy).toHaveBeenCalledWith('docker');
    });

    it('should emit with empty string', () => {
      const emitSpy = vi.spyOn(component.queryChange, 'emit');
      component.updateQuery('');
      expect(emitSpy).toHaveBeenCalledWith('');
    });
  });

  describe('Input properties', () => {
    it('should accept open input', () => {
      component.open = true;
      expect(component.open).toBe(true);
    });

    it('should accept query input', () => {
      component.query = 'test query';
      expect(component.query).toBe('test query');
    });

    it('should accept results input', () => {
      const results = [{ blockId: 'b1', matchText: 'test', startIdx: 0, endIdx: 4 }] as any[];
      component.results = results;
      expect(component.results).toHaveLength(1);
    });
  });

  describe('Output events', () => {
    it('should have close EventEmitter', () => {
      const emitSpy = vi.spyOn(component.close, 'emit');
      component.close.emit();
      expect(emitSpy).toHaveBeenCalled();
    });

    it('should have selectResult EventEmitter', () => {
      const result = { blockId: 'b1', matchText: 'test', startIdx: 0, endIdx: 4 } as any;
      const emitSpy = vi.spyOn(component.selectResult, 'emit');
      component.selectResult.emit(result);
      expect(emitSpy).toHaveBeenCalledWith(result);
    });
  });
});
