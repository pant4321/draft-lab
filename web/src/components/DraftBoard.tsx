import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ROLE_NAMES } from '../domain/draft-math';
import { ROLES, isRole } from '../domain/types';
import type { Champion, Role, Side } from '../domain/types';
import type { DragSource } from '../domain/draft-state';
import type { DraftLab } from '../useDraftLab';
import { Portrait } from './shared';

export type PickerTarget = { side: Side; role: Role } | { ban: true };
type DragPress = {
  pointer: number;
  source: DragSource;
  x: number;
  y: number;
  box: DOMRect;
};
type DragPreview = {
  press: DragPress;
  x: number;
  y: number;
  target: Role | null;
};

export function useBoardDrag(lab: DraftLab, onStart: () => void) {
  const press = useRef<DragPress | null>(null);
  const moving = useRef(false);
  const suppressClickUntil = useRef(0);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const {
    dispatch,
    pending,
    state: { draft },
  } = lab;

  useEffect(() => {
    function destination(x: number, y: number, source: DragSource) {
      const slot = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('[data-slot-side]');
      const role = slot?.dataset.slotRole;
      return slot?.dataset.slotSide === source.side &&
        isRole(role) &&
        (source.side !== 'allies' || role !== draft.role)
        ? role
        : null;
    }
    function finish(role: Role | null) {
      const current = press.current;
      if (!current) return;
      press.current = null;
      if (moving.current) suppressClickUntil.current = performance.now() + 250;
      moving.current = false;
      if (document.documentElement.hasPointerCapture(current.pointer)) {
        document.documentElement.releasePointerCapture(current.pointer);
      }
      document.body.classList.remove('is-dragging');
      setPreview(null);
      dispatch({ type: 'dragFinish', destination: role });
    }
    function move(event: PointerEvent) {
      const current = press.current;
      if (!current || current.pointer !== event.pointerId) return;
      if (!moving.current) {
        if (
          Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5
        )
          return;
        moving.current = true;
        document.documentElement.setPointerCapture(event.pointerId);
        document.body.classList.add('is-dragging');
      }
      event.preventDefault();
      setPreview({
        press: current,
        x: event.clientX,
        y: event.clientY,
        target: destination(event.clientX, event.clientY, current.source),
      });
    }
    function up(event: PointerEvent) {
      const current = press.current;
      if (!current || current.pointer !== event.pointerId) return;
      if (moving.current) event.preventDefault();
      finish(
        moving.current
          ? destination(event.clientX, event.clientY, current.source)
          : null,
      );
    }
    const cancel = () => finish(null);
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !press.current) return;
      event.preventDefault();
      suppressClickUntil.current = performance.now() + 250;
      cancel();
    }
    function click(event: MouseEvent) {
      if (event.detail > 0 && performance.now() < suppressClickUntil.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    function allowNewClick() {
      suppressClickUntil.current = 0;
    }
    if (pending) cancel();
    document.addEventListener('pointerdown', allowNewClick, true);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', escape);
    document.addEventListener('click', click, true);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('pointerdown', allowNewClick, true);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('click', click, true);
      window.removeEventListener('blur', cancel);
    };
  }, [dispatch, draft.role, pending]);

  return {
    preview,
    start(event: ReactPointerEvent<HTMLButtonElement>, source: DragSource) {
      if (
        pending ||
        event.button !== 0 ||
        event.pointerType !== 'mouse' ||
        press.current
      )
        return;
      const box = event.currentTarget.closest('.slot')!.getBoundingClientRect();
      press.current = {
        pointer: event.pointerId,
        source,
        x: event.clientX,
        y: event.clientY,
        box,
      };
      onStart();
      dispatch({ type: 'dragStart', source });
    },
  };
}

function SlotContent({
  role,
  champion,
  own = false,
  locked = false,
  marker,
  hint,
}: {
  role: Role;
  champion?: Champion;
  own?: boolean;
  locked?: boolean;
  marker?: string;
  hint?: string;
}) {
  return (
    <>
      {champion ? (
        <Portrait champion={champion} />
      ) : (
        <span className="placeholder">{own ? '◈' : '+'}</span>
      )}
      <span className="slot-text">
        <span className="slot-role">
          {ROLE_NAMES[role]}
          {marker && (
            <span
              className={
                'role-marker ' + (marker === 'SET' ? 'fixed' : 'uncertain')
              }
              title={marker === 'SET' ? 'Manual role correction' : hint}
            >
              {marker}
            </span>
          )}
          {own && (
            <span className="you-tag">
              {locked ? 'LOCKED' : champion ? 'PREVIEW' : 'YOU'}
            </span>
          )}
        </span>
        <span className="slot-name">
          {champion?.name ?? (own ? '' : 'Choose champion')}
        </span>
      </span>
    </>
  );
}

export function TeamBoard({
  lab,
  side,
  openPicker,
  drag,
}: {
  lab: DraftLab;
  side: Side;
  openPicker: (target: PickerTarget) => void;
  drag: ReturnType<typeof useBoardDrag>;
}) {
  const {
    state: {
      draft,
      roster,
      clientOwnChampion,
      roleOverrides,
      roleDetails,
      ignoredPicks,
      drag: active,
    },
    selected,
    pending,
    manual,
    dispatch,
  } = lab;
  const allied = side === 'allies';
  const team = allied ? 'allied' : 'enemy';
  return (
    <aside className={'team ' + side}>
      <div className="teamhead">
        <h2>{allied ? 'Your team' : 'Enemy team'}</h2>
        <span id={allied ? 'allied-count' : 'enemy-count'}>
          {Object.values(draft[side]).filter((id) => id !== null).length}{' '}
          revealed
        </span>
      </div>
      <div id={side} className="slots">
        {ROLES.map((role) => {
          const own = allied && role === draft.role;
          const id = own ? (clientOwnChampion ?? selected) : draft[side][role];
          const champion = id === null ? undefined : roster.get(id);
          const fixed = !own && id !== null && roleOverrides[side][id] === role;
          const guess = !own && id !== null ? roleDetails[side][id] : undefined;
          const uncertain =
            !fixed &&
            guess &&
            (guess.unsupported || guess.alternatives.length > 0);
          const ignored = !own && id !== null && ignoredPicks.includes(id);
          const hint = fixed
            ? 'Manual role. Auto guess roles will keep this correction.'
            : uncertain
              ? guess.unsupported
                ? 'Limited role data. Drag to correct.'
                : 'Could also be ' +
                  guess.alternatives
                    .map((position) => ROLE_NAMES[position])
                    .join(' or ') +
                  '. Drag to correct.'
              : 'Drag to move; drop on a champion to swap roles.';
          const grabbed = active?.side === side && active.role === role;
          const target =
            drag.preview?.press.source.side === side &&
            drag.preview.target === role;
          const content = (
            <SlotContent
              role={role}
              champion={champion}
              own={own}
              locked={clientOwnChampion !== null}
              marker={fixed ? 'SET' : uncertain ? '?' : undefined}
              hint={hint}
            />
          );
          const className = [
            'slot',
            own ? 'you' : !champion ? 'slot-empty' : '',
            ignored ? 'slot-ignored' : '',
            grabbed ? (drag.preview ? 'dragging' : 'grabbed') : '',
            target ? 'drop-target' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={role}
              className={className}
              data-slot-side={side}
              data-slot-role={role}
            >
              {own ? (
                <div
                  className="slot-main"
                  aria-label={`Your ${ROLE_NAMES[role]} pick preview`}
                >
                  {content}
                </div>
              ) : (
                <button
                  className="slot-main"
                  draggable={Boolean(champion)}
                  data-side={side}
                  data-role={role}
                  title={champion ? hint : ''}
                  aria-label={`Choose ${team} ${ROLE_NAMES[role]}`}
                  disabled={pending}
                  onClick={() => openPicker({ side, role })}
                  onDragStart={(event) => event.preventDefault()}
                  onPointerDown={(event) => {
                    if (id !== null) drag.start(event, { side, role, id });
                  }}
                >
                  {content}
                </button>
              )}
              {!own && champion && (
                <div className="slot-actions">
                  <button
                    type="button"
                    className="slot-clear"
                    data-clear={side}
                    data-role={role}
                    disabled={pending}
                    aria-label={`Remove ${champion.name} from ${team} ${ROLE_NAMES[role]}`}
                    onClick={() =>
                      manual({ type: 'pick', side, role, id: null })
                    }
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className="slot-ignore"
                    data-ignore-pick={champion.id}
                    disabled={pending}
                    aria-pressed={ignored}
                    aria-label={`Exclude ${champion.name} from calculations`}
                    title={
                      ignored
                        ? 'Include in calculations'
                        : 'Exclude from calculations'
                    }
                    onClick={() =>
                      dispatch({ type: 'ignore', id: champion.id })
                    }
                  >
                    ⊘
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function FloatingSlot({
  preview,
  roster,
}: {
  preview: DragPreview | null;
  roster: DraftLab['state']['roster'];
}) {
  if (!preview) return null;
  const {
    press: { source, box, x, y },
  } = preview;
  return createPortal(
    <div
      className="slot drag-preview"
      aria-hidden="true"
      inert
      style={{
        left: preview.x - x + box.left,
        top: preview.y - y + box.top,
        width: box.width,
        height: box.height,
      }}
    >
      <div className="slot-main">
        <SlotContent role={source.role} champion={roster.get(source.id)} />
      </div>
    </div>,
    document.body,
  );
}
