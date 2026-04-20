import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

import { RoleManagerComponent } from './role-manager.component';
import { BackendService } from '../../../core/services/backend.service';

setupTestBed();

const ROLES = [
  { id: 'r1', name: 'Dev', slug: 'dev', isSystem: false, createdAt: '', updatedAt: '' },
];

function configure(opts: {
  members: Record<string, { roleId: string }[]>;
  acls: Record<string, { roleId: string | null }[]>;
  failProject?: string;
}): { backend: any; component: RoleManagerComponent } {
  const backend = {
    connectedBackends: () => [{
      id: 'c1',
      projects: [
        { id: 'p1', name: 'Alpha' },
        { id: 'p2', name: 'Beta' },
      ],
    }],
    listRolesFor: vi.fn().mockResolvedValue(ROLES),
    listPermissionDefsFor: vi.fn().mockResolvedValue([]),
    getRoleFor: vi.fn().mockResolvedValue({
      ...ROLES[0],
      permissions: [],
    }),
    getProjectMembersFor: vi.fn().mockImplementation((_c: string, projectId: string) => {
      if (opts.failProject === projectId) return Promise.reject(new Error('boom'));
      return Promise.resolve(opts.members[projectId] ?? []);
    }),
    listAclsFor: vi.fn().mockImplementation((_c: string, projectId: string) => {
      if (opts.failProject === projectId) return Promise.reject(new Error('boom'));
      return Promise.resolve(opts.acls[projectId] ?? []);
    }),
  };
  TestBed.configureTestingModule({
    imports: [RoleManagerComponent],
    providers: [{ provide: BackendService, useValue: backend }],
  });
  const fixture = TestBed.createComponent(RoleManagerComponent);
  return { backend, component: fixture.componentInstance };
}

describe('RoleManagerComponent — where used panel', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('aggregates member + ACL counts across every project', async () => {
    const { component } = configure({
      members: {
        p1: [{ roleId: 'r1' }, { roleId: 'r1' }, { roleId: 'r2' }],
        p2: [{ roleId: 'r1' }],
      },
      acls: {
        p1: [{ roleId: 'r1' }],
        p2: [{ roleId: 'r1' }, { roleId: 'r2' }],
      },
    });
    await component.ngOnInit();
    await component.selectRole('r1');
    // The where-used loader is fire-and-forget; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    const w = component.whereUsed();
    expect(w).not.toBeNull();
    expect(w!.members).toBe(3);
    expect(w!.acls).toBe(2);
    expect(w!.partial).toBe(false);
    expect(w!.projects).toHaveLength(2);
  });

  it('flags partial when one project rejects', async () => {
    const { component } = configure({
      members: { p1: [{ roleId: 'r1' }] },
      acls: { p1: [] },
      failProject: 'p2',
    });
    await component.ngOnInit();
    await component.selectRole('r1');
    await new Promise((r) => setTimeout(r, 0));
    const w = component.whereUsed();
    expect(w!.partial).toBe(true);
    expect(w!.members).toBe(1);
  });
});
