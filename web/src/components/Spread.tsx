import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ROLE_NAMES } from '../domain/draft-math';
import { stackMatchups } from '../domain/matchup-spread';
import { PAIR_KINDS, ROLES } from '../domain/types';
import type { Champion, PairKind, Role, Roster } from '../domain/types';
import type { Blindability } from '../domain/blindability';
import { portraitUrl, signed } from './shared';

type Info = Blindability[number] | undefined;
type Trigger = { id: number; button: HTMLButtonElement };

function blindTitle(info: Info, role: Role) {
  return info?.score != null && info.counterLoss !== null
    ? `Counterpick safety: ${info.score}/100 among ${info.comparedWith} ${ROLE_NAMES[role].toLowerCase()} picks. ${info.counterLoss.toFixed(2)} pp weighted downside across five enemy roles. Negative matchup deltas are sample-adjusted and multiplied by opponent role pick-rate share. Rare picks count less. Base WR, positive bonuses, and ally synergy do not affect this score. Independent of draft edge.`
    : (info?.reason ?? 'Not enough comparable role data.');
}

export function MatchupChart({
  info,
  champion,
  roster,
  kind,
  role,
}: {
  info: Info;
  champion: Champion;
  roster: Roster;
  kind: PairKind;
  role: Role;
}) {
  const group = info?.groups.find(
    (group) => group.kind === kind && group.role === role,
  );
  if (!group?.resolved || !group.rows?.length)
    return (
      <p className="spread-unavailable">
        Not enough common matchup data for this role.
      </p>
    );
  const { points, width, left, right, top, size, bound, baseline, height } =
    stackMatchups(group.rows);
  const x = (value: number) =>
    left + ((value + bound) / (2 * bound)) * (right - left);
  const sigma = group.trueVariance > 0 ? Math.sqrt(group.trueVariance) : null;
  const peak = (baseline - top) * 0.56;
  const path = sigma
    ? Array.from({ length: 241 }, (_, index) => {
        const value = -bound + (2 * bound * index) / 240;
        const y =
          baseline -
          peak * Math.exp(-0.5 * ((value - group.mean) / sigma) ** 2);
        return `${index ? 'L' : 'M'}${x(value).toFixed(2)},${y.toFixed(2)}`;
      }).join(' ')
    : null;
  const label = `${champion.name} true spread ${sigma === null ? 'unresolved' : sigma.toFixed(1) + ' pp'}`;
  const badgeWidth = Math.min(width - 50, Math.max(180, label.length * 7 + 35));
  const gradient = `spread-field-${champion.id}-${kind}-${role}`;
  const ticks = Array.from(
    { length: Math.floor(bound / 2) * 2 + 1 },
    (_, index) => 2 * (index - Math.floor(bound / 2)),
  );
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${champion.name} ${kind === 'enemy' ? 'opponent' : 'teammate'} win-rate delta spread. ${points.length} champion icons. ${sigma === null ? 'True spread is unresolved.' : 'Estimated true spread ' + sigma.toFixed(2) + ' percentage points.'} Dashed line at minus 2 percentage points.`}
    >
      <defs>
        <linearGradient id={gradient}>
          <stop stopColor="#71333e" stopOpacity=".46" />
          <stop offset=".5" stopColor="#141b1d" />
          <stop offset="1" stopColor="#39634d" stopOpacity=".5" />
        </linearGradient>
      </defs>
      <rect
        x={left}
        y={top}
        width={right - left}
        height={baseline - top}
        fill={`url(#${gradient})`}
      />
      <line
        className="spread-zero"
        x1={x(0)}
        x2={x(0)}
        y1={top}
        y2={baseline}
      />
      <line
        className="spread-cutoff"
        x1={x(-2)}
        x2={x(-2)}
        y1={top}
        y2={baseline}
      />
      {path && <path className="spread-curve" d={path} />}
      <line
        className="spread-axis"
        x1={left}
        x2={right}
        y1={baseline}
        y2={baseline}
      />
      {ticks.map((value) => (
        <text key={value} x={x(value)} y={baseline + 20} textAnchor="middle">
          {value > 0 ? '+' : ''}
          {value}
        </text>
      ))}
      <text
        className="spread-axis-label"
        x={width / 2}
        y={height - 7}
        textAnchor="middle"
      >
        WR delta above expected · percentage points
      </text>
      {points.map((point) => {
        const other = roster.get(point.id);
        if (!other) return null;
        const px = point.cx - size / 2,
          py = baseline - size - 3 - point.level * (size + 3);
        return (
          <g
            key={point.id}
            className="spread-champion"
            data-spread-champion={point.id}
            data-delta={point.delta}
          >
            <title>
              {kind === 'enemy' ? 'vs' : 'with'} {other.name} ·{' '}
              {signed(point.delta)} pp · {point.n.toLocaleString('en-US')} games
            </title>
            <image
              href={portraitUrl(other)}
              x={px}
              y={py}
              width={size}
              height={size}
            />
            <rect x={px} y={py} width={size} height={size} rx="1" />
          </g>
        );
      })}
      <g className="spread-badge">
        <rect
          x={right - badgeWidth - 8}
          y={top + 9}
          width={badgeWidth}
          height="28"
          rx="2"
        />
        <image
          href={portraitUrl(champion)}
          x={right - badgeWidth}
          y={top + 14}
          width="18"
          height="18"
        />
        <text x={right - badgeWidth + 25} y={top + 28}>
          {label}
        </text>
      </g>
    </svg>
  );
}

export function useSpread(blind: Blindability, roster: Roster, role: Role) {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [group, setGroup] = useState<`${PairKind}:${Role}`>(`enemy:${role}`);
  const popup = useRef<HTMLElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const suppressed = useRef<HTMLButtonElement | null>(null);
  const focusSelect = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function cancelHide() {
    clearTimeout(timer.current);
  }
  function hide() {
    cancelHide();
    setTrigger(null);
  }
  function deferHide() {
    cancelHide();
    timer.current = setTimeout(hide, 160);
  }

  useEffect(() => {
    hide();
    return cancelHide;
  }, [role, blind]);
  useEffect(() => {
    if (!trigger) return;
    function outside(event: Event) {
      if (
        event.type === 'resize' ||
        (event.target instanceof Node &&
          !popup.current?.contains(event.target) &&
          !trigger?.button.contains(event.target))
      )
        hide();
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dismiss();
    }
    document.addEventListener('click', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('scroll', outside, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', outside);
    return () => {
      document.removeEventListener('click', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('scroll', outside, true);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', outside);
    };
  }, [trigger]);

  useLayoutEffect(() => {
    const element = popup.current;
    if (!trigger || !element) return;
    if (!trigger.button.isConnected) {
      hide();
      return;
    }
    const anchor = trigger.button.getBoundingClientRect(),
      box = element.getBoundingClientRect();
    const below = anchor.bottom + 10,
      above = anchor.top - box.height - 10;
    element.style.left =
      Math.max(
        8,
        Math.min(innerWidth - box.width - 8, anchor.right - box.width),
      ) + 'px';
    element.style.top =
      Math.max(
        8,
        Math.min(
          innerHeight - box.height - 8,
          below + box.height <= innerHeight - 8 ? below : above,
        ),
      ) + 'px';
    if (focusSelect.current) {
      focusSelect.current = false;
      select.current?.focus();
    }
  }, [trigger, group]);

  function dismiss() {
    if (trigger) {
      suppressed.current = trigger.button;
      trigger.button.focus({ preventScroll: true });
    }
    hide();
  }
  function open(id: number, button: HTMLButtonElement, keyboard = false) {
    cancelHide();
    if (trigger?.button === button) {
      if (keyboard) select.current?.focus();
      return;
    }
    focusSelect.current = keyboard;
    setGroup(`enemy:${role}`);
    setTrigger({ id, button });
  }

  const champion = trigger && roster.get(trigger.id);
  const info = trigger ? blind[trigger.id] : undefined;
  const [kind, groupRole] = group.split(':') as [PairKind, Role];
  return {
    hide,
    cell(id: number, source: 'ranking' | 'breakdown' = 'ranking') {
      const result = blind[id],
        score = result?.score;
      const scoreClass =
        score == null
          ? 'zero'
          : score >= 67
            ? 'blind-high'
            : score <= 33
              ? 'blind-low'
              : 'blind-mid';
      return (
        <button
          type="button"
          data-blind={id}
          data-blind-source={source}
          aria-haspopup="dialog"
          aria-controls="blindability-popover"
          aria-expanded={
            trigger?.id === id && trigger.button.dataset.blindSource === source
          }
          className={'blind-score ' + scoreClass}
          aria-label={`${roster.get(id)?.name ?? id} matchup WR delta spread. ${blindTitle(result, role)}`}
          onPointerEnter={(event) => {
            if (
              event.pointerType !== 'touch' &&
              suppressed.current !== event.currentTarget
            )
              open(id, event.currentTarget);
          }}
          onPointerLeave={(event) => {
            if (suppressed.current === event.currentTarget)
              suppressed.current = null;
            deferHide();
          }}
          onFocus={(event) => {
            if (suppressed.current !== event.currentTarget)
              open(id, event.currentTarget);
          }}
          onBlur={(event) => {
            if (suppressed.current === event.currentTarget)
              suppressed.current = null;
            if (
              !(event.relatedTarget instanceof Node) ||
              !popup.current?.contains(event.relatedTarget)
            )
              deferHide();
          }}
          onClick={(event) => {
            suppressed.current = null;
            open(id, event.currentTarget, event.detail === 0);
          }}
        >
          {score == null ? (
            '—'
          ) : (
            <>
              {score}
              <small>/100</small>
            </>
          )}
        </button>
      );
    },
    popup: (
      <section
        ref={popup}
        id="blindability-popover"
        className="spread-popover"
        role="dialog"
        aria-labelledby="spread-title"
        tabIndex={-1}
        hidden={!champion}
        onPointerEnter={cancelHide}
        onPointerLeave={deferHide}
        onFocus={cancelHide}
        onBlur={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            (!event.currentTarget.contains(event.relatedTarget) &&
              !trigger?.button.contains(event.relatedTarget))
          )
            deferHide();
        }}
        onPointerDown={(event) => {
          cancelHide();
          if (
            event.target instanceof Element &&
            !event.target.closest('button, input, select, textarea, a[href]')
          ) {
            event.preventDefault();
            popup.current?.focus({ preventScroll: true });
          }
        }}
      >
        {champion && (
          <>
            <div className="spread-head">
              <h2 id="spread-title">
                {champion.name} <span>· {ROLE_NAMES[role]}</span>
              </h2>
              <div className="spread-actions">
                <select
                  ref={select}
                  id="spread-group"
                  aria-label="Spread matchup group"
                  value={group}
                  onChange={(event) =>
                    setGroup(event.currentTarget.value as typeof group)
                  }
                >
                  {PAIR_KINDS.flatMap((kind) =>
                    ROLES.filter(
                      (position) => kind === 'enemy' || position !== role,
                    ).map((position) => (
                      <option
                        key={kind + position}
                        value={kind + ':' + position}
                      >
                        {kind === 'enemy' ? 'vs' : 'with'}{' '}
                        {ROLE_NAMES[position]}
                      </option>
                    )),
                  )}
                </select>
                <button
                  type="button"
                  className="spread-close"
                  aria-label="Close spread graph"
                  onClick={dismiss}
                >
                  ×
                </button>
              </div>
            </div>
            <p className="spread-rating" title={blindTitle(info, role)}>
              {info?.counterLoss != null
                ? info.counterLoss.toFixed(2) + ' pp weighted downside'
                : 'Downside unavailable'}
              <span>Spread visual only</span>
            </p>
            <div id="spread-chart">
              <MatchupChart
                info={info}
                champion={champion}
                roster={roster}
                kind={kind}
                role={groupRole}
              />
            </div>
          </>
        )}
      </section>
    ),
  };
}
