import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastState } from './toast.state';

describe('ToastState', () => {
  let state: ToastState;

  beforeEach(() => {
    vi.useFakeTimers();
    state = new ToastState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start with empty toasts', () => {
    expect(state.toasts()).toEqual([]);
  });

  it('should show a toast with default type and duration', () => {
    state.show('Hello');
    const toasts = state.toasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Hello');
    expect(toasts[0].type).toBe('info');
    expect(toasts[0].duration).toBe(3000);
  });

  it('should show a toast with custom type', () => {
    state.show('Error!', 'error', 5000);
    const toasts = state.toasts();
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].duration).toBe(5000);
  });

  it('should auto-dismiss after duration', () => {
    state.show('Temp', 'info', 3000);
    expect(state.toasts()).toHaveLength(1);

    vi.advanceTimersByTime(3000);
    expect(state.toasts()).toHaveLength(0);
  });

  it('should not auto-dismiss when duration is 0', () => {
    state.show('Persistent', 'info', 0);
    vi.advanceTimersByTime(10000);
    expect(state.toasts()).toHaveLength(1);
  });

  it('should show success toast', () => {
    state.success('Done!');
    expect(state.toasts()[0].type).toBe('success');
    expect(state.toasts()[0].duration).toBe(3000);
  });

  it('should show error toast with longer duration', () => {
    state.error('Oops!');
    expect(state.toasts()[0].type).toBe('error');
    expect(state.toasts()[0].duration).toBe(5000);
  });

  it('should show warning toast', () => {
    state.warning('Watch out!');
    expect(state.toasts()[0].type).toBe('warning');
    expect(state.toasts()[0].duration).toBe(4000);
  });

  it('should show info toast', () => {
    state.info('FYI');
    expect(state.toasts()[0].type).toBe('info');
    expect(state.toasts()[0].duration).toBe(3000);
  });

  it('should dismiss a specific toast', () => {
    state.show('First');
    state.show('Second');
    expect(state.toasts()).toHaveLength(2);

    const firstId = state.toasts()[0].id;
    state.dismiss(firstId);
    expect(state.toasts()).toHaveLength(1);
    expect(state.toasts()[0].message).toBe('Second');
  });

  it('should assign unique incrementing ids', () => {
    state.show('A');
    state.show('B');
    state.show('C');

    const ids = state.toasts().map(t => t.id);
    expect(ids[0]).toBeLessThan(ids[1]);
    expect(ids[1]).toBeLessThan(ids[2]);
  });

  it('should handle multiple toasts at once', () => {
    state.success('S');
    state.error('E');
    state.warning('W');
    state.info('I');

    expect(state.toasts()).toHaveLength(4);
    expect(state.toasts().map(t => t.type)).toEqual(['success', 'error', 'warning', 'info']);
  });

  it('should handle dismissing non-existent id gracefully', () => {
    state.show('Test');
    state.dismiss(999);
    expect(state.toasts()).toHaveLength(1);
  });
});
