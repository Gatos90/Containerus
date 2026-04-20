import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

import { ResourceAccessDrawerComponent } from './resource-access-drawer.component';
import { BackendService } from '../../../core/services/backend.service';
import { PermissionCatalogService } from '../../../shared/components/a11y';
import { assertNoA11yViolations } from '../../../shared/components/a11y/testing/axe';

setupTestBed();

const PERMS = [
  { key: 'system.read', category: 'system', description: 'Read system' },
  { key: 'system.write', category: 'system', description: 'Write system' },
  { key: 'container.start', category: 'container', description: 'Start container' },
];

function configure(): ComponentFixture<ResourceAccessDrawerComponent> {
  const backendStub = {
    getRoleFor: vi.fn().mockResolvedValue({
      id: 'r1',
      name: 'Developer',
      slug: 'developer',
      isSystem: false,
      permissions: ['system.read'],
      createdAt: '',
      updatedAt: '',
    }),
  };
  const catalogStub = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    descriptionFor: vi.fn().mockReturnValue(''),
  };

  TestBed.configureTestingModule({
    imports: [ResourceAccessDrawerComponent],
    providers: [
      { provide: BackendService, useValue: backendStub },
      { provide: PermissionCatalogService, useValue: catalogStub },
    ],
  });
  const fixture = TestBed.createComponent(ResourceAccessDrawerComponent);
  fixture.componentRef.setInput('members', [
    { userId: 'u1', email: 'a@x.test', displayName: 'Ann', roleId: 'r1', roleName: 'Developer', roleSlug: 'developer', joinedAt: '' },
  ]);
  fixture.componentRef.setInput('roles', [
    { id: 'r1', name: 'Developer', slug: 'developer', isSystem: false, createdAt: '', updatedAt: '' },
  ]);
  fixture.componentRef.setInput('permissions', PERMS);
  fixture.componentRef.setInput('systems', [{ id: 's1', label: 'Sys One' }]);
  fixture.componentRef.setInput('clusters', []);
  fixture.componentRef.setInput('envs', []);
  fixture.componentRef.setInput('saving', false);
  fixture.componentInstance.connectionId = 'c1';
  fixture.detectChanges();
  return fixture;
}

describe('ResourceAccessDrawerComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('canSubmit is false until user + resource are picked', () => {
    const f = configure();
    const c = f.componentInstance;
    expect(c.canSubmit()).toBe(false);
    c.userId.set('u1');
    expect(c.canSubmit()).toBe(false);
    c.resourceId.set('s1');
    expect(c.canSubmit()).toBe(true);
  });

  it('toggleExtra and toggleDenied are mutually exclusive per key', () => {
    const f = configure();
    const c = f.componentInstance;
    c.toggleExtra('system.write');
    expect(c.extraSet().has('system.write')).toBe(true);
    expect(c.deniedSet().has('system.write')).toBe(false);

    c.toggleDenied('system.write');
    // Adding to denied clears the matching extra entry.
    expect(c.deniedSet().has('system.write')).toBe(true);
    expect(c.extraSet().has('system.write')).toBe(false);
  });

  it('effectivePermissions = (rolePerms ∪ extra) − denied', () => {
    const f = configure();
    const c = f.componentInstance;
    // Seed role permissions directly (the effect that fetches them is async).
    c.rolePermissions.set(['system.read', 'container.start']);
    c.toggleExtra('system.write');
    c.toggleDenied('container.start');
    expect(c.effectivePermissions()).toEqual(['system.read', 'system.write']);
  });

  it('emits create with the assembled payload when submitted', () => {
    const f = configure();
    const c = f.componentInstance;
    const emitted: any[] = [];
    c.create.subscribe((p) => emitted.push(p));
    c.userId.set('u1');
    c.resourceType.set('system');
    c.resourceId.set('s1');
    c.roleId.set('r1');
    c.toggleExtra('system.write');
    c.onSubmit();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      userId: 'u1',
      resourceType: 'system',
      resourceId: 's1',
      roleId: 'r1',
      extraPermissions: ['system.write'],
      deniedPermissions: [],
    });
  });

  it('has no serious axe-core violations in default state', async () => {
    const f = configure();
    await assertNoA11yViolations(f.nativeElement);
  });
});
