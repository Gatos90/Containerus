import { describe, it, expect } from 'vitest';
import { parseHostKeyError } from './host-key-error';

describe('parseHostKeyError', () => {
  const sysId = 'sys-1';

  it('parses the Unknown host key template (from ssh/client.rs)', () => {
    const msg =
      'Connection failed: SSH host key verification failed for 87.106.242.131: ' +
      'Unknown host key for port 22.\n' +
      'Key type: ssh-ed25519\n' +
      'Fingerprint: SHA256:wuTqTxzYCpNEFRpgiB0tYLME+avaHR60HYJBYojBY2o\n' +
      'To connect, explicitly trust this host key via the UI.';

    const info = parseHostKeyError(sysId, msg);

    expect(info.kind).toBe('unknown');
    if (info.kind !== 'unknown') throw new Error('narrowing');
    expect(info.systemId).toBe(sysId);
    expect(info.hostname).toBe('87.106.242.131');
    expect(info.port).toBe('22');
    expect(info.keyType).toBe('ssh-ed25519');
    expect(info.fingerprint).toBe('SHA256:wuTqTxzYCpNEFRpgiB0tYLME+avaHR60HYJBYojBY2o');
  });

  it('parses the Mismatch host key template', () => {
    const msg =
      'Connection failed: SSH host key verification failed for example.com: ' +
      'Host key has changed!\n' +
      'Port: 2222\n' +
      'Expected: SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n' +
      'Received: SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

    const info = parseHostKeyError(sysId, msg);

    expect(info.kind).toBe('mismatch');
    if (info.kind !== 'mismatch') throw new Error('narrowing');
    expect(info.hostname).toBe('example.com');
    expect(info.port).toBe('2222');
    expect(info.expectedFingerprint).toBe('SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(info.receivedFingerprint).toBe('SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  });

  it('parses the retry wrapper from trust_host_key failure', () => {
    const msg =
      'Connection failed after trusting new key: SSH host key verification failed for 10.0.0.5: ' +
      'Unknown host key for port 22.\n' +
      'Key type: ssh-rsa\n' +
      'Fingerprint: SHA256:ZZZ';

    const info = parseHostKeyError(sysId, msg);

    expect(info.kind).toBe('unknown');
    if (info.kind !== 'unknown') throw new Error('narrowing');
    expect(info.hostname).toBe('10.0.0.5');
    expect(info.keyType).toBe('ssh-rsa');
    expect(info.fingerprint).toBe('SHA256:ZZZ');
  });

  it('falls back to unknown kind with best-effort fields when fingerprint is missing', () => {
    const info = parseHostKeyError(sysId, 'SSH host key verification failed for host: something weird');
    expect(info.kind).toBe('unknown');
    if (info.kind !== 'unknown') throw new Error('narrowing');
    expect(info.hostname).toBe('host');
    expect(info.fingerprint).toBe('unknown');
  });
});
