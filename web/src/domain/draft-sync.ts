import { SIDES } from './types';
import type {
  ClientSnapshot,
  Draft,
  Role,
  RoleOverrides,
  Roster,
  Side,
} from './types';
import { ROLES, emptyDraft, validateDraft } from './draft-math';
import { assignTeamRoles, cleanRoleOverrides } from './draft-roles';

export function combineRoleHints(
  draft: Draft,
  manual: RoleOverrides,
  hints: Partial<RoleOverrides> = {},
) {
  const result = cleanRoleOverrides(draft, manual);
  for (const side of SIDES) {
    const used = new Set(Object.values(result[side]));
    const present = new Set(Object.values(draft[side]));
    for (const [id, role] of Object.entries(hints[side] ?? {})) {
      if (
        !present.has(+id) ||
        !ROLES.includes(role) ||
        result[side][Number(id)] ||
        used.has(role) ||
        (side === 'allies' && role === draft.role)
      )
        continue;
      result[side][Number(id)] = role;
      used.add(role);
    }
  }
  return result;
}

export function mergeClientSnapshot(
  current: Draft,
  snapshot: ClientSnapshot,
  champions: Roster,
  {
    overrides = {},
    newSession = false,
    roleOverride = null,
  }: {
    overrides?: Partial<RoleOverrides>;
    newSession?: boolean;
    roleOverride?: Role | null;
  } = {},
) {
  const role =
    roleOverride ??
    (snapshot.playerRole != null && ROLES.includes(snapshot.playerRole)
      ? snapshot.playerRole
      : current.role);
  const next = emptyDraft(role),
    seen = new Set(),
    hints: RoleOverrides = { allies: {}, enemies: {} },
    unknown: number[] = [];
  const teams: Record<Side, number[]> = { allies: [], enemies: [] };
  const own =
    snapshot.playerChampion != null && champions.has(snapshot.playerChampion)
      ? snapshot.playerChampion
      : null;
  if (own) seen.add(own);
  for (const side of SIDES)
    for (const pick of snapshot[side] ?? []) {
      if (!champions.has(pick.id)) {
        unknown.push(pick.id);
        continue;
      }
      if (
        seen.has(pick.id) ||
        teams[side].length >= (side === 'allies' ? 4 : 5)
      )
        continue;
      seen.add(pick.id);
      teams[side].push(pick.id);
      if (pick.role != null && ROLES.includes(pick.role) && side === 'allies')
        hints[side][pick.id] = pick.role;
    }
  // Make a valid temporary draft so cleanup can retain corrections by champion ID.
  for (const side of SIDES) {
    const slots = ROLES.filter((r) => !(side === 'allies' && r === role));
    teams[side].forEach((id, i) => {
      next[side][slots[i]] = id;
    });
  }
  const manual = cleanRoleOverrides(next, newSession ? {} : overrides),
    combined = combineRoleHints(next, manual, hints);
  for (const side of SIDES)
    next[side] = assignTeamRoles(teams[side], champions, {
      exclude: side === 'allies' ? [role] : [],
      overrides: combined[side],
      previous: newSession ? {} : current[side],
    }).slots;
  for (const id of snapshot.bans ?? []) {
    if (champions.has(id) && !seen.has(id)) {
      next.bans.push(id);
      seen.add(id);
    }
  }
  validateDraft(next);
  return {
    draft: next,
    overrides: manual,
    hints,
    ownChampion: own,
    unknown: [...new Set(unknown)],
  };
}
