import { describe, it, expect, beforeEach } from 'vitest';
import { UpdateState } from './update.state';

describe('UpdateState', () => {
  let state: UpdateState;

  beforeEach(() => {
    state = new UpdateState();
  });

  it('should start with no update available', () => {
    expect(state.updateAvailable()).toBe(false);
    expect(state.updateVersion()).toBe('');
    expect(state.downloading()).toBe(false);
  });

  it('should dismiss update notification', () => {
    state.updateAvailable.set(true);
    state.updateVersion.set('1.0.1');

    state.dismiss();

    expect(state.updateAvailable()).toBe(false);
  });

  it('should retain version after dismiss', () => {
    state.updateVersion.set('2.0.0');
    state.dismiss();

    // Version stays but availability is dismissed
    expect(state.updateVersion()).toBe('2.0.0');
  });
});
