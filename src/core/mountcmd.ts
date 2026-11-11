import type { MountState } from "./parse.js";

/** Advanced API mount endpoints (names from the docs' endpoint list; called without parameters). */
export const MOUNT_PATHS = {
	home: "/equipment/mount/home",
	park: "/equipment/mount/park",
	unpark: "/equipment/mount/unpark",
} as const;

export type ParkPlan = "unavailable" | "park" | "unpark";

/** Parked -> a tap unparks. Unparked -> parking needs a 1 s hold because it moves the mount. */
export function parkPlan(m: MountState | undefined): ParkPlan {
	if (!m?.connected) return "unavailable";
	if (m.atPark) return "unpark";
	return m.canPark ? "park" : "unavailable";
}

export type HomePlan = "unavailable" | "parked" | "home";

/** Finding home needs an unparked mount that supports it. */
export function homePlan(m: MountState | undefined): HomePlan {
	if (!m?.connected || !m.canFindHome) return "unavailable";
	return m.atPark ? "parked" : "home";
}
