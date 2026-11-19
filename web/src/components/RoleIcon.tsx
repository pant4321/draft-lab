import type { Role } from '../domain/types';

const icons = {
  top: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 4h16v16H4z" opacity=".35" fill="none" stroke="currentColor" />
      <path d="M4 4h16l-5 5H9v6l-5 5z" />
    </svg>
  ),
  jungle: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M11 21C5 17 4 11 3 4c5 3 7 8 8 12V3c5 5 7 11 3 18h-3Zm5-2c2-6 3-9 6-12-1 6-2 10-6 12Z" />
    </svg>
  ),
  middle: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 4h16v16H4z" opacity=".35" fill="none" stroke="currentColor" />
      <path d="m4 16 12-12h4v4L8 20H4z" />
    </svg>
  ),
  bottom: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 4h16v16H4z" opacity=".35" fill="none" stroke="currentColor" />
      <path d="M20 20H4l5-5h6V9l5-5z" />
    </svg>
  ),
  support: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m12 3 4 6-4 4-4-4 4-6ZM2 7l6 4 2 6-5-3-3-7Zm20 0-6 4-2 6 5-3 3-7ZM12 15l3 6H9l3-6Z" />
    </svg>
  ),
};

export function RoleIcon({ role }: { role: Role }) {
  return icons[role];
}
