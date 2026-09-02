import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class merge helper for the ui primitive layer (shadcn convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
