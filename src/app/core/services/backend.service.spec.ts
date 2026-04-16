import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must be hoisted before any imports that call invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

import { BackendService } from './backend.service';
import { invoke } from '@tauri-apps/api/core';

const mockInvoke = vi.mocked(invoke);

function makeConn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    serverUrl: 'http://localhost:8080',
    label: 'local',
    tokens: null,
    user: null,
    projects: [],
    projectPermissions: {},
    status: 'disconnected' as const,
    ...overrides,
  };
}

function makeResponse(
  body: unknown,
  status = 200,
  ok = true,
): Response {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('BackendService', () => {
  let service: BackendService;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue([]);
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    service = new BackendService();
    // Flush microtasks so loadPersistedConnections (which awaits a mocked invoke)
    // completes without advancing the setInterval timer.
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Computed signals
  // =========================================================================

  describe('computed signals', () => {
    it('isBackendMode is false when no connections', () => {
      expect(service.isBackendMode()).toBe(false);
    });

    it('hasConnections is false initially', () => {
      expect(service.hasConnections()).toBe(false);
    });

    it('isAuthenticated is false when no connected backends', () => {
      expect(service.isAuthenticated()).toBe(false);
    });

    it('serverUrl is empty string when no connected backends', () => {
      expect(service.serverUrl()).toBe('');
    });

    it('user is null when no connected backends', () => {
      expect(service.user()).toBe(null);
    });

    it('projects is empty array when no connected backends', () => {
      expect(service.projects()).toEqual([]);
    });

    it('connectedBackends filters to only connected status', () => {
      const conn1 = makeConn({ id: 'c1', status: 'connected' });
      const conn2 = makeConn({ id: 'c2', status: 'disconnected' });
      (service as any)._connections.set([conn1, conn2]);

      expect(service.connectedBackends()).toHaveLength(1);
      expect(service.connectedBackends()[0].id).toBe('c1');
    });

    it('isBackendMode is true when at least one connected', () => {
      (service as any)._connections.set([makeConn({ id: 'c1', status: 'connected' })]);
      expect(service.isBackendMode()).toBe(true);
    });

    it('hasConnections is true when connection list is non-empty', () => {
      (service as any)._connections.set([makeConn()]);
      expect(service.hasConnections()).toBe(true);
    });

    it('isAuthenticated is true when connected backend exists', () => {
      (service as any)._connections.set([makeConn({ status: 'connected' })]);
      expect(service.isAuthenticated()).toBe(true);
    });

    it('serverUrl returns first connected backend url', () => {
      (service as any)._connections.set([
        makeConn({ id: 'c1', serverUrl: 'http://server1', status: 'connected' }),
      ]);
      expect(service.serverUrl()).toBe('http://server1');
    });
  });

  // =========================================================================
  // Connection management
  // =========================================================================

  describe('getConnection', () => {
    it('returns connection by id', () => {
      const conn = makeConn({ id: 'abc' });
      (service as any)._connections.set([conn]);
      expect(service.getConnection('abc')).toMatchObject({ id: 'abc' });
    });

    it('returns undefined for unknown id', () => {
      expect(service.getConnection('nonexistent')).toBeUndefined();
    });
  });

  describe('getLatestConnection', () => {
    it('returns last connection in the list', () => {
      const c1 = makeConn({ id: 'c1' });
      const c2 = makeConn({ id: 'c2' });
      (service as any)._connections.set([c1, c2]);
      expect(service.getLatestConnection()?.id).toBe('c2');
    });

    it('returns undefined when list is empty', () => {
      expect(service.getLatestConnection()).toBeUndefined();
    });
  });

  describe('addBackend', () => {
    it('adds connection after successful health check', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({}, 200));

      const id = await service.addBackend('http://localhost:8080');

      expect(id).toBeTruthy();
      expect(service.hasConnections()).toBe(true);
      const conn = service.getConnection(id);
      expect(conn?.serverUrl).toBe('http://localhost:8080');
      expect(conn?.status).toBe('disconnected');
    });

    it('strips trailing slash from server url', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({}, 200));

      const id = await service.addBackend('http://localhost:8080/');
      expect(service.getConnection(id)?.serverUrl).toBe('http://localhost:8080');
    });

    it('uses hostname as label when none provided', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({}, 200));

      const id = await service.addBackend('http://myserver.local:8080');
      expect(service.getConnection(id)?.label).toBe('myserver.local');
    });

    it('uses provided label', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({}, 200));

      const id = await service.addBackend('http://localhost:8080', 'My Server');
      expect(service.getConnection(id)?.label).toBe('My Server');
    });

    it('throws when health check returns non-ok', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({}, 503, false));

      await expect(service.addBackend('http://localhost:8080')).rejects.toThrow(
        'Cannot reach server at http://localhost:8080 (HTTP 503)',
      );
    });

    it('throws when fetch throws (unreachable)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.addBackend('http://localhost:8080')).rejects.toThrow(
        'Cannot reach server at http://localhost:8080',
      );
    });

    it('throws on AbortError (timeout)', async () => {
      fetchSpy.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'AbortError' }));

      await expect(service.addBackend('http://localhost:8080')).rejects.toThrow('timed out');
    });
  });

  describe('removeBackend', () => {
    it('removes connection from list', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({}, 200));
      const id = await service.addBackend('http://localhost:8080');

      service.removeBackend(id);

      expect(service.hasConnections()).toBe(false);
    });

    it('removes system ownership entries for the connection', async () => {
      (service as any)._connections.set([makeConn({ id: 'conn-x' })]);
      (service as any)._systemOwnership.set('sys-1', 'conn-x');

      service.removeBackend('conn-x');

      expect((service as any)._systemOwnership.has('sys-1')).toBe(false);
    });

    it('removes connection from userLoggedOut set', () => {
      (service as any)._userLoggedOut.add('conn-y');
      (service as any)._connections.set([makeConn({ id: 'conn-y' })]);

      service.removeBackend('conn-y');

      expect((service as any)._userLoggedOut.has('conn-y')).toBe(false);
    });
  });

  // =========================================================================
  // Authentication
  // =========================================================================

  describe('loginToBackend', () => {
    beforeEach(() => {
      (service as any)._connections.set([makeConn({ id: 'conn-1' })]);
    });

    it('updates connection to connected on success', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeResponse({
          accessToken: 'at',
          refreshToken: 'rt',
          user: { id: 'u1', email: 'a@b.com' },
        }),
      );
      // loadProjectsFor call
      fetchSpy.mockResolvedValueOnce(makeResponse([]));

      await service.loginToBackend('conn-1', {
        email: 'a@b.com',
        password: 'secret',
      } as any);

      const conn = service.getConnection('conn-1');
      expect(conn?.status).toBe('connected');
      expect(conn?.tokens?.accessToken).toBe('at');
      expect(conn?.user?.email).toBe('a@b.com');
    });

    it('sets status to error and rethrows on failure', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ error: 'Invalid credentials' }, 401, false));

      await expect(
        service.loginToBackend('conn-1', { email: 'x@y.com', password: 'bad' } as any),
      ).rejects.toThrow();

      expect(service.getConnection('conn-1')?.status).toBe('error');
    });

    it('removes connectionId from userLoggedOut set', async () => {
      (service as any)._userLoggedOut.add('conn-1');
      fetchSpy.mockResolvedValueOnce(
        makeResponse({ accessToken: 'at', refreshToken: 'rt', user: { id: 'u1', email: 'a@b.com' } }),
      );
      fetchSpy.mockResolvedValueOnce(makeResponse([]));

      await service.loginToBackend('conn-1', { email: 'a@b.com', password: 'p' } as any);

      expect((service as any)._userLoggedOut.has('conn-1')).toBe(false);
    });
  });

  describe('registerOnBackend', () => {
    beforeEach(() => {
      (service as any)._connections.set([makeConn({ id: 'conn-1' })]);
    });

    it('creates account and connects on success', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeResponse({
          accessToken: 'at2',
          refreshToken: 'rt2',
          user: { id: 'u2', email: 'new@user.com' },
        }),
      );
      fetchSpy.mockResolvedValueOnce(makeResponse([]));

      await service.registerOnBackend('conn-1', {
        email: 'new@user.com',
        password: 'pw',
        name: 'New User',
      } as any);

      const conn = service.getConnection('conn-1');
      expect(conn?.status).toBe('connected');
      expect(conn?.tokens?.accessToken).toBe('at2');
    });

    it('sets status to error on failure', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ error: 'email taken' }, 409, false));

      await expect(
        service.registerOnBackend('conn-1', { email: 'x@y.com', password: 'p', name: 'X' } as any),
      ).rejects.toThrow();

      expect(service.getConnection('conn-1')?.status).toBe('error');
    });
  });

  describe('logoutFrom', () => {
    it('clears tokens, user, and sets status to disconnected', () => {
      (service as any)._connections.set([
        makeConn({
          id: 'conn-1',
          status: 'connected',
          tokens: { accessToken: 'at', refreshToken: 'rt' },
          user: { id: 'u1', email: 'a@b.com' },
        }),
      ]);

      service.logoutFrom('conn-1');

      const conn = service.getConnection('conn-1');
      expect(conn?.tokens).toBeNull();
      expect(conn?.user).toBeNull();
      expect(conn?.status).toBe('disconnected');
      expect(conn?.projects).toEqual([]);
    });

    it('marks connection as user-logged-out to skip auto-reconnect', () => {
      (service as any)._connections.set([makeConn({ id: 'conn-1' })]);

      service.logoutFrom('conn-1');

      expect((service as any)._userLoggedOut.has('conn-1')).toBe(true);
    });

    it('removes system ownership for the connection', () => {
      (service as any)._connections.set([makeConn({ id: 'conn-1' })]);
      (service as any)._systemOwnership.set('sys-a', 'conn-1');

      service.logoutFrom('conn-1');

      expect((service as any)._systemOwnership.has('sys-a')).toBe(false);
    });
  });

  describe('switchToLocal', () => {
    it('clears all connections', () => {
      (service as any)._connections.set([makeConn({ id: 'c1' }), makeConn({ id: 'c2' })]);

      service.switchToLocal();

      expect(service.hasConnections()).toBe(false);
    });

    it('clears system ownership map', () => {
      (service as any)._systemOwnership.set('sys-1', 'c1');

      service.switchToLocal();

      expect((service as any)._systemOwnership.size).toBe(0);
    });
  });

  // =========================================================================
  // Permissions
  // =========================================================================

  describe('hasPermission', () => {
    beforeEach(() => {
      (service as any)._connections.set([
        makeConn({
          id: 'conn-1',
          projectPermissions: {
            'proj-1': { isCompanyAdmin: false, permissions: ['containers:read', 'containers:write'] },
            'proj-2': { isCompanyAdmin: false, permissions: ['images:read'] },
          },
        }),
      ]);
    });

    it('returns true when project grants the permission', () => {
      expect(service.hasPermission('conn-1', 'containers:read', 'proj-1')).toBe(true);
    });

    it('returns false when project does not grant the permission', () => {
      expect(service.hasPermission('conn-1', 'containers:write', 'proj-2')).toBe(false);
    });

    it('returns true for company admin regardless of permission', () => {
      (service as any)._connections.set([
        makeConn({
          id: 'conn-1',
          projectPermissions: {
            'proj-1': { isCompanyAdmin: true, permissions: [] },
          },
        }),
      ]);
      expect(service.hasPermission('conn-1', 'anything', 'proj-1')).toBe(true);
    });

    it('returns false for unknown connection', () => {
      expect(service.hasPermission('unknown', 'containers:read', 'proj-1')).toBe(false);
    });

    it('returns false when project not found in permissions map', () => {
      expect(service.hasPermission('conn-1', 'containers:read', 'proj-nonexistent')).toBe(false);
    });

    it('checks any project when no projectId given', () => {
      expect(service.hasPermission('conn-1', 'images:read')).toBe(true);
      expect(service.hasPermission('conn-1', 'admin:write')).toBe(false);
    });
  });

  // =========================================================================
  // requestFor — HTTP helper with token refresh
  // =========================================================================

  describe('requestFor', () => {
    beforeEach(() => {
      (service as any)._connections.set([
        makeConn({
          id: 'conn-1',
          serverUrl: 'http://api.example.com',
          tokens: { accessToken: 'good-token', refreshToken: 'refresh-token' },
          status: 'connected',
        }),
      ]);
    });

    it('throws when connection not found', async () => {
      await expect(service.requestFor('bad-id', 'GET', '/api/test')).rejects.toThrow(
        'Backend connection bad-id not found',
      );
    });

    it('makes authenticated GET request and returns parsed JSON', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ data: 'ok' }));

      const result = await service.requestFor<{ data: string }>('conn-1', 'GET', '/api/test');

      expect(result).toEqual({ data: 'ok' });
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://api.example.com/api/test',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer good-token' }),
        }),
      );
    });

    it('includes JSON body for POST requests', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ created: true }));

      await service.requestFor('conn-1', 'POST', '/api/items', { name: 'test' });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ name: 'test' }) }),
      );
    });

    it('throws on non-ok response', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ error: 'Not found' }, 404, false));

      await expect(service.requestFor('conn-1', 'GET', '/api/missing')).rejects.toThrow('Not found');
    });

    it('marks connection disconnected when fetch throws network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.requestFor('conn-1', 'GET', '/api/test')).rejects.toThrow();

      expect(service.getConnection('conn-1')?.status).toBe('disconnected');
    });

    it('throws timeout error on AbortError', async () => {
      fetchSpy.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));

      await expect(service.requestFor('conn-1', 'GET', '/api/test')).rejects.toThrow(
        'timed out',
      );
    });

    it('returns undefined for empty response body', async () => {
      const emptyResp = {
        ok: true,
        status: 204,
        text: vi.fn().mockResolvedValue(''),
        json: vi.fn(),
      } as unknown as Response;
      fetchSpy.mockResolvedValueOnce(emptyResp);

      const result = await service.requestFor('conn-1', 'DELETE', '/api/item/1');
      expect(result).toBeUndefined();
    });

    describe('401 → token refresh flow', () => {
      it('refreshes token and retries request on 401', async () => {
        // First call returns 401
        fetchSpy.mockResolvedValueOnce(makeResponse({ error: 'Unauthorized' }, 401, false));
        // Token refresh succeeds
        fetchSpy.mockResolvedValueOnce(
          makeResponse({ accessToken: 'new-at', refreshToken: 'new-rt' }),
        );
        // Retry succeeds
        fetchSpy.mockResolvedValueOnce(makeResponse({ data: 'secret' }));

        const result = await service.requestFor<{ data: string }>('conn-1', 'GET', '/api/secure');

        expect(result).toEqual({ data: 'secret' });
        expect(fetchSpy).toHaveBeenCalledTimes(3);
      });

      it('disconnects and throws when refresh returns 401 (expired refresh token)', async () => {
        // First request returns 401
        fetchSpy.mockResolvedValueOnce(makeResponse({ error: 'Unauthorized' }, 401, false));
        // Refresh returns 401 (expired)
        fetchSpy.mockResolvedValueOnce(makeResponse({ error: 'expired' }, 401, false));

        await expect(service.requestFor('conn-1', 'GET', '/api/secure')).rejects.toThrow(
          'Session expired',
        );

        const conn = service.getConnection('conn-1');
        expect(conn?.status).toBe('disconnected');
        expect(conn?.user).toBeNull();
      });

      it('deduplicates concurrent refresh requests', async () => {
        // All initial requests return 401
        fetchSpy
          .mockResolvedValueOnce(makeResponse({}, 401, false))
          .mockResolvedValueOnce(makeResponse({}, 401, false));
        // One shared refresh
        fetchSpy.mockResolvedValueOnce(
          makeResponse({ accessToken: 'new-at', refreshToken: 'new-rt' }),
        );
        // Both retries succeed
        fetchSpy
          .mockResolvedValueOnce(makeResponse({ a: 1 }))
          .mockResolvedValueOnce(makeResponse({ b: 2 }));

        const [r1, r2] = await Promise.all([
          service.requestFor('conn-1', 'GET', '/api/r1'),
          service.requestFor('conn-1', 'GET', '/api/r2'),
        ]);

        expect(r1).toEqual({ a: 1 });
        expect(r2).toEqual({ b: 2 });
        // Only one refresh call should have happened
        const refreshCalls = (fetchSpy as any).mock.calls.filter(
          (c: any[]) => typeof c[0] === 'string' && c[0].includes('/auth/refresh'),
        );
        expect(refreshCalls).toHaveLength(1);
      });
    });
  });

  // =========================================================================
  // refreshTokenFor
  // =========================================================================

  describe('refreshTokenFor', () => {
    beforeEach(() => {
      (service as any)._connections.set([
        makeConn({
          id: 'conn-1',
          serverUrl: 'http://api.example.com',
          tokens: { accessToken: 'old-at', refreshToken: 'rt' },
        }),
      ]);
    });

    it('updates access token on success', async () => {
      fetchSpy.mockResolvedValueOnce(
        makeResponse({ accessToken: 'fresh-at', refreshToken: 'fresh-rt' }),
      );

      await service.refreshTokenFor('conn-1');

      expect(service.getConnection('conn-1')?.tokens?.accessToken).toBe('fresh-at');
    });

    it('throws when no refresh token available', async () => {
      (service as any)._connections.set([makeConn({ id: 'conn-1', tokens: null })]);

      await expect(service.refreshTokenFor('conn-1')).rejects.toThrow('No refresh token');
    });

    it('clears connection and throws when server returns 401', async () => {
      fetchSpy.mockResolvedValueOnce(makeResponse({ error: 'expired' }, 401, false));

      await expect(service.refreshTokenFor('conn-1')).rejects.toThrow('Refresh token expired');

      const conn = service.getConnection('conn-1');
      expect(conn?.tokens).toBeNull();
      expect(conn?.status).toBe('disconnected');
    });
  });

  // =========================================================================
  // updateConnection
  // =========================================================================

  describe('updateConnection', () => {
    it('applies partial updates to the matching connection', () => {
      (service as any)._connections.set([makeConn({ id: 'conn-1', status: 'disconnected' })]);

      service.updateConnection('conn-1', { status: 'connecting' });

      expect(service.getConnection('conn-1')?.status).toBe('connecting');
    });

    it('does not affect other connections', () => {
      (service as any)._connections.set([
        makeConn({ id: 'conn-1' }),
        makeConn({ id: 'conn-2', label: 'second' }),
      ]);

      service.updateConnection('conn-1', { label: 'updated' });

      expect(service.getConnection('conn-2')?.label).toBe('second');
    });
  });

  // =========================================================================
  // waitForReady
  // =========================================================================

  describe('waitForReady', () => {
    it('returns a promise that resolves', async () => {
      await expect(service.waitForReady()).resolves.toBeUndefined();
    });
  });
});
