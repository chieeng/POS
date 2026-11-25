import { useState, type PointerEvent } from 'react';
import type { StatusTone } from '@/components/ui/status-badge';
import { formatPeso } from '@/lib/money';
import { DAY_TYPE_LABELS, flagText, timeText } from './clock';
import { flatDeduction, outText, type PersonDay } from './report';

/**
 * One day as a row (cleanup round 1, SRS 7.2; the owner, Nov 23-24, 2026): at most ONE
 * coloured tag, then "+N" for the rest, which opens on a tap (and on hover with a mouse).
 * Tag order is money, then red, then amber. A money tag (the late deduction) and a red tag
 * (no time out, absent) are never folded into "+N"; overtime and "changed by the Owner" are
 * details only. The day's kind ("Whole day", "Rest day") is plain text, not a tag.
 */

type Day = Pick<PersonDay, 'state' | 'row'>;

interface Tag {
  text: string;
  tone: StatusTone;
}

export interface DayParts {
  /** Shown as tags: every money and red one, else the first amber one. */
  tags: Tag[];
  /** Behind "+N", one line each. */
  more: string[];
}

const FLAGGED = 'Flagged';

export function dayParts({ state, row }: Day): DayParts {
  const keep: Tag[] = [];
  const amber: Tag[] = [];
  const details: string[] = [];
  const worked = row?.kind === 'worked' ? row : null;

  if (worked && worked.lateMinutes > 0) {
    // Today's deduction shows while the person is still in (the owner, Nov 23, 2026: "show the
    // late-deduction amount on the row"); a day with no time out counts for nothing, so none.
    const deduction =
      state === 'in' && worked.lateRule === 'flat' ? worked.lateFlat : flatDeduction(row);
    if (deduction > 0) {
      // Money first, and the amount is never hidden (SRS 7.2).
      keep.push({
        text: `Late ${worked.lateMinutes} min · −${formatPeso(deduction)}`,
        tone: 'warn',
      });
    } else {
      amber.push({ text: `Late ${worked.lateMinutes} min`, tone: 'warn' });
    }
  }
  if (state === 'no_out') keep.push({ text: 'No time out', tone: 'danger' });
  if (state === 'absent') keep.push({ text: 'Absent', tone: 'danger' });

  if (worked && worked.earlyMinutes > 0) {
    amber.push({ text: `Early out ${worked.earlyMinutes} min`, tone: 'warn' });
  }
  const flags = worked?.flags.filter((flag) => flag !== 'edited') ?? [];
  // "Flagged" is the one word for a day to look at; the reasons are the details.
  if (flags.length > 0) amber.push({ text: FLAGGED, tone: 'warn' });

  if (worked && worked.overtimeMinutes > 0) details.push(`Overtime ${worked.overtimeMinutes} min`);
  if (worked) for (const flag of flags) details.push(flagText(flag, worked));
  if (worked?.flags.includes('edited')) {
    details.push(row?.note ? `Changed by the Owner: “${row.note}”` : 'Changed by the Owner');
  } else if (row?.note) {
    details.push(`Reason: “${row.note}”`);
  }

  const tags = keep.length > 0 ? keep : amber.slice(0, 1);
  const folded = amber.filter((tag) => !tags.includes(tag) && tag.text !== FLAGGED);
  return { tags, more: [...folded.map((tag) => tag.text), ...details] };
}

/** The row's words: the times (or what the day is), and the kind of day under it. */
export function dayText({ state, row }: Day): { title: string; sub: string | null } {
  const times =
    row?.kind === 'worked' && row.inAt
      ? `${timeText(row.inAt)} – ${row.outAt ? outText(row) : state === 'in' ? '…' : '?'}`
      : null;
  switch (state) {
    case 'done':
      return {
        title: times ?? 'Clocked out',
        sub: row?.dayType ? DAY_TYPE_LABELS[row.dayType] : null,
      };
    case 'in':
      return { title: times ?? 'In', sub: 'Working' };
    case 'no_out':
      return { title: times ?? 'No time out', sub: null };
    // Two kinds, told apart (the owner, Nov 24, 2026).
    case 'absent':
      return {
        title: 'Absent',
        sub: row?.kind === 'absent' ? 'Marked by the Owner' : 'No time in',
      };
    case 'rest':
      return { title: 'Rest day', sub: null };
    case 'not_in':
      return { title: 'Not in yet', sub: null };
    case 'none':
      return { title: 'No record', sub: null };
  }
}

/** "+N" stays open after a tap, and is open while a mouse is over the row. */
export function useMore() {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const fromMouse = (event: PointerEvent) => event.pointerType === 'mouse';
  return {
    open: pinned || hover,
    // A click while the mouse already opened it keeps it open; a second click closes it.
    toggle: () => {
      if (pinned) setHover(false);
      setPinned(!pinned);
    },
    rowProps: {
      onPointerEnter: (event: PointerEvent) => {
        if (fromMouse(event)) setHover(true);
      },
      onPointerLeave: (event: PointerEvent) => {
        if (fromMouse(event)) setHover(false);
      },
    },
  };
}
