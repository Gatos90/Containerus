import '@angular/compiler';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

setupTestBed();

// jsdom ships `window.crypto.getRandomValues` but no `crypto.subtle`. Tests
// for container-ACL UUID-v5 derivation (CON-130) need SHA-1 via SubtleCrypto,
// so we splice node's webcrypto onto the global. Browsers already have it;
// this only runs under the jsdom test environment. We use defineProperty
// because jsdom's `crypto` is exposed via a non-writable getter.
import './app/shared/utils/__testing__/webcrypto-polyfill';
