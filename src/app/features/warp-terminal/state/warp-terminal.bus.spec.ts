import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalEventBus } from './warp-terminal.bus';
import type { TerminalEvent } from '../models/terminal-events';

describe('TerminalEventBus', () => {
  let bus: TerminalEventBus;

  beforeEach(() => {
    bus = new TerminalEventBus();
  });

  it('should create without errors', () => {
    expect(bus).toBeTruthy();
    expect(bus.events$).toBeTruthy();
  });

  it('should emit events to subscribers', () => {
    const callback = vi.fn();
    bus.subscribe(callback);

    const event = { type: 'UserScrolled' } as TerminalEvent;
    bus.emit(event);

    expect(callback).toHaveBeenCalledWith(event);
  });

  it('should support multiple subscribers', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    bus.subscribe(callback1);
    bus.subscribe(callback2);

    const event = { type: 'UserScrolled' } as TerminalEvent;
    bus.emit(event);

    expect(callback1).toHaveBeenCalledWith(event);
    expect(callback2).toHaveBeenCalledWith(event);
  });

  it('should not call unsubscribed listeners', () => {
    const callback = vi.fn();
    const sub = bus.subscribe(callback);
    sub.unsubscribe();

    bus.emit({ type: 'UserScrolled' } as TerminalEvent);

    expect(callback).not.toHaveBeenCalled();
  });

  it('should emit events in order', () => {
    const events: TerminalEvent[] = [];
    bus.subscribe((e) => events.push(e));

    bus.emit({ type: 'UserScrolled' } as TerminalEvent);
    bus.emit({ type: 'UserToggledFollowMode', on: true } as TerminalEvent);

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('UserScrolled');
    expect(events[1].type).toBe('UserToggledFollowMode');
  });

  it('should provide events$ observable', () => {
    return new Promise<void>((resolve) => {
      const event = { type: 'UserScrolled' } as TerminalEvent;

      bus.events$.subscribe((e) => {
        expect(e).toEqual(event);
        resolve();
      });

      bus.emit(event);
    });
  });
});
