export type HostKeyInfo =
  | {
      kind: 'unknown';
      systemId: string;
      hostname: string;
      port?: string;
      keyType?: string;
      fingerprint: string;
    }
  | {
      kind: 'mismatch';
      systemId: string;
      hostname: string;
      port?: string;
      expectedFingerprint: string;
      receivedFingerprint: string;
    };

/**
 * Parse the string payload of a `HostKeyVerificationFailed` error into structured data.
 * Handles both backend templates from `crates/containerus-core/src/ssh/client.rs`:
 *   - Unknown:  "SSH host key verification failed for {host}: Unknown host key for port {port}.\nKey type: {kt}\nFingerprint: {fp}\n..."
 *   - Mismatch: "SSH host key verification failed for {host}: Host key has changed!\nPort: {port}\nExpected: {fp}\nReceived: {fp}"
 * The backend may prefix with "Connection failed:" or "Connection failed after trusting new key:".
 * Remove once the backend exposes structured fields in the error payload.
 */
export function parseHostKeyError(systemId: string, errorMsg: string): HostKeyInfo {
  const hostname = errorMsg.match(/verification failed for ([^\s:]+)/i)?.[1] ?? 'unknown';
  const port = errorMsg.match(/(?:for )?port[:\s]+(\d+)/i)?.[1];

  if (/host key has changed/i.test(errorMsg)) {
    const expected = errorMsg.match(/expected[:\s]+([^\s,]+)/i)?.[1] ?? 'unknown';
    const received =
      errorMsg.match(/received[:\s]+([^\s,]+)/i)?.[1] ??
      errorMsg.match(/got[:\s]+([^\s,]+)/i)?.[1] ??
      'unknown';
    return {
      kind: 'mismatch',
      systemId,
      hostname,
      port,
      expectedFingerprint: expected,
      receivedFingerprint: received,
    };
  }

  const keyType = errorMsg.match(/key type[:\s]+([^\s,]+)/i)?.[1];
  const fingerprint = errorMsg.match(/fingerprint[:\s]+([^\s,]+)/i)?.[1] ?? 'unknown';
  return { kind: 'unknown', systemId, hostname, port, keyType, fingerprint };
}
