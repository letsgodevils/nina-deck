// Pure parsing helpers for N.I.N.A. Advanced API responses.
// Field names come from real responses captured from the user's N.I.N.A. (Advanced API v2).

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Number, or undefined for NaN / "NaN" / "" / non-numeric. N.I.N.A. returns the string "NaN" for unknown values. */
export function num(v: unknown): number | undefined {
	if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
	if (typeof v === "string" && v.trim() !== "") {
		const n = Number(v);
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}

/** Parses .NET round-trip dates like "2026-11-10T19:26:39.9181085-07:00" (7 fractional digits). */
export function parseNinaDate(s: unknown): number | undefined {
	if (typeof s !== "string") return undefined;
	const trimmed = s.replace(/(\.\d{3})\d+/, "$1");
	const ms = Date.parse(trimmed);
	if (!Number.isFinite(ms) || new Date(ms).getUTCFullYear() < 2000) return undefined;
	return ms;
}

export interface CameraState {
	connected: boolean;
	isExposing: boolean;
	exposureEndMs?: number;
	tempC?: number;
	targetTempC?: number;
	canSetTemperature: boolean;
	coolerOn: boolean;
	coolerPower?: number;
	atTargetTemp: boolean;
	cameraState?: string;
	name?: string;
}

export function parseCamera(resp: any): CameraState {
	const r = resp?.Response ?? {};
	return {
		connected: !!r.Connected,
		isExposing: !!r.IsExposing,
		exposureEndMs: parseNinaDate(r.ExposureEndTime),
		tempC: num(r.Temperature),
		targetTempC: num(r.TemperatureSetPoint) ?? num(r.TargetTemp),
		canSetTemperature: !!r.CanSetTemperature,
		coolerOn: !!r.CoolerOn,
		coolerPower: num(r.CoolerPower),
		atTargetTemp: !!r.AtTargetTemp,
		cameraState: typeof r.CameraState === "string" ? r.CameraState : undefined,
		name: r.DisplayName ?? r.Name,
	};
}

export interface GuiderState {
	connected: boolean;
	state?: string;
	hasData: boolean;
	totalArcsec?: number;
	raArcsec?: number;
	decArcsec?: number;
}

/** "Tot: 0.62 (0.93\")" -> 0.93 (the arcsecond value in parentheses). */
function arcsecFromText(text: unknown): number | undefined {
	if (typeof text !== "string") return undefined;
	const m = text.match(/\(\s*([\d.]+)\s*["″]/);
	return m ? num(m[1]) : undefined;
}

export function parseGuiderInfo(resp: any): { connected: boolean; state?: string } {
	const r = resp?.Response ?? {};
	const st = r.State;
	return {
		connected: !!r.Connected,
		state: typeof st === "string" ? st : st != null ? String(st) : undefined,
	};
}

export function parseGuiderGraph(resp: any): Pick<GuiderState, "hasData" | "totalArcsec" | "raArcsec" | "decArcsec"> {
	const rms = resp?.Response?.RMS;
	if (!rms) return { hasData: false };
	const pts = num(rms.DataPoints) ?? 0;
	const scale = num(rms.Scale) ?? num(resp?.Response?.PixelScale) ?? 0;
	const pick = (text: unknown, px: unknown) => arcsecFromText(text) ?? (num(px) !== undefined && scale > 0 ? num(px)! * scale : undefined);
	return {
		hasData: pts > 0,
		totalArcsec: pick(rms.TotalText, rms.Total),
		raArcsec: pick(rms.RAText, rms.RA),
		decArcsec: pick(rms.DecText, rms.Dec),
	};
}

export interface MountState {
	connected: boolean;
	tracking: boolean;
	trackingMode?: string; // "Sidereal" | "Lunar" | "Solar" | "King" | "Custom" | "Stopped"
	slewing: boolean;
	atPark: boolean;
	atHome: boolean;
	canPark: boolean;
	canFindHome: boolean;
	flipHours?: number;
	altitude?: number;
}

export function parseMount(resp: any): MountState {
	const r = resp?.Response ?? {};
	return {
		connected: !!r.Connected,
		tracking: !!r.TrackingEnabled,
		trackingMode: typeof r.TrackingMode === "string" ? r.TrackingMode : undefined,
		slewing: !!r.Slewing,
		atPark: !!r.AtPark,
		atHome: !!r.AtHome,
		canPark: r.CanPark !== false,
		canFindHome: r.CanFindHome !== false,
		flipHours: num(r.TimeToMeridianFlip),
		altitude: num(r.Altitude),
	};
}

export interface RunningExposure {
	name: string;
	durationS: number;
	completed: number;
	total?: number;
	filter?: string; // undefined when the instruction says "Current"
}

export interface SequenceState {
	running: boolean;
	target?: string; // running target container
	nextTarget?: string; // first not-yet-started target container
	exposure?: RunningExposure;
}

const stripContainer = (n: string) => n.replace(/_Container$/, "");

function findRunningExposure(nodes: any[]): any | undefined {
	for (const n of nodes) {
		if (Array.isArray(n?.Items)) {
			const deeper = findRunningExposure(n.Items);
			if (deeper) return deeper;
		}
		if (n?.Status === "RUNNING" && typeof n.ExposureTime === "number") return n;
	}
	return undefined;
}

function findByName(nodes: any[], name: string): any | undefined {
	for (const n of nodes) {
		if (n?.Name === name) return n;
		if (Array.isArray(n?.Items)) {
			const f = findByName(n.Items, name);
			if (f) return f;
		}
	}
	return undefined;
}

export function parseSequence(resp: any): SequenceState {
	const nodes: any[] = Array.isArray(resp?.Response) ? resp.Response : [];
	const running = nodes.some((n) => n?.Status === "RUNNING");

	const targets = findByName(nodes, "Targets_Container");
	const kids: any[] = Array.isArray(targets?.Items) ? targets.Items : [];
	const runningKid = kids.find((k) => k?.Status === "RUNNING");
	const nextKid = kids.find((k) => k?.Status === "CREATED");

	const ex = findRunningExposure(nodes);
	const iterations = num(ex?.Iterations);
	return {
		running,
		target: runningKid?.Name ? stripContainer(String(runningKid.Name)) : undefined,
		nextTarget: nextKid?.Name ? stripContainer(String(nextKid.Name)) : undefined,
		exposure: ex
			? {
					name: String(ex.Name ?? "Exposure"),
					durationS: num(ex.ExposureTime) ?? 0,
					completed: num(ex.CompletedIterations) ?? 0,
					total: iterations && iterations > 0 ? iterations : undefined,
					filter: ex.Filter && ex.Filter !== "Current" ? String(ex.Filter) : undefined,
				}
			: undefined,
	};
}

export interface FilterInfo {
	id: number; // value passed to change-filter?filterId=
	name: string;
}

export interface FilterWheelState {
	connected: boolean;
	moving: boolean;
	filters: FilterInfo[];
	selected?: FilterInfo; // id is -1 when the response only gave a name and no match was found
}

function toFilter(item: any, index: number): FilterInfo | undefined {
	if (typeof item === "string") return { id: index, name: item };
	if (item && typeof item === "object" && typeof item.Name === "string") return { id: num(item.Position) ?? num(item.Id) ?? index, name: item.Name };
	return undefined;
}

/**
 * Parser for GET /equipment/filterwheel/info. Verified against a real response: SelectedFilter {Name, Id},
 * AvailableFilters [{Name, Id}], IsMoving. Also tolerates string lists and Position-style ids.
 */
export function parseFilterWheel(resp: any): FilterWheelState {
	const r = resp?.Response;
	if (!r || typeof r !== "object") return { connected: false, moving: false, filters: [] };
	const list: any[] = Array.isArray(r.AvailableFilters) ? r.AvailableFilters : [];
	const filters = list.map((f, i) => toFilter(f, i)).filter((f): f is FilterInfo => !!f);
	let selected = r.SelectedFilter != null ? toFilter(r.SelectedFilter, -1) : undefined;
	if (selected && selected.id < 0) selected = filters.find((f) => f.name === selected!.name) ?? selected;
	return { connected: !!r.Connected, moving: !!r.IsMoving, filters, selected };
}

export function isActiveFilter(fw: FilterWheelState | undefined, f: FilterInfo): boolean {
	const sel = fw?.selected;
	return !!sel && sel.name === f.name && (sel.id < 0 || sel.id === f.id);
}

/** Key settings store the filter by name (stable if the wheel is reordered). */
export function wantedFilterName(settings: Record<string, unknown> | undefined): string | undefined {
	const n = settings?.filterName;
	return typeof n === "string" && n !== "" ? n : undefined;
}

export function resolveFilter(fw: FilterWheelState | undefined, settings: Record<string, unknown> | undefined): FilterInfo | undefined {
	const name = wantedFilterName(settings);
	return fw?.connected && name ? fw.filters.find((f) => f.name === name) : undefined;
}

export interface FocuserState {
	connected: boolean;
	position?: number;
	stepSize?: number;
	tempC?: number;
	/** IsMoving or IsSettling */
	moving: boolean;
	name?: string;
}

export function parseFocuser(resp: any): FocuserState {
	const r = resp?.Response ?? {};
	return {
		connected: !!r.Connected,
		position: num(r.Position),
		stepSize: num(r.StepSize),
		tempC: num(r.Temperature),
		moving: !!r.IsMoving || !!r.IsSettling,
		name: typeof r.DisplayName === "string" ? r.DisplayName : typeof r.Name === "string" ? r.Name : undefined,
	};
}

export interface FlatState {
	connected: boolean;
	/** raw N.I.N.A. cover state text: Unknown, NeitherOpenNorClosed, Closed, Open, Error, NotPresent */
	coverState?: string;
	lightOn: boolean;
	brightness?: number;
	supportsOpenClose: boolean;
	supportsOnOff: boolean;
	name?: string;
}

export function parseFlat(resp: any): FlatState {
	const r = resp?.Response ?? {};
	return {
		connected: !!r.Connected,
		coverState: typeof r.CoverState === "string" ? r.CoverState : undefined,
		lightOn: !!r.LightOn,
		brightness: num(r.Brightness),
		supportsOpenClose: !!r.SupportsOpenClose,
		supportsOnOff: r.SupportsOnOff !== false,
		name: typeof r.DisplayName === "string" ? r.DisplayName : typeof r.Name === "string" ? r.Name : undefined,
	};
}

export interface SwitchItem {
	id: number;
	name: string;
	value?: number;
	min?: number;
	max?: number;
	step?: number;
	writable: boolean;
}

export interface SwitchState {
	connected: boolean;
	switches: SwitchItem[];
	name?: string;
}

export function parseSwitches(resp: any): SwitchState {
	const r = resp?.Response ?? {};
	const item = (w: any, writable: boolean): SwitchItem | undefined => {
		const id = num(w?.Id);
		if (id === undefined) return undefined;
		return { id, name: typeof w?.Name === "string" && w.Name.trim() ? w.Name.trim() : `Switch ${id}`, value: num(w?.Value), min: num(w?.Minimum), max: num(w?.Maximum), step: num(w?.StepSize), writable };
	};
	const list = (a: unknown, writable: boolean) => (Array.isArray(a) ? a.map((w) => item(w, writable)).filter((x): x is SwitchItem => !!x) : []);
	return {
		connected: !!r.Connected,
		switches: [...list(r.WritableSwitches, true), ...list(r.ReadonlySwitches, false)],
		name: typeof r.DisplayName === "string" ? r.DisplayName : typeof r.Name === "string" ? r.Name : undefined,
	};
}
