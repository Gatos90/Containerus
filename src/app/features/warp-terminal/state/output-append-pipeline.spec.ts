import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutputAppendPipeline } from './output-append-pipeline';

describe('OutputAppendPipeline', () => {
  let pipeline: OutputAppendPipeline;
  let flushCallback: ReturnType<typeof vi.fn>;
  let mockBuffer: any;
  let rafCallbacks: Array<() => void>;

  beforeEach(() => {
    flushCallback = vi.fn();
    rafCallbacks = [];

    // Mock requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    mockBuffer = {
      appendText: vi.fn(),
    };

    pipeline = new OutputAppendPipeline(flushCallback);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flushRAF = () => {
    const cbs = [...rafCallbacks];
    rafCallbacks.length = 0;
    cbs.forEach((cb) => cb());
  };

  it('should enqueue and flush output', () => {
    pipeline.enqueue('block-1', mockBuffer, 'hello');
    flushRAF();

    expect(mockBuffer.appendText).toHaveBeenCalledWith('hello', 'output');
    expect(flushCallback).toHaveBeenCalledWith('block-1', mockBuffer, 'hello');
  });

  it('should batch multiple enqueues into single flush', () => {
    pipeline.enqueue('block-1', mockBuffer, 'hello ');
    pipeline.enqueue('block-1', mockBuffer, 'world');
    flushRAF();

    // Both chunks have same section type 'output', so they are combined
    expect(mockBuffer.appendText).toHaveBeenCalledWith('hello world', 'output');
    expect(flushCallback).toHaveBeenCalledWith('block-1', mockBuffer, 'hello world');
  });

  it('should not enqueue empty payloads', () => {
    pipeline.enqueue('block-1', mockBuffer, '');
    expect(rafCallbacks).toHaveLength(0);
  });

  it('should group consecutive chunks by section type', () => {
    pipeline.enqueue('block-1', mockBuffer, 'out1', 'output');
    pipeline.enqueue('block-1', mockBuffer, 'out2', 'output');
    pipeline.enqueue('block-1', mockBuffer, 'err1', 'stderr');
    flushRAF();

    // First group: output combined
    expect(mockBuffer.appendText).toHaveBeenCalledWith('out1out2', 'output');
    // Second group: stderr
    expect(mockBuffer.appendText).toHaveBeenCalledWith('err1', 'stderr');
  });

  it('should handle multiple blocks independently', () => {
    const mockBuffer2 = { appendText: vi.fn() };
    pipeline.enqueue('block-1', mockBuffer, 'hello');
    pipeline.enqueue('block-2', mockBuffer2, 'world');
    flushRAF();

    expect(flushCallback).toHaveBeenCalledTimes(2);
    expect(mockBuffer.appendText).toHaveBeenCalledWith('hello', 'output');
    expect(mockBuffer2.appendText).toHaveBeenCalledWith('world', 'output');
  });

  it('should clear pending queue', () => {
    pipeline.enqueue('block-1', mockBuffer, 'hello');
    pipeline.clear();
    flushRAF();

    expect(flushCallback).not.toHaveBeenCalled();
  });

  it('should only schedule one RAF per flush cycle', () => {
    pipeline.enqueue('block-1', mockBuffer, 'a');
    pipeline.enqueue('block-1', mockBuffer, 'b');
    pipeline.enqueue('block-1', mockBuffer, 'c');

    // Should only have one RAF callback scheduled
    expect(rafCallbacks).toHaveLength(1);
  });

  it('should schedule new RAF after flush completes', () => {
    pipeline.enqueue('block-1', mockBuffer, 'first');
    flushRAF();

    pipeline.enqueue('block-1', mockBuffer, 'second');
    expect(rafCallbacks).toHaveLength(1);

    flushRAF();
    expect(flushCallback).toHaveBeenCalledTimes(2);
  });
});
