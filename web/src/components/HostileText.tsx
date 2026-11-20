import { useState, type ReactNode } from 'react';
import { copy } from '../content/copy';

// Attacker-supplied text. Rendered only as React text nodes (never as HTML or Markdown),
// with invisible and direction-changing characters made visible so they can't hide or
// reorder what the reader sees.
const SNEAKY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜ᅟᅠ᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿￹-￻]/g;


function reveal(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(SNEAKY)) {
    const i = m.index ?? 0;
    if (i > last) out.push(s.slice(last, i));
    const code = m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
    out.push(
      <span key={i} className="sneaky" title={copy.hostile.hiddenChar}>
        U+{code}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function HostileText({ text, label, limit = 1200, lines }: { text: string; label?: string; limit?: number; lines?: 2 | 3 }) {
  const [open, setOpen] = useState(false);
  // With `lines`, CSS clamps the text and there is no expand button.
  const long = !lines && text.length > limit;
  const shown = lines ? text.slice(0, 600) : long && !open ? text.slice(0, limit) : text;
  return (
    <div className="hostile">
      {label && <div className="hostile-label">{label}</div>}
      <p className={lines ? `hostile-body clamp-${lines}` : 'hostile-body'} dir="ltr">
        {reveal(shown)}
        {long && !open && '…'}
      </p>
      {long && (
        <button type="button" className="linkish" onClick={() => setOpen(!open)}>
          {open ? copy.hostile.showLess : copy.hostile.showAll(text.length)}
        </button>
      )}
    </div>
  );
}
