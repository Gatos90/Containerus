# Pattern: signals-and-state

**Summary**: A recurring architectural pattern in the frontend — wrap raw data in `signal()`, expose `asReadonly()` to components, compose derivations with `computed()`, and funnel mutations through typed methods. No NgRx, no RxJS in state classes.

**Sources**: `src/app/state/*.ts`, broadly.

**Last updated**: 2026-04-16

**Parent**: [[frontend-overview]]
**Siblings**: [[pattern-dual-path]], [[pattern-three-database-pattern]]

---

## Why this pattern wins here

Containerus is a signal-native Angular 21 app. The data model is small enough (a few hundred entities at most) that NgRx's ceremony would dwarf the benefit, and large enough that ad-hoc `BehaviorSubject`s would create coordination overhead.

Signals fit because:

- **Computed derivations** (filtered lists, stats, grouping) naturally express as `computed(...)` — no explicit subscribe bookkeeping.
- **Change detection is implicit** — components that read a signal re-render when it changes; no `ChangeDetectorRef.markForCheck`.
- **Type inference** carries through `asReadonly()` and `computed()`.
- **OnPush everywhere** — components declare `changeDetection: ChangeDetectionStrategy.OnPush` and signals are what re-trigger them.

## Canonical shape

```ts
@Injectable({ providedIn: 'root' })
export class ContainerState {
  private readonly _containers = signal<Container[]>([]);
  private readonly _loading = signal<Map<SystemId, boolean>>(new Map());
  private readonly _statusFilter = signal<ContainerStatus | 'all'>('all');
  private readonly _searchQuery = signal<string>('');

  // readonly projections
  readonly containers = this._containers.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly statusFilter = this._statusFilter.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();

  // derivations
  readonly filteredContainers = computed(() => {
    const list = this._containers();
    const status = this._statusFilter();
    const q = this._searchQuery().toLowerCase();
    return list.filter(c =>
      (status === 'all' || c.status === status) &&
      (!q || c.name.toLowerCase().includes(q))
    );
  });

  readonly stats = computed(() => ({
    total: this._containers().length,
    running: this._containers().filter(c => c.is_running()).length,
    stopped: this._containers().filter(c => !c.is_running()).length,
  }));

  // mutations as typed methods
  setContainers(list: Container[]) { this._containers.set(list); }
  setStatusFilter(s: ContainerStatus | 'all') { this._statusFilter.set(s); }
  setLoading(id: SystemId, v: boolean) {
    const m = new Map(this._loading()); m.set(id, v); this._loading.set(m);
  }
}
```

## The rules

1. **No raw signals exposed** — components see `asReadonly()`. Direct writes are caller's responsibility.
2. **Mutations are methods** — named with intent (`setContainers`, not `_containers.set(...)` everywhere).
3. **Derivations live in the state class** — not in components.
4. **Map updates are immutable** — create a new `Map(oldMap)` before setting. Mutating in place doesn't notify signal consumers.
5. **Signals never depend on side effects** — `effect()` is used sparingly (toast side effects, localStorage write-through), never inside `computed()`.

## Pattern variants

### Composition across states

Downstream states inject upstream ones and derive:

```ts
export class ComposeState {
  constructor(private containers: ContainerState) {}

  readonly projects = computed<ComposeProject[]>(() => {
    const byProject = new Map<string, Container[]>();
    for (const c of this.containers.containers()) { ... }
    return aggregate(byProject);
  });
}
```

### Map of signals vs signal of Map

For hot collections keyed by id, the codebase prefers **signal of Map** rather than **Map of signals**. One signal per Map fires once per update; the other fires N times for N changes. Both correct; the Map-of-signals pattern risks update storms.

### Pagination and infinite lists

Stored as `Vec<T>` plus `hasMore: boolean` plus `nextCursor: string | null`. `append` vs `replace` methods.

## Comparison to NgRx

| | NgRx | Signals |
|---|---|---|
| State update | dispatch action + reducer | method call + signal set |
| Derivation | selector memoization | computed |
| Async | effects | service + signal write |
| DevTools | redux devtools | none natively |
| Ceremony | high | low |
| Best for | very large apps with many contributors | small to medium |

Containerus is "medium" — signals win. A future evolution could re-introduce NgRx for one specific high-contention slice (e.g. project memberships across many backends) without rewriting the rest.

## Related pages

- [[frontend-overview]]
- [[angular-state]]
- [[pattern-dual-path]]
