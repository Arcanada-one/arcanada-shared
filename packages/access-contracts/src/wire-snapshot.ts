/** Capture data descriptors once; never validate one value then return another. */
export function snapshotRecord(
  value: unknown,
  keys: readonly string[],
  exact = true,
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > keys.length || (exact && ownKeys.length !== keys.length))
    return null;
  const snapshot: Record<string, unknown> = {};
  for (const key of ownKeys) {
    if (typeof key !== "string" || !keys.includes(key)) return null;
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (
      property === undefined ||
      !property.enumerable ||
      !Object.hasOwn(property, "value")
    )
      return null;
    snapshot[key] = property.value;
  }
  return snapshot;
}

export function snapshotArray(
  value: unknown,
  min: number,
  max: number,
): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return null;
  const lengthProperty = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthProperty === undefined || !Object.hasOwn(lengthProperty, "value"))
    return null;
  const length: unknown = lengthProperty.value;
  if (
    !counter(length, min) ||
    length > max ||
    Reflect.ownKeys(value).length !== length + 1
  )
    return null;
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (item === undefined || !Object.hasOwn(item, "value") || !item.enumerable)
      return null;
    snapshot.push(item.value);
  }
  return snapshot;
}

export function counter(value: unknown, min = 0): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= min
  );
}
