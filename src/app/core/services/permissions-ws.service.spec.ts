import { describe, it, expect } from 'vitest';
import { buildPermissionsWsUrl } from './permissions-ws.service';

describe('buildPermissionsWsUrl', () => {
  it('maps http → ws', () => {
    expect(buildPermissionsWsUrl('http://localhost:8080')).toBe(
      'ws://localhost:8080/api/ws/permissions',
    );
  });

  it('maps https → wss', () => {
    expect(buildPermissionsWsUrl('https://containerus.example.com')).toBe(
      'wss://containerus.example.com/api/ws/permissions',
    );
  });

  it('preserves a non-root API path prefix', () => {
    expect(buildPermissionsWsUrl('https://example.com/svc/containerus/')).toBe(
      'wss://example.com/svc/containerus/api/ws/permissions',
    );
  });

  it('strips query and fragment from the base URL', () => {
    expect(
      buildPermissionsWsUrl('https://example.com/?foo=bar#hash'),
    ).toBe('wss://example.com/api/ws/permissions');
  });

  it('throws on a malformed URL', () => {
    expect(() => buildPermissionsWsUrl('not a url')).toThrow();
  });
});
