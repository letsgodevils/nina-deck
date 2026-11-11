import type { CameraState } from "./parse.js";

export const DEFAULT_TARGET_C = -10;

/** Target temperature from a key's settings; falls back to the default if missing or silly. */
export function targetTempFrom(settings: Record<string, unknown> | undefined): number {
	const v = settings?.targetTemp;
	const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
	return Number.isFinite(n) && n >= -60 && n <= 40 ? n : DEFAULT_TARGET_C;
}

/** Advanced API: GET /equipment/camera/cool?temperature=..&minutes=..  (minutes=-1 means N.I.N.A.'s default duration). */
export const coolPath = (targetC: number) => `/equipment/camera/cool?temperature=${targetC}&minutes=-1`;
/** Advanced API: GET /equipment/camera/warm?minutes=..&cancel=..  (gradual warm-up, so the sensor is not thermally shocked). */
export const warmPath = (cancel = false) => `/equipment/camera/warm?minutes=-1${cancel ? "&cancel=true" : ""}`;

export type CoolerPhase = "nocam" | "nocooler" | "off" | "cooling" | "cooled" | "warming";

/** `warming` is tracked locally by the key: the API has no "warming in progress" flag. */
export function coolerPhase(cam: CameraState | undefined, warming: boolean): CoolerPhase {
	if (!cam?.connected) return "nocam";
	if (!cam.canSetTemperature) return "nocooler";
	if (warming && cam.coolerOn) return "warming";
	if (!cam.coolerOn) return "off";
	return cam.atTargetTemp ? "cooled" : "cooling";
}

export type CoolerPlan = "unavailable" | "cool" | "warm" | "cancel-warm";

/** What a press means in each phase. Turning the cooler OFF (warm) and cancelling both need a 1 s hold. */
export function planCooler(phase: CoolerPhase): CoolerPlan {
	switch (phase) {
		case "off":
			return "cool";
		case "cooling":
		case "cooled":
			return "warm";
		case "warming":
			return "cancel-warm";
		default:
			return "unavailable";
	}
}
