import { z } from "zod";

/**
 * User profile model (§51): the registry is device-global and holds the
 * minimum needed to list/switch users; every user-authored datum lives inside
 * the profile's storage namespace instead.
 */

export const userProfileSchema = z.object({
  id: z.string().min(1).max(64),
  displayName: z.string().min(1).max(40),
  avatar: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  lastActiveAt: z.number().int().nonnegative(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

export interface ProfilesSnapshot {
  profiles: UserProfile[];
  activeProfileId: string;
}

export const profilesSnapshotSchema = z.object({
  profiles: z.array(userProfileSchema).min(1),
  activeProfileId: z.string().min(1),
});

export function isValidProfileName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && Array.from(trimmed).length <= 40;
}
