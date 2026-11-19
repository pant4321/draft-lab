import { SIDES, byRole, isRecord } from './types';
import type { Multipliers } from './types';
import { ROLES, MAX_ROLE_MULTIPLIER } from './draft-math';
export const WEIGHTS_STORAGE = 'draftlab-role-multipliers-v1';
export function defaultMultipliers(): Multipliers {
  return { allies: byRole(() => 1), enemies: byRole(() => 1) };
}
export function cleanMultipliers(value: unknown) {
  const result = defaultMultipliers();
  for (const side of SIDES)
    for (const role of ROLES) {
      const roles = isRecord(value) ? value[side] : null;
      const weight = isRecord(roles) ? roles[role] : null;
      if (
        typeof weight === 'number' &&
        Number.isFinite(weight) &&
        weight >= 0 &&
        weight <= MAX_ROLE_MULTIPLIER
      )
        result[side][role] = weight;
    }
  return result;
}
export function loadMultipliers(storage: Storage) {
  try {
    return cleanMultipliers(
      JSON.parse(storage.getItem(WEIGHTS_STORAGE) ?? 'null'),
    );
  } catch {
    return defaultMultipliers();
  }
}
export function saveMultipliers(storage: Storage, value: Multipliers) {
  try {
    storage.setItem(WEIGHTS_STORAGE, JSON.stringify(cleanMultipliers(value)));
    return true;
  } catch {
    return false;
  }
}
export function customMultipliers(value: Multipliers) {
  return SIDES.some((side) => ROLES.some((role) => value[side][role] !== 1));
}
