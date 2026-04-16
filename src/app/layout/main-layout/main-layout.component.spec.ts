import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { MainLayoutComponent } from './main-layout.component';
import { AppState } from '../../state/app.state';
import { AiSettingsState } from '../../state/ai-settings.state';
import { TerminalState } from '../../state/terminal.state';
import { UpdateState } from '../../state/update.state';
import { ChangelogState } from '../../state/changelog.state';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

function makeComponent(): MainLayoutComponent {
  const routerEvents$ = new Subject<any>();
  const mockRouter: any = {
    url: '/',
    events: routerEvents$.asObservable(),
    navigate: vi.fn().mockResolvedValue(true),
  };

  const mockAppState: any = {
    initialize: vi.fn().mockResolvedValue(undefined),
    waitForReady: vi.fn().mockResolvedValue(undefined),
  };

  const mockAiSettingsState: any = {
    init: vi.fn().mockResolvedValue(undefined),
  };

  const mockTerminalState: any = {
    hasDockedItems: vi.fn(() => false),
    setDockHeightPercent: vi.fn(),
    terminals: vi.fn(() => []),
    dockedFileBrowsers: vi.fn(() => []),
  };

  const mockUpdateState: any = {
    checkForUpdate: vi.fn().mockResolvedValue(undefined),
    updateAvailable: vi.fn(() => false),
    updateVersion: vi.fn(() => ''),
  };

  const mockChangelogState: any = {
    checkForChangelog: vi.fn(),
    showChangelog: vi.fn(() => false),
  };

  const injector = Injector.create({
    providers: [
      { provide: AppState, useValue: mockAppState },
      { provide: AiSettingsState, useValue: mockAiSettingsState },
      { provide: TerminalState, useValue: mockTerminalState },
      { provide: UpdateState, useValue: mockUpdateState },
      { provide: ChangelogState, useValue: mockChangelogState },
      { provide: Router, useValue: mockRouter },
    ],
  });

  return runInInjectionContext(injector, () => new MainLayoutComponent());
}

describe('MainLayoutComponent', () => {
  let component: MainLayoutComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  it('should create successfully', () => {
    expect(component).toBeTruthy();
  });

  describe('computed properties', () => {
    it('should start with isTerminalRoute = false for root URL', () => {
      expect(component.isTerminalRoute()).toBe(false);
    });

    it('should start with showTerminalWorkspace = true for root URL', () => {
      expect(component.showTerminalWorkspace()).toBe(true);
    });

    it('should start with showDockGrid = false when no docked items', () => {
      expect(component.showDockGrid()).toBe(false);
    });

    it('should set showDockGrid true when docked items present', () => {
      (component as any).terminalState.hasDockedItems = vi.fn(() => true);
      expect(component.showDockGrid()).toBe(true);
    });
  });

  describe('ngOnInit', () => {
    it('should call initialize and init', async () => {
      await component.ngOnInit();
      expect((component as any).appState.initialize).toHaveBeenCalled();
      expect((component as any).aiSettingsState.init).toHaveBeenCalled();
    });

    it('should check for updates after initialization', async () => {
      await component.ngOnInit();
      expect((component as any).updateState.checkForUpdate).toHaveBeenCalled();
    });

    it('should check changelog after initialization', async () => {
      await component.ngOnInit();
      expect((component as any).changelogState.checkForChangelog).toHaveBeenCalled();
    });
  });

  describe('onResizeStart', () => {
    it('should set resizing and add event listeners', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      const mockEvent = {
        preventDefault: vi.fn(),
        target: { parentElement: document.createElement('div') },
        clientY: 100,
      } as any;

      component.onResizeStart(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect((component as any).resizing).toBe(true);
      expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });
  });

  describe('ngOnDestroy', () => {
    it('should clean up on destroy', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      // Set up resizing state
      (component as any).resizing = true;
      (component as any).containerEl = document.createElement('div');

      component.ngOnDestroy();

      expect((component as any).resizing).toBe(false);
      expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });

    it('should be a no-op when not resizing', () => {
      (component as any).resizing = false;
      // Should not throw
      component.ngOnDestroy();
      expect((component as any).resizing).toBe(false);
    });
  });
});
