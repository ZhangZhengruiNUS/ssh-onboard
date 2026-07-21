export function omitProperties<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  const blocked = new Set<PropertyKey>(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.has(key))) as Omit<
    T,
    K
  >;
}
