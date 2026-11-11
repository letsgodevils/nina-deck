import type { FlatState } from "./parse.js";

export const DEFAULT_BRIGHTNESS = 50;

/** Brightness preset from a key's settings (whole percent 0-100); falls back to the default if missing or silly. */
export function brightnessFrom(settings: Record<string, unknown> | undefined): number {
	const v = settings?.brightness;
	const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
	return Number.isInteger(n) && n >= 0 && n <= 100 ? n : DEFAULT_BRIGHTNESS;
}

/** Advanced API: GET /equipment/flatdevice/set-light?on=true|false */
export const lightPath = (on: boolean) => `/equipment/flatdevice/set-light?on=${on}`;
/** Advanced API: GET /equipment/flatdevice/set-cover?closed=true|false */
export const coverPath = (closed: boolean) => `/equipment/flatdevice/set-cover?closed=${closed}`;
/** Advanced API: GET /equipment/flatdevice/set-brightness?brightness=0..100 */
export const brightnessPath = (n: number) => `/equipment/flatdevice/set-brightness?brightness=${Math.round(n)}`;

export type CoverKind = "open" | "closed" | "moving" | "error" | "unknown";

export function coverKind(f: FlatState | undefined): CoverKind {
	switch ((f?.coverState ?? "").toLowerCase()) {
		case "open":
			return "open";
		case "closed":
			return "closed";
		case "neitheropennorclosed":
			return "moving";
		case "error":
			return "error";
		default:
			return "unknown";
	}
}

export type LightPlan = "unavailable" | "on" | "off" | "refused";

/** Turning the light on while the camera exposes would flood the frame, so that is refused; turning it off is always fine. */
export function planLight(f: FlatState | undefined, exposing: boolean): LightPlan {
	if (!f?.connected || !f.supportsOnOff) return "unavailable";
	if (f.lightOn) return "off";
	return exposing ? "refused" : "on";
}

export type CoverPlan = "unavailable" | "open" | "close" | "refused";

/** Moving the cover is mechanical (hold 1 s) and is refused while the camera is exposing. */
export function planCover(f: FlatState | undefined, exposing: boolean): CoverPlan {
	if (!f?.connected || !f.supportsOpenClose) return "unavailable";
	const k = coverKind(f);
	if (k === "moving") return "unavailable";
	if (exposing) return "refused";
	return k === "open" ? "close" : "open"; // closed or unknown -> open
}

export type BrightnessPlan = "unavailable" | "set" | "refused";

/** Changing brightness is harmless with the light off; with it on, it would change a running exposure. */
export function planBrightness(f: FlatState | undefined, exposing: boolean): BrightnessPlan {
	if (!f?.connected) return "unavailable";
	return f.lightOn && exposing ? "refused" : "set";
}
