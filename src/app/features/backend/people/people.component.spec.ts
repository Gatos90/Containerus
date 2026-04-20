import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

import { PeopleComponent } from './people.component';
import { BackendService } from '../../../core/services/backend.service';

setupTestBed();

const MEMBERS = [
  { userId: 'u1', email: 'a@x.test', displayName: 'Ann', roleId: 'r1', roleName: 'Dev', roleSlug: 'dev', joinedAt: '2026-01-01T00:00:00Z' },
];
const ROLES = [{ id: 'r1', name: 'Dev', slug: 'dev', isSystem: false, createdAt: '', updatedAt: '' }];

function configure(opts: { invitesAvailable: boolean }): { fixture: ComponentFixture<PeopleComponent>; backend: any } {
  const backend = {
    connectedBackends: () => [{ id: 'c1', projects: [{ id: 'p1', name: 'Proj' }] }],
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
    expect(fixture.componentInstance.members()).toHaveLength(1);
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
});
