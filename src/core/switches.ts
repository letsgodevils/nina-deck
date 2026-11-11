import type { SwitchItem, SwitchState } from "./parse.js";

/** Advanced API: GET /equipment/switch/set?index=N&value=V */
export const switchPath = (id: number, value: number) => `/equipment/switch/set?index=${id}&value=${value}`;

export interface SwitchSettings {
	switchId?: number;
	setValue?: number;
}

export function settingsFrom(raw: Record<string, unknown> | undefined): SwitchSettings {
	const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
	const id = n(raw?.switchId);
	return { switchId: id !== undefined && Number.isInteger(id) ? id : undefined, setValue: n(raw?.setValue) };
}

export const findSwitch = (st: SwitchState | undefined, id: number | undefined): SwitchItem | undefined => (id === undefined ? undefined : st?.switches.find((w) => w.id === id));

/** An on/off switch: it only has two positions (minimum and maximum one step apart, typically 0 and 1). */
export function isBinary(w: SwitchItem): boolean {
	if (w.min === undefined || w.max === undefined) return false;
	const span = w.max - w.min;
	return span === 1 || (w.step !== undefined && w.step > 0 && span <= w.step);
}

export const isOn = (w: SwitchItem): boolean => w.value !== undefined && w.max !== undefined && w.value >= w.max;

export type SwitchPlan =
	| { kind: "unavailable" | "noselection" | "readonly" | "needsvalue" }
	| { kind: "on" | "off" | "set"; value: number };

/** On/off switches: tap turns on, hold 1 s turns off (it may be a camera or mount power outlet). Others set a configured value. */
export function planSwitch(st: SwitchState | undefined, settings: SwitchSettings): SwitchPlan {
	if (!st?.connected) return { kind: "unavailable" };
	const w = findSwitch(st, settings.switchId);
	if (!w) return { kind: settings.switchId === undefined ? "noselection" : "unavailable" };
	if (!w.writable) return { kind: "readonly" };
	if (isBinary(w)) return isOn(w) ? { kind: "off", value: w.min ?? 0 } : { kind: "on", value: w.max ?? 1 };
	const v = settings.setValue;
	if (v === undefined || (w.min !== undefined && v < w.min) || (w.max !== undefined && v > w.max)) return { kind: "needsvalue" };
	return { kind: "set", value: v };
}
