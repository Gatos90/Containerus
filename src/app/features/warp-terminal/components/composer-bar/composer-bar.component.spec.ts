import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Injector,
  runInInjectionContext,
  DestroyRef,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core';
import { ComposerBarComponent } from './composer-bar.component';
import { CommandHistoryService } from '../../state/command-history.service';
import { AiService } from '../../../../core/services/ai.service';
import { WarpTerminalStore } from '../../state/warp-terminal-store.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComponent(overrides: {
  isConfigured?: boolean;
  historyItems?: string[];
} = {}): ComposerBarComponent {
  const isConfigured = overrides.isConfigured ?? false;
  const historyItems = overrides.historyItems ?? [];

  const mockHistoryService: any = {
    getAll: vi.fn(() => historyItems),
    add: vi.fn(),
    searchRemoteHistory: vi.fn().mockResolvedValue([]),
  };

  const mockAiService: any = {
    isConfigured: vi.fn(() => isConfigured),
  };

  const mockStore: any = {
    currentCwd: vi.fn(() => '~'),
  };

  // Minimal no-op DestroyRef
  const mockDestroyRef: any = {
    onDestroy: vi.fn(() => () => {}),
  };

  const noopChangeDetectionScheduler: any = {
    notify: vi.fn(),
    runningTick: false,
  };

  const noopEffectScheduler: any = {
    schedule: vi.fn(),
    flush: vi.fn(),
  };

  const injector = Injector.create({
    providers: [
      { provide: CommandHistoryService, useValue: mockHistoryService },
      { provide: AiService, useValue: mockAiService },
      { provide: WarpTerminalStore, useValue: mockStore },
      { provide: DestroyRef, useValue: mockDestroyRef },
      { provide: ɵChangeDetectionScheduler, useValue: noopChangeDetectionScheduler },
      { provide: ɵEffectScheduler, useValue: noopEffectScheduler },
    ],
  });

  return runInInjectionContext(injector, () => new ComposerBarComponent());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComposerBarComponent', () => {
  let component: ComposerBarComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('should initialise mode to command', () => {
      expect(component.mode()).toBe('command');
    });

    it('should initialise value to empty string', () => {
      expect(component.value).toBe('');
    });

    it('should initialise showHistoryPopup to false', () => {
      expect(component.showHistoryPopup()).toBe(false);
    });

    it('should initialise historyFilter to empty string', () => {
      expect(component.historyFilter()).toBe('');
    });

    it('should initialise selectedHistoryIndex to 0', () => {
      expect(component.selectedHistoryIndex()).toBe(0);
    });

    it('should initialise displayLimit to 50', () => {
      expect(component.displayLimit()).toBe(50);
    });

    it('should initialise remoteSearchResults to empty array', () => {
      expect(component.remoteSearchResults()).toEqual([]);
    });

    it('should initialise isSearching to false', () => {
      expect(component.isSearching()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // toggleMode
  // -------------------------------------------------------------------------

  describe('toggleMode', () => {
    it('should not switch to AI mode when AI is not configured', () => {
      component = makeComponent({ isConfigured: false });
      component.toggleMode();
      expect(component.mode()).toBe('command');
    });

    it('should switch from command to AI mode when AI is configured', () => {
      component = makeComponent({ isConfigured: true });
      component.toggleMode();
      expect(component.mode()).toBe('ai');
    });

    it('should switch from AI mode back to command mode regardless of configuration', () => {
      component = makeComponent({ isConfigured: true });
      component.mode.set('ai');
      component.toggleMode();
      expect(component.mode()).toBe('command');
    });
  });

  // -------------------------------------------------------------------------
  // onInputChange
  // -------------------------------------------------------------------------

  describe('onInputChange', () => {
    it('should switch to AI mode when value starts with # and AI is configured', () => {
      component = makeComponent({ isConfigured: true });
      component.value = '#what is docker';
      component.onInputChange();
      expect(component.mode()).toBe('ai');
    });

    it('should remove the # prefix when switching to AI mode', () => {
      component = makeComponent({ isConfigured: true });
      component.value = '#hello';
      component.onInputChange();
      expect(component.value).toBe('hello');
    });

    it('should not switch to AI mode when value starts with # but AI is not configured', () => {
      component = makeComponent({ isConfigured: false });
      component.value = '#command';
      component.onInputChange();
      expect(component.mode()).toBe('command');
    });

    it('should not change mode when value does not start with #', () => {
      component = makeComponent({ isConfigured: true });
      component.value = 'docker ps';
      component.onInputChange();
      expect(component.mode()).toBe('command');
    });

    it('should not activate AI mode when already in AI mode', () => {
      component = makeComponent({ isConfigured: true });
      component.mode.set('ai');
      component.value = '#query';
      component.onInputChange();
      // mode should remain 'ai', value should NOT be stripped again
      expect(component.mode()).toBe('ai');
      expect(component.value).toBe('#query');
    });
  });

  // -------------------------------------------------------------------------
  // send
  // -------------------------------------------------------------------------

  describe('send', () => {
    it('should not emit when value is empty', () => {
      const emitSpy = vi.spyOn(component.submit, 'emit');
      component.value = '';
      component.send();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should not emit when value is only whitespace', () => {
      const emitSpy = vi.spyOn(component.submit, 'emit');
      component.value = '   ';
      component.send();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should emit submit event with trimmed text and current mode', () => {
      const emitSpy = vi.spyOn(component.submit, 'emit');
      component.value = '  docker ps  ';
      component.send();
      expect(emitSpy).toHaveBeenCalledWith({ text: 'docker ps', mode: 'command' });
    });

    it('should emit AI mode when in AI mode', () => {
      const emitSpy = vi.spyOn(component.submit, 'emit');
      component.mode.set('ai');
      component.value = 'list containers';
      component.send();
      expect(emitSpy).toHaveBeenCalledWith({ text: 'list containers', mode: 'ai' });
    });

    it('should clear the value after sending', () => {
      component.value = 'ls -la';
      component.send();
      expect(component.value).toBe('');
    });

    it('should call historyService.add with the trimmed text', () => {
      const mockHistory: any = (component as any).historyService;
      component.value = 'git status';
      component.send();
      expect(mockHistory.add).toHaveBeenCalledWith('git status', 'user');
    });
  });

  // -------------------------------------------------------------------------
  // openHistoryPopup / closeHistoryPopup
  // -------------------------------------------------------------------------

  describe('openHistoryPopup', () => {
    it('should set showHistoryPopup to true', () => {
      component.openHistoryPopup();
      expect(component.showHistoryPopup()).toBe(true);
    });

    it('should reset historyFilter to empty', () => {
      component.historyFilter.set('docker');
      component.openHistoryPopup();
      expect(component.historyFilter()).toBe('');
    });

    it('should reset displayLimit to 50', () => {
      component.displayLimit.set(200);
      component.openHistoryPopup();
      expect(component.displayLimit()).toBe(50);
    });
  });

  describe('closeHistoryPopup', () => {
    it('should set showHistoryPopup to false', () => {
      component.showHistoryPopup.set(true);
      component.closeHistoryPopup();
      expect(component.showHistoryPopup()).toBe(false);
    });

    it('should reset displayLimit to 50', () => {
      component.displayLimit.set(200);
      component.closeHistoryPopup();
      expect(component.displayLimit()).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // navigatePopup
  // -------------------------------------------------------------------------

  describe('navigatePopup', () => {
    it('should do nothing when filteredHistory is empty', () => {
      component = makeComponent({ historyItems: [] });
      component.selectedHistoryIndex.set(0);
      component.navigatePopup(-1);
      expect(component.selectedHistoryIndex()).toBe(0);
    });

    it('should move selection down (towards newer)', () => {
      component = makeComponent({ historyItems: ['cmd1', 'cmd2', 'cmd3'] });
      component.selectedHistoryIndex.set(0);
      component.navigatePopup(1);
      expect(component.selectedHistoryIndex()).toBe(1);
    });

    it('should move selection up (towards older)', () => {
      component = makeComponent({ historyItems: ['cmd1', 'cmd2', 'cmd3'] });
      component.selectedHistoryIndex.set(2);
      component.navigatePopup(-1);
      expect(component.selectedHistoryIndex()).toBe(1);
    });

    it('should not go below index 0 when there is no more history', () => {
      component = makeComponent({ historyItems: ['cmd1'] });
      component.selectedHistoryIndex.set(0);
      component.navigatePopup(-1);
      // hasMoreHistory() is false, so stays at 0
      expect(component.selectedHistoryIndex()).toBe(0);
    });

    it('should not exceed items.length - 1', () => {
      component = makeComponent({ historyItems: ['cmd1', 'cmd2'] });
      // filteredHistory reverses, so length = 2
      const len = component.filteredHistory().length;
      component.selectedHistoryIndex.set(len - 1);
      component.navigatePopup(1);
      expect(component.selectedHistoryIndex()).toBe(len - 1);
    });
  });

  // -------------------------------------------------------------------------
  // selectHistoryItem
  // -------------------------------------------------------------------------

  describe('selectHistoryItem', () => {
    it('should set value to the item at the given index', () => {
      component = makeComponent({ historyItems: ['ls', 'pwd'] });
      const items = component.filteredHistory();
      component.showHistoryPopup.set(true);
      component.selectHistoryItem(0);
      expect(component.value).toBe(items[0]);
    });

    it('should close the history popup after selection', () => {
      component = makeComponent({ historyItems: ['ls'] });
      component.showHistoryPopup.set(true);
      component.selectHistoryItem(0);
      expect(component.showHistoryPopup()).toBe(false);
    });

    it('should use selectedHistoryIndex when no index is provided', () => {
      component = makeComponent({ historyItems: ['ls', 'pwd'] });
      const items = component.filteredHistory();
      component.selectedHistoryIndex.set(1);
      component.showHistoryPopup.set(true);
      component.selectHistoryItem();
      expect(component.value).toBe(items[1]);
    });

    it('should not change value when index is out of range', () => {
      component = makeComponent({ historyItems: ['ls'] });
      component.value = 'original';
      component.selectHistoryItem(99);
      expect(component.value).toBe('original');
    });
  });

  // -------------------------------------------------------------------------
  // filteredHistory computed
  // -------------------------------------------------------------------------

  describe('filteredHistory computed', () => {
    it('should return empty when no history', () => {
      component = makeComponent({ historyItems: [] });
      expect(component.filteredHistory()).toEqual([]);
    });

    it('should return history items reversed (newest at bottom)', () => {
      component = makeComponent({ historyItems: ['cmd1', 'cmd2', 'cmd3'] });
      const result = component.filteredHistory();
      // getAll() returns ['cmd1','cmd2','cmd3'], reversed => ['cmd3','cmd2','cmd1']
      expect(result).toEqual(['cmd3', 'cmd2', 'cmd1']);
    });

    it('should filter history by historyFilter', () => {
      component = makeComponent({ historyItems: ['docker ps', 'git status', 'docker logs'] });
      component.historyFilter.set('docker');
      const result = component.filteredHistory();
      expect(result.every((r) => r.includes('docker'))).toBe(true);
    });

    it('should use remote search results when filter is set and results are available', () => {
      component = makeComponent({ historyItems: ['docker ps'] });
      component.historyFilter.set('git');
      component.remoteSearchResults.set(['git log', 'git status']);
      const result = component.filteredHistory();
      // remote results reversed
      expect(result).toEqual(['git status', 'git log']);
    });
  });

  // -------------------------------------------------------------------------
  // hasMoreHistory computed
  // -------------------------------------------------------------------------

  describe('hasMoreHistory computed', () => {
    it('should be false when history count is within the display limit', () => {
      const items = Array.from({ length: 10 }, (_, i) => `cmd${i}`);
      component = makeComponent({ historyItems: items });
      expect(component.hasMoreHistory()).toBe(false);
    });

    it('should be true when history count exceeds the display limit', () => {
      const items = Array.from({ length: 60 }, (_, i) => `cmd${i}`);
      component = makeComponent({ historyItems: items });
      expect(component.hasMoreHistory()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // onKeyDown – Enter key
  // -------------------------------------------------------------------------

  describe('onKeyDown – Enter', () => {
    it('should call send when popup is hidden and Enter is pressed', () => {
      const sendSpy = vi.spyOn(component, 'send');
      component.value = 'ls';
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      vi.spyOn(event, 'preventDefault');
      component.showHistoryPopup.set(false);
      // Attach a fake composerInput so guard passes
      (component as any).composerInput = { nativeElement: document.createElement('textarea') };
      component.onKeyDown(event);
      expect(sendSpy).toHaveBeenCalled();
    });

    it('should call selectHistoryItem when popup is open and Enter is pressed', () => {
      const selectSpy = vi.spyOn(component, 'selectHistoryItem');
      component.showHistoryPopup.set(true);
      (component as any).composerInput = { nativeElement: document.createElement('textarea') };
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      component.onKeyDown(event);
      expect(selectSpy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // onKeyDown – Escape
  // -------------------------------------------------------------------------

  describe('onKeyDown – Escape', () => {
    it('should close popup when Escape is pressed and popup is open', () => {
      const closeSpy = vi.spyOn(component, 'closeHistoryPopup');
      component.showHistoryPopup.set(true);
      (component as any).composerInput = { nativeElement: document.createElement('textarea') };
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      component.onKeyDown(event);
      expect(closeSpy).toHaveBeenCalled();
    });

    it('should not close popup when Escape is pressed but popup is already closed', () => {
      const closeSpy = vi.spyOn(component, 'closeHistoryPopup');
      component.showHistoryPopup.set(false);
      (component as any).composerInput = { nativeElement: document.createElement('textarea') };
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      component.onKeyDown(event);
      expect(closeSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // onKeyDown – ArrowUp / ArrowDown
  // -------------------------------------------------------------------------

  describe('onKeyDown – Arrow keys', () => {
    it('should open history popup when ArrowUp is pressed and popup is closed', () => {
      const openSpy = vi.spyOn(component, 'openHistoryPopup');
      component.showHistoryPopup.set(false);
      (component as any).composerInput = { nativeElement: document.createElement('textarea') };
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      component.onKeyDown(event);
      expect(openSpy).toHaveBeenCalled();
    });

    it('should navigate up in popup when ArrowUp is pressed and popup is open', () => {
      const navSpy = vi.spyOn(component, 'navigatePopup');
      component.showHistoryPopup.set(true);
      (component as any).composerInput = { nativeElement: document.createElement('textarea') };
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      component.onKeyDown(event);
      expect(navSpy).toHaveBeenCalledWith(-1);
    });

    it('should navigate down in popup when ArrowDown is pressed and popup is open', () => {
      const navSpy = vi.spyOn(component, 'navigatePopup');
      component.showHistoryPopup.set(true);
      (component as any).composerInput = { nativeElement: document.createElement('textarea') };
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      component.onKeyDown(event);
      expect(navSpy).toHaveBeenCalledWith(1);
    });
  });

  // -------------------------------------------------------------------------
  // onHistoryFilterInput
  // -------------------------------------------------------------------------

  describe('onHistoryFilterInput', () => {
    it('should update historyFilter signal', () => {
      const input = document.createElement('input');
      input.value = 'docker';
      const event = new Event('input');
      Object.defineProperty(event, 'target', { value: input });
      component.onHistoryFilterInput(event);
      expect(component.historyFilter()).toBe('docker');
    });

    it('should reset displayLimit to 50 on filter change', () => {
      component.displayLimit.set(200);
      const input = document.createElement('input');
      input.value = 'git';
      const event = new Event('input');
      Object.defineProperty(event, 'target', { value: input });
      component.onHistoryFilterInput(event);
      expect(component.displayLimit()).toBe(50);
    });

    it('should clear remoteSearchResults on filter change', () => {
      component.remoteSearchResults.set(['old result']);
      const input = document.createElement('input');
      input.value = 'new';
      const event = new Event('input');
      Object.defineProperty(event, 'target', { value: input });
      component.onHistoryFilterInput(event);
      expect(component.remoteSearchResults()).toEqual([]);
    });
  });
});
