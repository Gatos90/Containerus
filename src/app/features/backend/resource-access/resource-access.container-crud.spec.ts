import '../../../shared/utils/__testing__/webcrypto-polyfill';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

import { ResourceAccessComponent } from './resource-access.component';
import { BackendService } from '../../../core/services/backend.service';
import { PermissionCatalogService } from '../../../shared/components/a11y';

setupTestBed();

/**
 * Integration-level spec for CON-130: exercises the container-scope CRUD
 * path end-to-end through ResourceAccessComponent (without DOM), asserting
 * that the drawer output wires up to `createAclFor` with the CON-117 shape
 * (systemId + UUID-v5 resourceId) and that delete stages an undo toast that
 * re-POSTs the row verbatim.
 */

const CONN_ID = 'conn-1';
const PROJECT_ID = 'proj-1';
const SYSTEM_UUID = '11111111-2222-3333-4444-555555555555';
const CONTAINER_ID = 'abc123def456';
const CONTAINER_RESOURCE_UUID = 'c40d9fd2-2c80-556d-99b7-5c1ace1bfd16';

function configure(): {
  fixture: ComponentFixture<ResourceAccessComponent>;
  backend: any;
} {
  const state = {
    acls: [] as any[],
  };
  const backend: any = {
    connectedBackends: () => [
      {
        id: CONN_ID,
        projects: [{ id: PROJECT_ID, name: 'Proj' }],
      },
    ],
    getConnection: (id: string) =>
      id === CONN_ID ? { id: CONN_ID, projects: [{ id: PROJECT_ID, name: 'Proj' }] } : null,
    listAclsFor: vi.fn(async () => [...state.acls]),
    getProjectMembersFor: vi.fn(async () => []),
    listRolesFor: vi.fn(async () => []),
    listPermissionDefsFor: vi.fn(async () => []),
    listEnvironmentsFor: vi.fn(async () => []),
    listSystemsInEnvironmentFor: vi.fn(async () => []),
    listClustersInEnvironmentFor: vi.fn(async () => []),
    createAclFor: vi.fn(async (_c: string, _p: string, data: any) => {
      const row = {
        id: `acl-${state.acls.length + 1}`,
        userId: data.userId,
        projectId: PROJECT_ID,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        systemId: data.systemId ?? null,
        roleId: data.roleId ?? null,
        extraPermissions: data.extraPermissions,
        deniedPermissions: data.deniedPermissions,
        createdAt: '',
        updatedAt: '',
      };
      state.acls.push(row);
      return row;
    }),
    deleteAclFor: vi.fn(async (_c: string, _p: string, id: string) => {
      state.acls = state.acls.filter((a) => a.id !== id);
    }),
  };

  TestBed.configureTestingModule({
    imports: [ResourceAccessComponent],
    providers: [
      { provide: BackendService, useValue: backend },
      {
        provide: PermissionCatalogService,
        useValue: { ensureLoaded: vi.fn().mockResolvedValue(undefined), descriptionFor: () => '' },
      },
    ],
  });
  const fixture = TestBed.createComponent(ResourceAccessComponent);
  return { fixture, backend };
}

describe('ResourceAccessComponent — container scope CRUD (CON-130)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('round-trips a container-scope ACL with systemId + UUID-v5 resourceId', async () => {
    const { fixture, backend } = configure();
    const c = fixture.componentInstance;
    // Seed project context without going through async ngOnInit.
    c.connectionId.set(CONN_ID);
    c.selectedProjectId.set(PROJECT_ID);

    await c.onCreateAcl({
      userId: 'u1',
      resourceType: 'container',
      resourceId: CONTAINER_RESOURCE_UUID,
      systemId: SYSTEM_UUID,
      extraPermissions: ['containers.exec'],
      deniedPermissions: [],
    });

    // Server call shape matches the CON-117 contract exactly.
    expect(backend.createAclFor).toHaveBeenCalledWith(CONN_ID, PROJECT_ID, {
      userId: 'u1',
      resourceType: 'container',
      resourceId: CONTAINER_RESOURCE_UUID,
      systemId: SYSTEM_UUID,
      extraPermissions: ['containers.exec'],
      deniedPermissions: [],
    });
    // Optimistic prepend + reload reconciles.
    expect(c.acls().some((a) => a.resourceType === 'container')).toBe(true);
  });

  it('staged undo re-POSTs the exact same container-scope row', async () => {
    const { fixture, backend } = configure();
    const c = fixture.componentInstance;
    c.connectionId.set(CONN_ID);
    c.selectedProjectId.set(PROJECT_ID);

    // Seed one container ACL, then delete it through the optimistic path.
    await c.onCreateAcl({
      userId: 'u1',
      resourceType: 'container',
      resourceId: CONTAINER_RESOURCE_UUID,
      systemId: SYSTEM_UUID,
      extraPermissions: [],
      deniedPermissions: ['containers.remove'],
    });
    const row = c.acls().find((a) => a.resourceType === 'container')!;

    // Stub confirm so deleteAcl() doesn't bail.
    const origConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    try {
      await c.deleteAcl(row);
    } finally {
      globalThis.confirm = origConfirm;
    }

    expect(backend.deleteAclFor).toHaveBeenCalledWith(CONN_ID, PROJECT_ID, row.id);
    expect(c.undoToast()).not.toBeNull();

    // Undo recreates via POST — identical systemId + resourceId + perms.
    backend.createAclFor.mockClear();
    await c.undoLast();
    expect(backend.createAclFor).toHaveBeenCalledWith(CONN_ID, PROJECT_ID, {
      userId: 'u1',
      resourceType: 'container',
      resourceId: CONTAINER_RESOURCE_UUID,
      systemId: SYSTEM_UUID,
      roleId: undefined,
      extraPermissions: [],
      deniedPermissions: ['containers.remove'],
    });
    expect(c.undoToast()).toBeNull();
  });

  it('rolls back the optimistic delete if the server fails', async () => {
    const { fixture, backend } = configure();
    const c = fixture.componentInstance;
    c.connectionId.set(CONN_ID);
    c.selectedProjectId.set(PROJECT_ID);

    await c.onCreateAcl({
      userId: 'u1',
      resourceType: 'container',
      resourceId: CONTAINER_RESOURCE_UUID,
      systemId: SYSTEM_UUID,
      extraPermissions: [],
      deniedPermissions: [],
    });
    const row = c.acls().find((a) => a.resourceType === 'container')!;

    backend.deleteAclFor.mockRejectedValueOnce(new Error('boom'));
    const origConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    try {
      await c.deleteAcl(row);
    } finally {
      globalThis.confirm = origConfirm;
    }

    // Row is back in the list, error surfaced, no undo toast.
    expect(c.acls().some((a) => a.id === row.id)).toBe(true);
    expect(c.loadError()).toContain('boom');
    expect(c.undoToast()).toBeNull();
  });
});
