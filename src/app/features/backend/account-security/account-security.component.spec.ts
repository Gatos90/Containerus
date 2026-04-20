import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

import { AccountSecurityComponent } from './account-security.component';
import { BackendService } from '../../../core/services/backend.service';

setupTestBed();

const SESSIONS = [
  {
    id: 's1',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
    ipAddress: '203.0.113.1',
    createdAt: '2026-04-18T10:00:00Z',
    expiresAt: '2026-05-18T10:00:00Z',
    lastUsedAt: '2026-04-20T19:58:00Z',
    isCurrent: true,
  },
  {
    id: 's2',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0',
    ipAddress: '198.51.100.7',
    createdAt: '2026-03-01T10:00:00Z',
    expiresAt: '2026-05-01T10:00:00Z',
    lastUsedAt: '2026-04-19T09:12:00Z',
    isCurrent: false,
  },
];

function configure(opts: {
  mfaEnabled?: boolean;
  listSessions?: () => Promise<unknown>;
  revoke?: () => Promise<void>;
  revokeAll?: () => Promise<{ revoked: number }>;
  enroll?: () => Promise<unknown>;
  verify?: () => Promise<unknown>;
  disable?: () => Promise<void>;
} = {}): { fixture: ComponentFixture<AccountSecurityComponent>; backend: any } {
  const backend = {
    connectedBackends: () => [
      {
        id: 'c1',
        user: { email: 'user@example.test', mfaEnabled: opts.mfaEnabled ?? false },
      },
    ],
    listMySessionsFor: vi
      .fn()
      .mockImplementation(opts.listSessions ?? (async () => SESSIONS)),
    revokeMySessionFor: vi
      .fn()
      .mockImplementation(opts.revoke ?? (async () => undefined)),
    revokeAllOtherSessionsFor: vi
      .fn()
      .mockImplementation(opts.revokeAll ?? (async () => ({ revoked: 1 }))),
    enrollMfaFor: vi
      .fn()
      .mockImplementation(
        opts.enroll ?? (async () => ({ secret: 'BASE32SECRET', otpauthUri: 'otpauth://totp/demo' })),
      ),
    verifyMfaEnrollmentFor: vi
      .fn()
      .mockImplementation(
        opts.verify ?? (async () => ({ enabled: true, backupCodes: ['AAAA-BBBB', 'CCCC-DDDD'] })),
      ),
    disableMfaFor: vi.fn().mockImplementation(opts.disable ?? (async () => undefined)),
  };
  TestBed.configureTestingModule({
    imports: [AccountSecurityComponent],
    providers: [{ provide: BackendService, useValue: backend }],
  });
  const fixture = TestBed.createComponent(AccountSecurityComponent);
  return { fixture, backend };
}

describe('AccountSecurityComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('loads sessions and keeps the backend-provided order', async () => {
    const { fixture } = configure();
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const rows = fixture.componentInstance.sessions();
    expect(rows).toHaveLength(2);
    expect(rows[0].isCurrent).toBe(true);
    expect(fixture.componentInstance.otherSessionsCount()).toBe(1);
  });

  it('refuses to revoke the current session and does not call the API', async () => {
    const { fixture, backend } = configure();
    await fixture.componentInstance.ngOnInit();
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await fixture.componentInstance.revokeSession(SESSIONS[0]);
    expect(backend.revokeMySessionFor).not.toHaveBeenCalled();
    expect(fixture.componentInstance.toast()?.kind).toBe('error');
    confirmSpy.mockRestore();
  });

  it('optimistically removes a non-current session on revoke', async () => {
    const { fixture, backend } = configure();
    await fixture.componentInstance.ngOnInit();
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await fixture.componentInstance.revokeSession(SESSIONS[1]);
    expect(backend.revokeMySessionFor).toHaveBeenCalledWith('c1', 's2');
    expect(fixture.componentInstance.sessions().map((s) => s.id)).toEqual(['s1']);
    expect(fixture.componentInstance.toast()?.kind).toBe('success');
    confirmSpy.mockRestore();
  });

  it('restores the session list when the revoke request fails', async () => {
    const { fixture } = configure({
      revoke: () => Promise.reject(new Error('nope')),
    });
    await fixture.componentInstance.ngOnInit();
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await fixture.componentInstance.revokeSession(SESSIONS[1]);
    expect(fixture.componentInstance.sessions().map((s) => s.id)).toEqual(['s1', 's2']);
    expect(fixture.componentInstance.toast()?.kind).toBe('error');
    confirmSpy.mockRestore();
  });

  it('revokes all other sessions and refetches the list', async () => {
    const { fixture, backend } = configure({ revokeAll: async () => ({ revoked: 1 }) });
    await fixture.componentInstance.ngOnInit();
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await fixture.componentInstance.revokeAllOtherSessions();
    expect(backend.revokeAllOtherSessionsFor).toHaveBeenCalledWith('c1');
    expect(backend.listMySessionsFor).toHaveBeenCalledTimes(2);
    confirmSpy.mockRestore();
  });

  it('humanizes macOS Safari user agents', async () => {
    const { fixture } = configure();
    const label = fixture.componentInstance.humanizeUserAgent(SESSIONS[0].userAgent);
    expect(label).toBe('Safari on macOS');
  });

  it('falls back to a truncated UA when no browser/OS is recognised', async () => {
    const { fixture } = configure();
    const label = fixture.componentInstance.humanizeUserAgent('curl/8.4.0');
    expect(label).toBe('curl/8.4.0');
  });

  it('enroll → verify transitions to backup-codes and flips mfaEnabled', async () => {
    const { fixture, backend } = configure();
    await fixture.componentInstance.ngOnInit();
    await fixture.componentInstance.openEnableMfa({ currentTarget: null } as unknown as Event);
    expect(backend.enrollMfaFor).toHaveBeenCalledWith('c1');
    expect(fixture.componentInstance.mfaStep()).toBe('verify');
    fixture.componentInstance.onMfaCodeChanged('123456');
    await fixture.componentInstance.submitVerify();
    expect(backend.verifyMfaEnrollmentFor).toHaveBeenCalledWith('c1', '123456');
    expect(fixture.componentInstance.mfaEnabled()).toBe(true);
    expect(fixture.componentInstance.mfaStep()).toBe('backup-codes');
    expect(fixture.componentInstance.backupCodes()).toEqual(['AAAA-BBBB', 'CCCC-DDDD']);
  });

  it('rejects verify with a short code without calling the API', async () => {
    const { fixture, backend } = configure();
    await fixture.componentInstance.ngOnInit();
    await fixture.componentInstance.openEnableMfa({ currentTarget: null } as unknown as Event);
    fixture.componentInstance.onMfaCodeChanged('123');
    await fixture.componentInstance.submitVerify();
    expect(backend.verifyMfaEnrollmentFor).not.toHaveBeenCalled();
    expect(fixture.componentInstance.mfaError()).toContain('6-digit');
  });

  it('surfaces a backend error during verify and stays on the verify step', async () => {
    const { fixture } = configure({ verify: () => Promise.reject(new Error('Invalid code')) });
    await fixture.componentInstance.ngOnInit();
    await fixture.componentInstance.openEnableMfa({ currentTarget: null } as unknown as Event);
    fixture.componentInstance.onMfaCodeChanged('654321');
    await fixture.componentInstance.submitVerify();
    expect(fixture.componentInstance.mfaStep()).toBe('verify');
    expect(fixture.componentInstance.mfaError()).toBe('Invalid code');
    expect(fixture.componentInstance.mfaEnabled()).toBe(false);
  });

  it('disables MFA and flips the flag off', async () => {
    const { fixture, backend } = configure({ mfaEnabled: true });
    await fixture.componentInstance.ngOnInit();
    await fixture.componentInstance.openDisableMfa({ currentTarget: null } as unknown as Event);
    fixture.componentInstance.onMfaCodeChanged('999999');
    await fixture.componentInstance.submitDisable();
    expect(backend.disableMfaFor).toHaveBeenCalledWith('c1', '999999');
    expect(fixture.componentInstance.mfaEnabled()).toBe(false);
    expect(fixture.componentInstance.mfaDrawerOpen()).toBe(false);
  });
});
