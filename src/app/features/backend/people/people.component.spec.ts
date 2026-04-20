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
const ROLES = [
  { id: 'r1', name: 'Dev', slug: 'dev', isSystem: false, createdAt: '', updatedAt: '' },
  { id: 'r2', name: 'Admin', slug: 'admin', isSystem: true, createdAt: '', updatedAt: '' },
];

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
    inviteMembersBulkFor: vi
      .fn()
      .mockResolvedValue({ invited: [], skipped: [], errored: [] }),
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

  // CON-135 — bulk invite --------------------------------------------------

  it('parses email-only paste lines onto the default role', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.bulkPaste.set('alice@x.test\nbob@x.test');
    fixture.componentInstance.loadBulkPreview();

    const rows = fixture.componentInstance.bulkRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].email).toBe('alice@x.test');
    expect(rows[0].roleId).toBe('r1');
    expect(rows[0].rawRoleLabel).toBeNull();
    // Every row must be valid when emails are well-formed and the default
    // role is set — otherwise the submit button would be disabled for the
    // most common "paste a list of emails" flow.
    expect(fixture.componentInstance.bulkErrorCount()).toBe(0);
    expect(fixture.componentInstance.bulkCanSubmit()).toBe(true);
  });

  it('parses email,role pairs and matches role by name or slug', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.bulkPaste.set('alice@x.test,Admin\nbob@x.test,dev');
    fixture.componentInstance.loadBulkPreview();

    const [a, b] = fixture.componentInstance.bulkRows();
    expect(a.roleId).toBe('r2'); // matched "Admin" by name
    expect(b.roleId).toBe('r1'); // matched "dev" by slug
    expect(fixture.componentInstance.bulkErrorCount()).toBe(0);
  });

  it('marks unknown role labels as unknown_role (not silent fallback)', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.bulkPaste.set('alice@x.test,Wizard');
    fixture.componentInstance.loadBulkPreview();

    const issues = fixture.componentInstance.bulkRowValidation()[0].issues;
    expect(issues).toContain('unknown_role');
    expect(fixture.componentInstance.bulkRows()[0].rawRoleLabel).toBe('Wizard');
    expect(fixture.componentInstance.bulkCanSubmit()).toBe(false);
  });

  it('flags invalid emails in preview and disables submit', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.bulkPaste.set('not-an-email\nalice@x.test');
    fixture.componentInstance.loadBulkPreview();

    const issues = fixture.componentInstance.bulkRowValidation()[0].issues;
    expect(issues).toContain('invalid_email');
    expect(fixture.componentInstance.bulkErrorCount()).toBe(1);
    expect(fixture.componentInstance.bulkCanSubmit()).toBe(false);
  });

  it('deduplicates paste input case-insensitively', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.bulkPaste.set('Alice@X.test\nalice@x.test');
    fixture.componentInstance.loadBulkPreview();

    // Only one row survives — the server would skip the duplicate anyway,
    // and showing one is clearer than two identical preview rows.
    expect(fixture.componentInstance.bulkRows()).toHaveLength(1);
  });

  it('rejects > 100 rows client-side with a clear over-cap indicator', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    const paste = Array.from({ length: 101 }, (_, i) => `user${i}@x.test`).join('\n');
    fixture.componentInstance.bulkPaste.set(paste);
    fixture.componentInstance.loadBulkPreview();

    expect(fixture.componentInstance.bulkRows().length).toBe(101);
    expect(fixture.componentInstance.bulkOverCap()).toBe(true);
    expect(fixture.componentInstance.bulkCanSubmit()).toBe(false);
  });

  it('fix-in-place: editing the role re-validates the row', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.bulkPaste.set('alice@x.test,Wizard');
    fixture.componentInstance.loadBulkPreview();
    const rowId = fixture.componentInstance.bulkRows()[0].id;

    // Before: unknown role
    expect(fixture.componentInstance.bulkErrorCount()).toBe(1);

    // Operator picks a real role from the row dropdown.
    fixture.componentInstance.updateBulkRowRole(rowId, 'r1');
    expect(fixture.componentInstance.bulkErrorCount()).toBe(0);
    expect(fixture.componentInstance.bulkRows()[0].rawRoleLabel).toBeNull();
  });

  it('submits the partitioned bulk payload and renders per-reason result', async () => {
    const { fixture, backend } = configure({ invitesAvailable: true });
    backend.inviteMembersBulkFor.mockResolvedValueOnce({
      invited: [{ email: 'alice@x.test', userId: 'uA', roleId: 'r1' }],
      skipped: [{ email: 'bob@x.test', reason: 'already_member' }],
      errored: [{ email: 'carol@x.test', reason: 'unknown_user' }],
    });

    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.bulkPaste.set('alice@x.test\nbob@x.test\ncarol@x.test');
    fixture.componentInstance.loadBulkPreview();
    await fixture.componentInstance.submitBulk();

    expect(backend.inviteMembersBulkFor).toHaveBeenCalledWith('c1', 'p1', {
      invites: [
        { email: 'alice@x.test', roleId: 'r1' },
        { email: 'bob@x.test', roleId: 'r1' },
        { email: 'carol@x.test', roleId: 'r1' },
      ],
    });

    const r = fixture.componentInstance.bulkResult();
    expect(r?.invited.length).toBe(1);
    expect(r?.skipped[0].reason).toBe('already_member');
    expect(r?.errored[0].reason).toBe('unknown_user');

    // Errored > 0 flips the toast to the assertive/error channel so
    // screen-reader users aren't told "all good" on a partial success.
    const t = fixture.componentInstance.toast();
    expect(t?.kind).toBe('error');
    expect(t?.message).toContain('1 invited');
    expect(t?.message).toContain('1 errored');
  });

  it('humanises reason codes in the result rendering', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.describeReason('already_member')).toMatch(/already/i);
    expect(fixture.componentInstance.describeReason('invalid_email')).toMatch(/invalid/i);
    expect(fixture.componentInstance.describeReason('rate_limited')).toMatch(/rate limit/i);
    // Forward-compat — unknown codes fall through rather than being dropped.
    expect(fixture.componentInstance.describeReason('future_code')).toBe('future_code');
  });

  it('resetBulkState via Clear empties paste, rows, and result', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.bulkPaste.set('alice@x.test');
    fixture.componentInstance.loadBulkPreview();
    expect(fixture.componentInstance.bulkRows()).toHaveLength(1);

    fixture.componentInstance.clearBulk();
    expect(fixture.componentInstance.bulkPaste()).toBe('');
    expect(fixture.componentInstance.bulkRows()).toHaveLength(0);
    expect(fixture.componentInstance.bulkResult()).toBeNull();
  });

  it('opens drawer in single mode and toggles to bulk without dropping paste', async () => {
    const { fixture } = configure({ invitesAvailable: true });
    await fixture.componentInstance.ngOnInit();
    const fakeTrigger = document.createElement('button');
    fixture.componentInstance.openInvite({ currentTarget: fakeTrigger } as unknown as Event);
    expect(fixture.componentInstance.inviteMode()).toBe('single');

    fixture.componentInstance.setInviteMode('bulk');
    fixture.componentInstance.bulkPaste.set('alice@x.test');
    fixture.componentInstance.setInviteMode('single');
    fixture.componentInstance.setInviteMode('bulk');
    // Toggling modes must not wipe the textarea — the only reset points
    // are drawer open and explicit Clear.
    expect(fixture.componentInstance.bulkPaste()).toBe('alice@x.test');
  });
});
