import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

import { PeopleComponent } from './people.component';
import { BackendService } from '../../../core/services/backend.service';

setupTestBed();

const MEMBERS = [
  {
    userId: 'u1',
    email: 'a@x.test',
    displayName: 'Ann',
    roleId: 'r1',
    roleName: 'Dev',
    roleSlug: 'dev',
    joinedAt: '2026-01-01T00:00:00Z',
    isActive: true,
  },
  {
    userId: 'u2',
    email: 'b@x.test',
    displayName: 'Bob',
    roleId: 'r1',
    roleName: 'Dev',
    roleSlug: 'dev',
    joinedAt: '2026-02-01T00:00:00Z',
    isActive: false,
  },
];
const ROLES = [{ id: 'r1', name: 'Dev', slug: 'dev', isSystem: false, createdAt: '', updatedAt: '' }];

interface ConfigureOpts {
  invitesAvailable: boolean;
  /** Current user id — defaults to a non-member so `canFlipActive` passes for all rows. */
  currentUserId?: string;
  /** When false, strip isCompanyAdmin + users.deactivate so the action is hidden. */
  isAdmin?: boolean;
}

function configure(opts: ConfigureOpts): { fixture: ComponentFixture<PeopleComponent>; backend: any } {
  const permissions = {
    isCompanyAdmin: opts.isAdmin ?? true,
    permissions: opts.isAdmin === false ? [] : ['users.deactivate'],
  };
  const backend = {
    connectedBackends: () => [
      {
        id: 'c1',
        projects: [{ id: 'p1', name: 'Proj' }],
        projectPermissions: { p1: permissions },
        user: { id: opts.currentUserId ?? 'admin-self' },
      },
    ],
    getProjectMembersFor: vi.fn().mockResolvedValue(MEMBERS),
    listRolesFor: vi.fn().mockResolvedValue(ROLES),
    listInvitesFor: opts.invitesAvailable
      ? vi.fn().mockResolvedValue([
          { id: 'i1', email: 'b@x.test', roleId: 'r1', roleName: 'Dev', invitedAt: '2026-04-19T00:00:00Z' },
        ])
      : vi.fn().mockRejectedValue(new Error('Not Found')),
    inviteMemberFor: vi.fn().mockResolvedValue(undefined),
    removeMemberFor: vi.fn().mockResolvedValue(undefined),
    revokeInviteFor: vi.fn().mockResolvedValue(undefined),
    resendInviteFor: vi.fn().mockResolvedValue(undefined),
    setUserActiveFor: vi.fn().mockImplementation((_c: string, id: string, isActive: boolean) =>
      Promise.resolve({
        id,
        email: id === 'u1' ? 'a@x.test' : 'b@x.test',
        displayName: '',
        isActive,
        authProvider: 'local',
        createdAt: '',
        updatedAt: '',
      }),
    ),
  };
  TestBed.configureTestingModule({
    imports: [PeopleComponent],
    providers: [{ provide: BackendService, useValue: backend }],
  });
  const fixture = TestBed.createComponent(PeopleComponent);
  return { fixture, backend };
}

describe('PeopleComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('marks invites unavailable when the endpoint rejects (graceful 404)', async () => {
    const { fixture } = configure({ invitesAvailable: false });
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    expect(fixture.componentInstance.invitesUnavailable()).toBe(true);
    expect(fixture.componentInstance.invites()).toEqual([]);
    // Members still loaded — the screen degrades, doesn't blank out.
    expect(fixture.componentInstance.members()).toHaveLength(2);
  });

  it('renders invites when the endpoint returns data', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    expect(fixture.componentInstance.invitesUnavailable()).toBe(false);
    expect(fixture.componentInstance.invites()).toHaveLength(1);
  });

  it('confirms with the invitee email before revoking', async () => {
    const { fixture, backend } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await fixture.componentInstance.revokeInvite({
      id: 'i1', email: 'b@x.test', roleId: 'r1', roleName: 'Dev', invitedAt: '',
    });
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('b@x.test'));
    expect(backend.revokeInviteFor).toHaveBeenCalledWith('c1', 'p1', 'i1');
    confirmSpy.mockRestore();
  });

  it('confirms with the member email before removing', async () => {
    const { fixture, backend } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await fixture.componentInstance.removeMember(MEMBERS[0]);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('a@x.test'));
    expect(backend.removeMemberFor).toHaveBeenCalledWith('c1', 'p1', 'u1');
    confirmSpy.mockRestore();
  });

  // CON-134 ---------------------------------------------------------------

  it('shows Deactivate/Reactivate action for admins on other users', async () => {
    const { fixture } = configure({ invitesAvailable: true, currentUserId: 'someone-else' });
    await fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.canFlipActive(MEMBERS[0])).toBe(true);
    expect(fixture.componentInstance.canFlipActive(MEMBERS[1])).toBe(true);
  });

  it('hides Deactivate on the caller\'s own row even for admins', async () => {
    const { fixture } = configure({ invitesAvailable: true, currentUserId: 'u1' });
    await fixture.componentInstance.ngOnInit();
    // u1 is the caller, so the button must be suppressed — the server would
    // 400 on self-deactivation and we prefer not to render a guaranteed-fail CTA.
    expect(fixture.componentInstance.canFlipActive(MEMBERS[0])).toBe(false);
    expect(fixture.componentInstance.canFlipActive(MEMBERS[1])).toBe(true);
  });

  it('hides Deactivate entirely for non-admin callers', async () => {
    const { fixture } = configure({ invitesAvailable: true, isAdmin: false });
    await fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.canDeactivateUsers()).toBe(false);
    expect(fixture.componentInstance.canFlipActive(MEMBERS[0])).toBe(false);
  });

  it('opens destructive confirm and calls PATCH with isActive:false on confirm', async () => {
    const { fixture, backend } = configure({ invitesAvailable: true, currentUserId: 'someone-else' });
    await fixture.componentInstance.ngOnInit();

    const fakeTrigger = document.createElement('button');
    fixture.componentInstance.openDeactivateConfirm(MEMBERS[0], { currentTarget: fakeTrigger } as unknown as Event);
    expect(fixture.componentInstance.deactivateOpen()).toBe(true);
    expect(fixture.componentInstance.deactivateTarget()?.userId).toBe('u1');

    await fixture.componentInstance.onDeactivateConfirmed();
    expect(backend.setUserActiveFor).toHaveBeenCalledWith('c1', 'u1', false);
    expect(fixture.componentInstance.deactivateOpen()).toBe(false);

    // Row patched in place with new isActive flag
    const patched = fixture.componentInstance.members().find(m => m.userId === 'u1');
    expect(patched?.isActive).toBe(false);

    // Success toast announced (polite)
    const t = fixture.componentInstance.toast();
    expect(t?.kind).toBe('success');
    expect(t?.message).toContain('deactivated');
    expect(t?.message).toContain('Sessions revoked');
  });

  it('reactivates with a single tap (no confirm) and announces success', async () => {
    const { fixture, backend } = configure({ invitesAvailable: true, currentUserId: 'someone-else' });
    await fixture.componentInstance.ngOnInit();
    await fixture.componentInstance.reactivateMember(MEMBERS[1]);

    expect(backend.setUserActiveFor).toHaveBeenCalledWith('c1', 'u2', true);
    const patched = fixture.componentInstance.members().find(m => m.userId === 'u2');
    expect(patched?.isActive).toBe(true);
    expect(fixture.componentInstance.toast()?.kind).toBe('success');
  });

  it('announces assertive error toast when the backend rejects', async () => {
    const { fixture, backend } = configure({ invitesAvailable: true, currentUserId: 'someone-else' });
    backend.setUserActiveFor.mockRejectedValueOnce(new Error('boom'));
    await fixture.componentInstance.ngOnInit();
    await fixture.componentInstance.reactivateMember(MEMBERS[1]);
    const t = fixture.componentInstance.toast();
    expect(t?.kind).toBe('error');
    expect(t?.message).toContain('boom');
  });
});
