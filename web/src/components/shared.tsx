import { useLayoutEffect, useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import type { Champion } from '../domain/types';

export const signed = (value: number) =>
  (value > 0 ? '+' : '') + value.toFixed(2);
export const tone = (value: number) =>
  value > 0.005 ? 'positive' : value < -0.005 ? 'negative' : 'zero';
export const norm = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');
export const portraitUrl = (champion: Champion) =>
  'assets/' + encodeURIComponent(champion.key) + '.png';

export function Portrait({
  champion,
  className = 'portrait',
}: {
  champion?: Champion;
  className?: string;
}) {
  return (
    champion && (
      <img
        className={className || undefined}
        src={portraitUrl(champion)}
        draggable={false}
        alt=""
      />
    )
  );
}

type DialogProps = Omit<ComponentProps<'dialog'>, 'open' | 'onClose'> & {
  open: boolean;
  close: () => void;
  focus?: string;
  children: ReactNode;
};

export function Dialog({
  open,
  close,
  focus,
  children,
  ...props
}: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdrop = useRef(false);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) {
      if (element.open) element.close();
      return;
    }
    if (!element.open) element.showModal();
    if (focus) element.querySelector<HTMLElement>(focus)?.focus();
  }, [open, focus]);

  function outside(event: {
    target: EventTarget;
    clientX: number;
    clientY: number;
  }) {
    const element = dialog.current;
    if (!element || event.target !== element) return false;
    const box = element.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  }

  return (
    <dialog
      {...props}
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        backdrop.current = outside(event);
      }}
      onPointerCancel={() => {
        backdrop.current = false;
      }}
      onClick={(event) => {
        const dismiss = backdrop.current && outside(event);
        backdrop.current = false;
        if (dismiss) close();
      }}
    >
      {children}
    </dialog>
  );
}
