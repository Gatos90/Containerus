// jsdom ships `window.crypto.getRandomValues` but no `crypto.subtle`. Tests
// for container-ACL UUID-v5 derivation (CON-130) need SHA-1 via SubtleCrypto,
// so we splice node's webcrypto onto the global. Import this module for its
// side effect before importing anything that touches crypto.subtle.
// @ts-expect-error -- `node:crypto` has no types without @types/node, which
// we don't ship; this import only runs in the vitest test environment.
import { webcrypto as nodeWebCrypto } from 'node:crypto';

if (
  typeof globalThis.crypto === 'undefined' ||
  typeof (globalThis.crypto as any).subtle === 'undefined'
) {
  Object.defineProperty(globalThis, 'crypto', {
    value: nodeWebCrypto,
    configurable: true,
    writable: true,
  });
}
