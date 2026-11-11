import type { FocuserState } from "./parse.js";

export const DEFAULT_STEPS = 100;
const MAX_STEPS = 100_000;

/** Step size from a key's settings; falls back to the default if missing or silly. */
export function stepsFrom(settings: Record<string, unknown> | undefined): number {
	const v = settings?.steps;
	const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
	return Number.isInteger(n) && n >= 1 && n <= MAX_STEPS ? n : DEFAULT_STEPS;
}

/** Advanced API: GET /equipment/focuser/move?position=N (absolute position). */
export const movePath = (position: number) => `/equipment/focuser/move?position=${Math.round(position)}`;
/** Advanced API: GET /equipment/focuser/auto-focus[?cancel=true] (cancel only works for an AF started through the API). */
export const autoFocusPath = (cancel = false) => `/equipment/focuser/auto-focus${cancel ? "?cancel=true" : ""}`;

/** The absolute target for a nudge. "in" lowers the position (ASCOM: larger = further out); never below 0. */
export function targetPosition(current: number, dir: "in" | "out", steps: number): number {
	return Math.max(0, dir === "out" ? current + steps : current - steps);
}

/** After a move the focuser should be at the target; allow a little slack for backlash-style drivers. */
export const positionTolerance = (steps: number) => Math.max(2, Math.round(steps * 0.05));

export type FocusMovePlan = "unavailable" | "busy" | "move";

export function planFocusMove(f: FocuserState | undefined, afRunning: boolean): FocusMovePlan {
	if (!f?.connected || f.position === undefined) return "unavailable";
	if (afRunning || f.moving) return "busy";
	return "move";
}

export type AutoFocusPhase = "nofocuser" | "idle" | "running";
export const autoFocusPhase = (f: FocuserState | undefined, afRunning: boolean): AutoFocusPhase =>
	afRunning ? "running" : f?.connected ? "idle" : "nofocuser";
