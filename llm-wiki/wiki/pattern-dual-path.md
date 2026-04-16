# Pattern: dual-path

**Summary**: Every resource service branches at call time between Tauri invoke (local) and HTTP (backend) based on per-system ownership. Not polymorphism, not strategy pattern — a simple `if/else` repeated because the alternative is worse.

**Sources**: `src/app/core/services/*.service.ts`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-overview]]
**Siblings**: [[pattern-signals-and-state]], [[pattern-three-database-pattern]]

---

## The pattern

```ts
const connId = this.backend.getBackendForSystem(systemId);
if (connId) {
  return this.backend.listContainersFor(connId, systemId);
}
return this.tauri.invoke<Container[]>('list_containers', { systemId });
```

Eight of the ~40 services use it; the rest are pure-local or pure-backend by nature. See [[dual-path-routing]] for the catalogue.

## Why not a common interface?

A strategy pattern would look like:

```ts
interface ContainerRpc {
  list(systemId: SystemId): Promise<Container[]>;
}

class TauriContainerRpc implements ContainerRpc { ... }
class HttpContainerRpc implements ContainerRpc { ... }

// at service construction
const rpc: ContainerRpc = ownership.isBackend(systemId) ? new HttpContainerRpc(...) : new TauriContainerRpc(...);
```

Three reasons the codebase rejects this:

1. **Ownership can change** (rarely, but it can — adding a system to a backend project retroactively). Caching the strategy at construction time would go stale.
2. **The adapter would leak** — HTTP-only endpoints (K8s, audit, port-tunnel URLs) have no Tauri counterpart. The interface would bloat with `Optional` methods until it dissolved into two separate interfaces.
3. **The branch is cheap and explicit**. A new engineer sees where the boundary is on the very first line of the method.

## When to reach for it

Anytime a method takes a `systemId`, talks to a system, and the same semantics exist on both sides. The pattern is *not* a substitute for real polymorphism — for example, `PortForwardService` does NOT use this pattern even though both paths exist; instead `commands/port_forward.rs` decides which backend to call based on whether the request has `tunnel_ws_url`. That's cleaner than a frontend branch because the decision belongs in Rust where both managers live.

## Idempotency

Both paths must produce equivalent state. Subtle breaks:
- Backend `listContainersFor` paginates; Tauri doesn't. Frontend code needs to know.
- Timestamp formats differ slightly (backend emits ISO8601 Z, Tauri emits with `+00:00`). Adapters normalize.
- Error shapes differ (backend returns `{error, suggestion, retryable}`, Tauri returns `ContainerError` serialized). `ErrorMappingService` normalizes.

## Testing the branch

Unit tests mock `BackendService.getBackendForSystem` to return `undefined` or a string. Both paths are then separately verified. Spec files for each dual-path service have a `// TAURI path` / `// BACKEND path` split by convention.

## Anti-pattern: leaking ownership check upward

Don't do this:

```ts
if (backend.isBackendSystem(systemId)) {
  showBackendUI();
} else {
  showTauriUI();
}
```

UI components should never inspect system ownership. If a capability requires a backend (like audit), hide it or disable it with a tooltip. If it's universal (containers, images), call the service and let *it* branch.

## Related pages

- [[dual-path-routing]]
- [[backend-service]]
- [[pattern-signals-and-state]]
