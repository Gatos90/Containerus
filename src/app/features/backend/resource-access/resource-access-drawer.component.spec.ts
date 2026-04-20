import '../../../shared/utils/__testing__/webcrypto-polyfill';
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

function configure(options?: {
  containers?: any[];
  listContainersFor?: ReturnType<typeof vi.fn>;
}): ComponentFixture<ResourceAccessDrawerComponent> {
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
    listContainersFor:
      options?.listContainersFor ?? vi.fn().mockResolvedValue(options?.containers ?? []),
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

  it('each Extra/Deny checkbox has an accessible name containing the permission key', () => {
    const f = configure();
    const checkboxes = f.nativeElement.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    // We expect one Extra + one Deny checkbox per permission (3 perms → 6 total).
    expect(checkboxes.length).toBe(PERMS.length * 2);
    for (const cb of Array.from(checkboxes)) {
      const label = cb.getAttribute('aria-label') ?? '';
      expect(label).toMatch(/^(Extra|Deny): [a-z.]+$/);
      // Ensure the permission key from the catalog is part of the name —
      // prevents future regressions where the label loses the key.
      const keyPart = label.split(': ')[1];
      expect(PERMS.map((p) => p.key)).toContain(keyPart);
    }
  });

  // ==========================================================================
  // CON-130 Phase 2 — container scope
  // ==========================================================================

  const SYSTEM_UUID = '11111111-2222-3333-4444-555555555555';
  const CONTAINER_ID = 'abc123def456';
  // Pinned against the Rust `container_acl_resource_id()` helper — see
  // `container-acl-id.spec.ts` for the origin of this fixture.
  const EXPECTED_RESOURCE_UUID = 'c40d9fd2-2c80-556d-99b7-5c1ace1bfd16';

  function mkContainer(overrides: Partial<any> = {}): any {
    return {
      id: CONTAINER_ID,
      name: 'web-1',
      image: 'nginx:latest',
      status: 'running',
      runtime: 'docker',
      systemId: SYSTEM_UUID,
      createdAt: '',
      ports: [],
      environmentVariables: {},
      volumes: [],
      networkSettings: { networks: {} },
      resourceLimits: {},
      labels: {},
      restartPolicy: { name: 'no', maximumRetryCount: 0 },
      healthCheck: null,
      state: {},
      config: {},
      hostConfig: { ulimits: [] },
      ...overrides,
    };
  }

  // Flush Angular's microtask effect scheduler + any async work inside
  // effects (the drawer's container-load effect awaits listContainersFor).
  async function flush(f: ComponentFixture<ResourceAccessDrawerComponent>) {
    for (let i = 0; i < 5; i++) {
      f.detectChanges();
      await Promise.resolve();
    }
  }

  it('canSubmit requires both a parent system and a picked container in container scope', async () => {
    const f = configure({ containers: [mkContainer()] });
    const c = f.componentInstance;
    c.userId.set('u1');
    c.resourceType.set('container');
    await flush(f);
    expect(c.canSubmit()).toBe(false);
    c.containerSystemId.set(SYSTEM_UUID);
    await flush(f);
    expect(c.canSubmit()).toBe(false);
    c.selectedContainerRuntimeId.set(CONTAINER_ID);
    expect(c.canSubmit()).toBe(true);
  });

  it('emits a container-scope payload with server-matching resourceId + systemId', async () => {
    const f = configure({ containers: [mkContainer()] });
    const c = f.componentInstance;
    c.userId.set('u1');
    c.resourceType.set('container');
    c.containerSystemId.set(SYSTEM_UUID);
    await flush(f);
    c.selectedContainerRuntimeId.set(CONTAINER_ID);

    const emitted: any[] = [];
    c.create.subscribe((p) => emitted.push(p));
    await c.onSubmit();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      userId: 'u1',
      resourceType: 'container',
      resourceId: EXPECTED_RESOURCE_UUID,
      systemId: SYSTEM_UUID,
    });
  });

  it('filters and paginates containers client-side', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      mkContainer({ id: `c${i}`, name: `web-${i}`, image: i % 2 === 0 ? 'nginx' : 'redis' }),
    );
    const f = configure({ containers: many });
    const c = f.componentInstance;
    c.resourceType.set('container');
    c.containerSystemId.set(SYSTEM_UUID);
    await flush(f);

    // Full list after load.
    expect(c.containers().length).toBe(60);
    // Default page size = 25 ⇒ 3 pages for 60 rows.
    expect(c.containerPageCount()).toBe(3);
    expect(c.containerPageSlice().length).toBe(25);

    c.onContainerPage(1);
    expect(c.containerPage()).toBe(2);

    c.onContainerSearch('redis');
    // Pagination resets to page 1 on search.
    expect(c.containerPage()).toBe(1);
    // Half the list matches 'redis'.
    expect(c.filteredContainers().length).toBe(30);
  });

  it('resourceTypes now includes container (Phase 2)', () => {
    const f = configure();
    expect(f.componentInstance.resourceTypes).toContain('container');
  });

  it('has no serious axe-core violations when the container picker is rendered', async () => {
    const f = configure({ containers: [mkContainer()] });
    const c = f.componentInstance;
    c.resourceType.set('container');
    c.containerSystemId.set(SYSTEM_UUID);
    await flush(f);
    await assertNoA11yViolations(f.nativeElement);
  });

  it('announces causal phrase when a toggle crosses Extra ⇄ Deny', () => {
    const f = configure();
    const c = f.componentInstance;

    c.toggleExtra('system.write');
    expect(c.lastMovement()).toBeNull();

    c.toggleDenied('system.write');
    expect(c.lastMovement()).toBe('system.write moved from Extra to Deny.');

    // Same-side toggle (off) should clear the movement message.
    c.toggleDenied('system.write');
    expect(c.lastMovement()).toBeNull();

    c.toggleDenied('container.start');
    c.toggleExtra('container.start');
    expect(c.lastMovement()).toBe('container.start moved from Deny to Extra.');
  });
});
