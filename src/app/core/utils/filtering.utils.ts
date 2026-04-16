import { ContainerRuntime } from '../models/container.model';

export function applyRuntimeFilter<T extends { runtime: ContainerRuntime }>(
  items: T[],
  runtime: ContainerRuntime | null
): T[] {
  return runtime ? items.filter((i) => i.runtime === runtime) : items;
}

export function applySystemFilter<T extends { systemId: string }>(
  items: T[],
  systemId: string | null
): T[] {
  return systemId ? items.filter((i) => i.systemId === systemId) : items;
}

export function applySearchQuery<T>(
  items: T[],
  query: string,
  getFields: (item: T) => string[]
): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return items;
  return items.filter((i) => getFields(i).some((f) => f.toLowerCase().includes(q)));
}

export function sortByName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

export function sortByCreated<T>(
  a: T,
  b: T,
  getCreated: (item: T) => string | number | Date | null | undefined
): number {
  return new Date(getCreated(b) ?? 0).getTime() - new Date(getCreated(a) ?? 0).getTime();
}
