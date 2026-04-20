import { describe, it, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import { ConnectionBadgeComponent } from '../connection-badge/connection-badge.component';
import { StatusChipComponent } from '../status-chip/status-chip.component';
import { ListStatesComponent } from '../list-states/list-states.component';
import { MfaCodeInputComponent } from '../mfa-code-input/mfa-code-input.component';
import { DrawerDialogComponent } from '../drawer-dialog/drawer-dialog.component';
import { PermissionKeyComponent } from '../permission-key/permission-key.component';
import { PermissionCatalogService } from '../permission-key/permission-catalog.service';
import { assertNoA11yViolations } from './axe';

setupTestBed();

/**
 * Component-level axe-core sweep. Each component renders in its likely
 * "live" configuration; the helper asserts zero `serious`/`critical`
 * violations. Contrast is excluded here (jsdom cannot compute Tailwind
 * utility classes) and is covered by the dedicated palette/chip specs.
 */

async function runAxe(fixture: ComponentFixture<unknown>): Promise<void> {
  document.body.appendChild(fixture.nativeElement);
  try {
    await assertNoA11yViolations(fixture.nativeElement);
  } finally {
    (fixture.nativeElement as HTMLElement).remove();
    fixture.destroy();
  }
}

describe('a11y axe sweep — shared components', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('ConnectionBadge (interactive md): no serious/critical violations', async () => {
    TestBed.configureTestingModule({ imports: [ConnectionBadgeComponent] });
    const f = TestBed.createComponent(ConnectionBadgeComponent);
    f.componentRef.setInput('connectionId', 'prod-east');
    f.componentRef.setInput('connectionLabel', 'Prod East');
    f.componentRef.setInput('size', 'md');
    f.componentRef.setInput('interactive', true);
    f.detectChanges();
    await runAxe(f);
  });

  it('ConnectionBadge (decorative md): no serious/critical violations', async () => {
    TestBed.configureTestingModule({ imports: [ConnectionBadgeComponent] });
    const f = TestBed.createComponent(ConnectionBadgeComponent);
    f.componentRef.setInput('connectionId', 'prod-east');
    f.componentRef.setInput('size', 'md');
    f.detectChanges();
    await runAxe(f);
  });

  it.each(['healthy', 'degraded', 'failing', 'unknown'] as const)(
    'StatusChip (%s): no serious/critical violations',
    async (status) => {
      TestBed.configureTestingModule({ imports: [StatusChipComponent] });
      const f = TestBed.createComponent(StatusChipComponent);
      f.componentRef.setInput('status', status);
      f.componentRef.setInput('count', 3);
      f.detectChanges();
      await runAxe(f);
    },
  );

  it('ListStates (error): role=alert + retry', async () => {
    TestBed.configureTestingModule({ imports: [ListStatesComponent] });
    const f = TestBed.createComponent(ListStatesComponent);
    f.componentRef.setInput('error', 'Could not load rules (500)');
    f.detectChanges();
    await runAxe(f);
  });

  it('ListStates (loading): role=status + aria-busy', async () => {
    TestBed.configureTestingModule({ imports: [ListStatesComponent] });
    const f = TestBed.createComponent(ListStatesComponent);
    f.componentRef.setInput('loading', true);
    f.detectChanges();
    await runAxe(f);
  });

  it('ListStates (empty): headline + description', async () => {
    TestBed.configureTestingModule({ imports: [ListStatesComponent] });
    const f = TestBed.createComponent(ListStatesComponent);
    f.componentRef.setInput('empty', true);
    f.componentRef.setInput('emptyHeadline', 'No access rules');
    f.componentRef.setInput('emptyDescription', 'Add a rule to begin.');
    f.detectChanges();
    await runAxe(f);
  });

  it('MfaCodeInput: labelled single-input with one-time-code hints', async () => {
    TestBed.configureTestingModule({ imports: [MfaCodeInputComponent] });
    const f = TestBed.createComponent(MfaCodeInputComponent);
    f.componentRef.setInput('label', 'Enter your authenticator code');
    f.detectChanges();
    await runAxe(f);
  });

  it('PermissionKey (popover closed): button + code pair', async () => {
    TestBed.configureTestingModule({
      imports: [PermissionKeyComponent],
      providers: [
        {
          provide: PermissionCatalogService,
          useValue: {
            ensureLoaded: () => Promise.resolve(),
            descriptionFor: (k: string) =>
              k === 'container:exec' ? 'Execute shells inside containers' : null,
          },
        },
      ],
    });
    const f = TestBed.createComponent(PermissionKeyComponent);
    f.componentRef.setInput('value', 'container:exec');
    f.detectChanges();
    await runAxe(f);
  });

  it('PermissionKey (popover open): aria-describedby wires to popover', async () => {
    TestBed.configureTestingModule({
      imports: [PermissionKeyComponent],
      providers: [
        {
          provide: PermissionCatalogService,
          useValue: {
            ensureLoaded: () => Promise.resolve(),
            descriptionFor: (k: string) =>
              k === 'container:exec' ? 'Execute shells inside containers' : null,
          },
        },
      ],
    });
    const f = TestBed.createComponent(PermissionKeyComponent);
    f.componentRef.setInput('value', 'container:exec');
    f.detectChanges();
    (f.nativeElement as HTMLElement).querySelector('button')?.click();
    f.detectChanges();
    await runAxe(f);
  });

  it('DrawerDialog (open with titleId): dialog wired to heading id', async () => {
    TestBed.configureTestingModule({ imports: [DrawerDialogComponent] });
    const f = TestBed.createComponent(DrawerDialogComponent);
    f.componentRef.setInput('open', true);
    f.componentRef.setInput('titleId', 'axe-drawer-title');
    f.detectChanges();
    // Attach a labelled heading into the drawer panel (callers project this).
    document.body.appendChild(f.nativeElement);
    const panel = (f.nativeElement as HTMLElement).querySelector('[role="dialog"]');
    if (panel) {
      const h2 = document.createElement('h2');
      h2.id = 'axe-drawer-title';
      h2.textContent = 'Edit rule';
      panel.appendChild(h2);
    }
    try {
      await assertNoA11yViolations(f.nativeElement);
    } finally {
      (f.nativeElement as HTMLElement).remove();
      f.destroy();
    }
  });
});
