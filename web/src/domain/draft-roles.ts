import { SIDES, byRole, isRole, isRecord } from './types';
import type {
  Draft,
  Role,
  RoleDetails,
  RoleOverrides,
  Roster,
  Side,
  Slots,
} from './types';
import { ROLES, validateDraft } from './draft-math';

// At most five champions: enumerate all one-to-one assignments instead of guessing greedily.
export function assignTeamRoles(
  ids: number[],
  champions: Roster,
  {
    exclude = [],
    overrides = {},
    previous = {},
  }: {
    exclude?: readonly Role[];
    overrides?: Record<number, Role>;
    previous?: Partial<Slots>;
  } = {},
) {
  const available = ROLES.filter((r) => !exclude.includes(r)),
    ordered = [...ids].sort((a, b) => a - b);
  if (new Set(ids).size !== ids.length || ids.length > available.length)
    throw Error('Invalid team size or duplicate champion.');
  const pinned = new Map<number, Role>(),
    used = new Set<Role>();
  for (const id of ordered) {
    if (!champions.has(id)) throw Error('Unknown champion.');
    const role = overrides[id];
    if (role == null) continue;
    if (!available.includes(role) || used.has(role))
      throw Error('Conflicting role corrections.');
    pinned.set(id, role);
    used.add(role);
  }
  const solutions: {
    slots: Partial<Slots>;
    score: number;
    retained: number;
  }[] = [];
  function visit(index: number, slots: Partial<Slots>, score: number) {
    if (index === ordered.length) {
      const retained = ROLES.reduce(
        (n, r) => n + (slots[r] != null && slots[r] === previous[r] ? 1 : 0),
        0,
      );
      solutions.push({ slots: { ...slots }, score, retained });
      return;
    }
    const id = ordered[index],
      champ = champions.get(id)!;
    const total = ROLES.reduce(
      (sum, r) => sum + Math.max(1, champ.roles[r]?.games ?? 0),
      0,
    );
    for (const role of available) {
      if (
        slots[role] != null ||
        (pinned.has(id) && pinned.get(id) !== role) ||
        (!pinned.has(id) && used.has(role))
      )
        continue;
      slots[role] = id;
      visit(
        index + 1,
        slots,
        score + Math.log(Math.max(1, champ.roles[role]?.games ?? 0) / total),
      );
      delete slots[role];
    }
  }
  visit(0, {}, 0);
  solutions.sort((a, b) =>
    Math.abs(b.score - a.score) > 1e-10
      ? b.score - a.score
      : b.retained - a.retained,
  );
  const best = solutions[0];
  if (!best) throw Error('No valid role assignment.');
  const slots = byRole((role) => best.slots[role] ?? null),
    details: RoleDetails[Side] = {};
  for (const role of ROLES) {
    const id = slots[role];
    if (id == null) continue;
    const alternatives = ROLES.filter(
      (other) =>
        other !== role &&
        solutions.some(
          (s) =>
            best.score - s.score <= Math.log(2) + 1e-10 &&
            s.slots[other] === id,
        ),
    );
    details[id] = {
      role,
      manual: pinned.has(id),
      alternatives,
      unsupported: !champions.get(id)!.roles[role],
    };
  }
  return { slots, details };
}

export function cleanRoleOverrides(
  draft: Draft,
  overrides: unknown = {},
): RoleOverrides {
  const result: RoleOverrides = { allies: {}, enemies: {} };
  if (!isRecord(overrides)) return result;
  for (const side of SIDES) {
    const present = new Set(Object.values(draft[side])),
      used = new Set();
    const values = overrides[side];
    if (!isRecord(values)) continue;
    for (const [id, role] of Object.entries(values)) {
      if (
        !present.has(+id) ||
        !isRole(role) ||
        (side === 'allies' && role === draft.role) ||
        used.has(role)
      )
        continue;
      used.add(role);
      result[side][Number(id)] = role;
    }
  }
  return result;
}

export function inferDraftRoles(
  draft: Draft,
  champions: Roster,
  overrides: Partial<RoleOverrides> = {},
) {
  validateDraft(draft);
  const next = structuredClone(draft),
    details: RoleDetails = { allies: {}, enemies: {} };
  for (const side of SIDES) {
    const result = assignTeamRoles(
      Object.values(draft[side]).filter((id) => id != null),
      champions,
      {
        exclude: side === 'allies' ? [draft.role] : [],
        overrides: overrides[side] ?? {},
        previous: draft[side],
      },
    );
    next[side] = result.slots;
    details[side] = result.details;
  }
  validateDraft(next);
  return { draft: next, details };
}

export function moveDraftChampion(
  draft: Draft,
  side: Side,
  from: Role,
  to: Role,
  overrides: Partial<RoleOverrides> = {},
) {
  validateDraft(draft);
  if (
    !['allies', 'enemies'].includes(side) ||
    !ROLES.includes(from) ||
    !ROLES.includes(to)
  )
    throw Error('Invalid role move.');
  if (side === 'allies' && (from === draft.role || to === draft.role))
    throw Error('Your role stays open for recommendations.');
  const id = draft[side][from];
  if (id == null) throw Error('Choose a champion to move.');
  const next = structuredClone(draft),
    pins = structuredClone(overrides);
  pins[side] ??= {};
  const displaced = next[side][to];
  next[side][to] = id;
  next[side][from] = displaced;
  pins[side][id] = to;
  if (displaced != null) pins[side][displaced] = from;
  validateDraft(next);
  return { draft: next, overrides: cleanRoleOverrides(next, pins) };
}

export function selectDraftRole(
  draft: Draft,
  role: Role,
  {
    preview = null,
    overrides = {},
  }: { preview?: number | null; overrides?: Partial<RoleOverrides> } = {},
) {
  validateDraft(draft);
  if (!ROLES.includes(role)) throw Error('Choose a valid role.');
  if (
    preview != null &&
    (!Number.isInteger(preview) ||
      preview <= 0 ||
      [
        ...Object.values(draft.allies),
        ...Object.values(draft.enemies),
        ...(draft.bans ?? []),
      ].includes(preview))
  )
    throw Error('Invalid champion preview.');
  if (role === draft.role)
    return {
      draft: structuredClone(draft),
      selected: preview,
      overrides: cleanRoleOverrides(draft, overrides),
    };
  const next = structuredClone(draft),
    from = draft.role,
    inherited = next.allies[role];
  next.allies[role] = null;
  next.allies[from] = preview;
  next.role = role;
  const pins = cleanRoleOverrides(next, overrides);
  if (preview != null) {
    for (const [id, pinnedRole] of Object.entries(pins.allies))
      if (pinnedRole === from) delete pins.allies[Number(id)];
    pins.allies[preview] = from;
  }
  validateDraft(next);
  return { draft: next, selected: inherited, overrides: pins };
}
