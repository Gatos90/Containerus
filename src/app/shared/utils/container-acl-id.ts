/**
 * Deterministic UUID-v5 derivation for `resource_acls.resource_id` on
 * container-scoped rows. Must match the server-side
 * `container_acl_resource_id(system_id, runtime_id)` in
 * `crates/containerus-server/src/auth/middleware.rs` — CON-117 stores the
 * dedicated namespace constant once and MUST NOT change it without a
 * data migration.
 *
 * Inputs:
 *  - `systemId`: UUID of the parent system (resource_acls.system_id FK).
 *  - `containerRuntimeId`: opaque Docker/Podman container id.
 *
 * Returns the canonical UUID string to send as `resourceId` when creating a
 * container-scoped ACL. The middleware derives the same value by hashing
 * (system_id, runtime_id) under CONTAINER_ACL_NAMESPACE; the two paths must
 * be byte-identical or the ACL silently misses at enforcement time.
 */

// Hex-form of 0x7f6e5d4c_3b2a_4918_8a7b_6c5d4e3f2a1b from middleware.rs.
const CONTAINER_ACL_NAMESPACE = '7f6e5d4c-3b2a-4918-8a7b-6c5d4e3f2a1b';

export async function containerAclResourceId(
  systemId: string,
  containerRuntimeId: string,
): Promise<string> {
  const perSystemNs = await uuidV5(CONTAINER_ACL_NAMESPACE, uuidToBytes(systemId));
  return uuidV5(perSystemNs, new TextEncoder().encode(containerRuntimeId));
}

/**
 * RFC 4122 §4.3 UUID-v5 over SHA-1. Uses SubtleCrypto so the digest stays
 * identical to the Rust crate's implementation — both hash (namespace ||
 * name) and apply the v5 bit-masking on octets 6 and 8.
 */
async function uuidV5(namespace: string, nameBytes: Uint8Array): Promise<string> {
  const nsBytes = uuidToBytes(namespace);
  const buf = new Uint8Array(nsBytes.length + nameBytes.length);
  buf.set(nsBytes, 0);
  buf.set(nameBytes, nsBytes.length);

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  const out = digest.slice(0, 16);
  // v5: set version (top nibble of byte 6) and RFC 4122 variant (top two bits
  // of byte 8). Without these masks the value is a plain SHA-1 prefix.
  out[6] = (out[6] & 0x0f) | 0x50;
  out[8] = (out[8] & 0x3f) | 0x80;
  return bytesToUuid(out);
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
