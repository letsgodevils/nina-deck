import {
	CameraState,
	FilterWheelState,
	GuiderState,
	MountState,
	SequenceState,
	parseCamera,
	parseFilterWheel,
	parseFlat,
	parseFocuser,
	parseSwitches,
	type FlatState,
	type SwitchState,
	type FocuserState,
	parseGuiderGraph,
	parseGuiderInfo,
	parseMount,
	parseSequence,
} from "./parse.js";

/** Advanced API plugin default port is 1888. Override with NINA_BASE (used by tests). */
export const BASE = process.env.NINA_BASE ?? "http://localhost:1888/v2/api";

export interface NinaState {
	/** true when at least one endpoint answered in the last few seconds */
	apiUp: boolean;
	lastOkMs: number;
	camera?: CameraState;
	guider?: GuiderState;
	mount?: MountState;
	sequence?: SequenceState;
	filterWheel?: FilterWheelState;
	focuser?: FocuserState;
	flat?: FlatState;
	switches?: SwitchState;
}

export const state: NinaState = { apiUp: false, lastOkMs: 0 };

const API_STALE_MS = 6000;

export async function getJson(path: string, timeoutMs = 2000): Promise<any> {
	const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
	const text = await res.text();
	return JSON.parse(text);
}

function markOk(): void {
	state.lastOkMs = Date.now();
	state.apiUp = true;
}

const timers = new Set<ReturnType<typeof setTimeout>>();
let stopped = false;

function loop(intervalMs: number, fn: () => Promise<void>, onFail: () => void): void {
	const tick = async () => {
		if (stopped) return;
		try {
			await fn();
			markOk();
		} catch {
			onFail();
			if (Date.now() - state.lastOkMs > API_STALE_MS) state.apiUp = false;
		} finally {
			if (!stopped) timers.add(setTimeout(tick, intervalMs));
		}
	};
	void tick();
}

export function startPolling(): void {
	stopped = false;

	// Exposure countdown uses ExposureEndTime from camera/info, so poll this one fastest.
	loop(
		1000,
		async () => {
			state.camera = parseCamera(await getJson("/equipment/camera/info"));
		},
		() => {
			state.camera = undefined;
		},
	);

	loop(
		2000,
		async () => {
			const [info, graph] = await Promise.all([getJson("/equipment/guider/info"), getJson("/equipment/guider/graph")]);
			const i = parseGuiderInfo(info);
			state.guider = { ...i, ...parseGuiderGraph(graph) };
		},
		() => {
			state.guider = undefined;
		},
	);

	loop(
		5000,
		async () => {
			state.mount = parseMount(await getJson("/equipment/mount/info"));
		},
		() => {
			state.mount = undefined;
		},
	);

	// The sequence JSON can be large (63-panel mosaics), so poll it less often.
	loop(
		3000,
		async () => {
			state.sequence = parseSequence(await getJson("/sequence/json", 4000));
		},
		() => {
			state.sequence = undefined;
		},
	);

	loop(
		2000,
		async () => {
			state.filterWheel = parseFilterWheel(await getJson("/equipment/filterwheel/info"));
		},
		() => {
			state.filterWheel = undefined;
		},
	);

	loop(
		2000,
		async () => {
			state.focuser = parseFocuser(await getJson("/equipment/focuser/info"));
		},
		() => {
			state.focuser = undefined;
		},
	);

	loop(
		2000,
		async () => {
			state.flat = parseFlat(await getJson("/equipment/flatdevice/info"));
		},
		() => {
			state.flat = undefined;
		},
	);

	loop(
		2000,
		async () => {
			state.switches = parseSwitches(await getJson("/equipment/switch/info"));
		},
		() => {
			state.switches = undefined;
		},
	);
}

/** Re-read camera + mount + filter wheel right away (used after a command so the keys update without waiting for the next poll). */
export async function refreshEquipment(): Promise<void> {
	await Promise.allSettled([
		getJson("/equipment/camera/info").then((r) => (state.camera = parseCamera(r))),
		getJson("/equipment/mount/info").then((r) => (state.mount = parseMount(r))),
		getJson("/equipment/filterwheel/info").then((r) => (state.filterWheel = parseFilterWheel(r))),
		getJson("/equipment/focuser/info").then((r) => (state.focuser = parseFocuser(r))),
		getJson("/equipment/flatdevice/info").then((r) => (state.flat = parseFlat(r))),
		getJson("/equipment/switch/info").then((r) => (state.switches = parseSwitches(r))),
	]);
}

export function stopPolling(): void {
	stopped = true;
	for (const t of timers) clearTimeout(t);
	timers.clear();
}

/** Fire-and-check command call. Returns true if N.I.N.A. reported success. */
export async function command(path: string, timeoutMs = 5000): Promise<boolean> {
	try {
		const r = await getJson(path, timeoutMs);
		return r?.Success === true;
	} catch {
		return false;
	}
}
