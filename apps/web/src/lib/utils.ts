import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The design system draws Lucide icons at a heavier, rounder stroke. */
export const ICON_STROKE = 2.75;
