import { type CoolerPhase } from "./cooler.js";
import { homePlan, parkPlan } from "./mountcmd.js";
import { autoFocusPhase } from "./focus.js";
import { coverKind, planCover } from "./flat.js";
import { findSwitch, isBinary, isOn, planSwitch, settingsFrom } from "./switches.js";
import { isActiveFilter } from "./parse.js";
import type { NinaState } from "./store.js";

// Guiding RMS color thresholds in arcseconds. Tune for your image scale.
export const RMS_GOOD = 0.8;
export const RMS_OK = 1.5;

const C = {
	bg: "#0f1419",
	track: "#26303a",
	text: "#e8eef4",
	dim: "#7a8794",
	green: "#3ddc84",
	yellow: "#ffc107",
	red: "#ff5252",
	blue: "#4fc3f7",
	orange: "#ff9800",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface TextOpts {
	size?: number;
	fill?: string;
	weight?: number | string;
	anchor?: "start" | "middle" | "end";
}

const t = (x: number, y: number, s: string, o: TextOpts = {}) =>
	`<text x="${x}" y="${y}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="${o.size ?? 16}" font-weight="${o.weight ?? 600}" fill="${o.fill ?? C.text}" text-anchor="${o.anchor ?? "middle"}">${esc(s)}</text>`;

/** Largest font size (<= max) that keeps `s` inside ~128px of the 144px key. */
const fit = (s: string, max = 46) => Math.max(14, Math.min(max, Math.floor(124 / (Math.max(1, s.length) * 0.62))));

const key = (inner: string, bg: string = C.bg, border?: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="16" fill="${bg}"/>${border ? `<rect x="3" y="3" width="138" height="138" rx="14" fill="none" stroke="${border}" stroke-width="4"/>` : ""}${inner}</svg>`;

const title = (s: string) => t(72, 26, s, { size: 15, fill: C.dim, weight: 700 });
const big = (s: string, fill: string, y = 82, max = 46) => t(72, y, s, { size: fit(s, max), fill, weight: 700 });
const sub = (s: string, fill = C.dim, y = 108, size = 16) => t(72, y, s, { size, fill, weight: 600 });
const bar = (frac: number, fill: string) => {
	const f = Math.max(0, Math.min(1, frac));
	return `<rect x="14" y="120" width="116" height="9" rx="4.5" fill="${C.track}"/><rect x="14" y="120" width="${(116 * f).toFixed(1)}" height="9" rx="4.5" fill="${fill}"/>`;
};

const offline = (name: string) => key(title(name) + big("OFFLINE", C.red, 78, 30) + sub("no API", C.dim, 104));

export function fmtDuration(totalSeconds: number): string {
	const s = Math.max(0, Math.round(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** H:MM for long spans (meridian flip countdown). */
export function fmtHM(totalSeconds: number): string {
	const mins = Math.max(0, Math.floor(totalSeconds / 60));
	return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}

function wrap(name: string, maxChars: number, maxLines: number): string[] {
	const words = name.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let cur = "";
	for (let w of words) {
		while (w.length > maxChars) {
			if (cur) {
				lines.push(cur);
				cur = "";
			}
			lines.push(w.slice(0, maxChars));
			w = w.slice(maxChars);
		}
		if (!cur) cur = w;
		else if ((cur + " " + w).length <= maxChars) cur += " " + w;
		else {
			lines.push(cur);
			cur = w;
		}
	}
	if (cur) lines.push(cur);
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		kept[maxLines - 1] = kept[maxLines - 1].slice(0, maxChars - 1) + "…";
		return kept;
	}
	return lines;
}

/* ---------------- key renderers ---------------- */

export function renderExposure(s: NinaState, now = Date.now()): string {
	if (!s.apiUp) return offline("EXPOSURE");
	const cam = s.camera;
	if (!cam?.connected) return key(title("EXPOSURE") + big("NO CAM", C.dim, 80, 34));
	if (cam.isExposing && cam.exposureEndMs) {
		const remaining = (cam.exposureEndMs - now) / 1000;
		const dur = s.sequence?.exposure?.durationS;
		const frac = dur && dur >= remaining - 1 ? 1 - remaining / dur : undefined;
		if (remaining <= 0) return key(title("EXPOSURE") + big("READOUT", C.blue, 80, 30) + (frac !== undefined ? bar(1, C.blue) : ""));
		return key(
			title("EXPOSURE") +
				big(fmtDuration(Math.ceil(remaining)), C.text) +
				(dur ? sub(`of ${fmtDuration(dur)}`) : "") +
				(frac !== undefined ? bar(frac, C.green) : ""),
		);
	}
	return key(title("EXPOSURE") + big("IDLE", C.dim, 80, 40));
}

export function renderFrames(s: NinaState): string {
	if (!s.apiUp) return offline("FRAMES");
	const ex = s.sequence?.exposure;
	if (!ex) return key(title("FRAMES") + big("—", C.dim, 82, 46));
	const label = ex.total ? `${ex.completed}/${ex.total}` : String(ex.completed);
	const filter = ex.filter ?? s.filterWheel?.selected?.name;
	return key(title("FRAMES") + big(label, C.text) + (filter ? sub(filter, C.blue) : "") + (ex.total ? bar(ex.completed / ex.total, C.blue) : ""));
}

function nameBlock(name: string, label: string, fill: string): string {
	if (name.length <= 9) return key(title(label) + t(72, 80, name, { size: Math.min(28, fit(name, 28)), fill, weight: 700 }));
	const lines = wrap(name, 9, 3);
	const startY = 70 - (lines.length - 1) * 13;
	return key(title(label) + lines.map((l, i) => t(72, startY + i * 27, l, { size: 21, fill, weight: 700 })).join(""));
}

export function renderTarget(s: NinaState): string {
	if (!s.apiUp) return offline("TARGET");
	const seq = s.sequence;
	if (seq?.target) return nameBlock(seq.target, "TARGET", C.text);
	if (seq?.nextTarget) return nameBlock(seq.nextTarget, "NEXT", C.dim);
	return key(title("TARGET") + big("—", C.dim, 82, 46));
}

export function renderGuiding(s: NinaState): string {
	if (!s.apiUp) return offline("GUIDING");
	const g = s.guider;
	if (!g?.connected) return key(title("GUIDING") + big("NO PHD2", C.dim, 78, 30));
	const stateText = g.state && g.state !== "undefined" ? g.state : "";
	if (!g.hasData || g.totalArcsec === undefined) return key(title("GUIDING") + big("—", C.dim, 82, 46) + sub(stateText, C.dim, 112, 15));
	const rms = g.totalArcsec;
	const color = rms < RMS_GOOD ? C.green : rms < RMS_OK ? C.yellow : C.red;
	const f2 = (v?: number) => (v === undefined ? "–" : v.toFixed(2));
	return key(title("RMS") + big(`${rms.toFixed(2)}"`, color, 74, 40) + sub(`R ${f2(g.raArcsec)}  D ${f2(g.decArcsec)}`, C.text, 100, 15) + sub(stateText, C.dim, 124, 14));
}

export function renderCamera(s: NinaState): string {
	if (!s.apiUp) return offline("CAMERA");
	const cam = s.camera;
	if (!cam?.connected) return key(title("CAMERA") + big("NO CAM", C.dim, 80, 34));
	const temp = cam.tempC !== undefined ? `${cam.tempC.toFixed(1)}°` : "—";
	const color = cam.tempC === undefined ? C.dim : cam.coolerOn ? (cam.atTargetTemp ? C.green : C.yellow) : C.text;
	const cooler = cam.coolerPower !== undefined ? `cooler ${Math.round(cam.coolerPower)}%` : cam.coolerOn ? "cooler on" : "cooler off";
	return key(title("SENSOR") + big(temp, color, 80, 42) + sub(cooler, C.dim, 108, 15));
}

export function renderMount(s: NinaState): string {
	if (!s.apiUp) return offline("MOUNT");
	const m = s.mount;
	if (!m?.connected) return key(title("FLIP") + big("NO MNT", C.dim, 80, 34));
	const alt = m.altitude !== undefined ? `Alt ${Math.round(m.altitude)}°` : "";
	if (!m.tracking || m.flipHours === undefined) return key(title("FLIP") + big("—", C.dim, 82, 46) + sub(m.atPark ? "parked" : "not tracking", C.dim, 108, 15));
	const secs = m.flipHours * 3600;
	const color = secs < 600 ? C.red : secs < 1800 ? C.yellow : C.text;
	return key(title("FLIP IN") + big(fmtHM(secs), color, 80, 42) + sub(alt, C.dim, 108, 15));
}

export function renderStatus(s: NinaState): string {
	const row = (y: number, label: string, ok: boolean | undefined) =>
		`<circle cx="26" cy="${y - 6}" r="7" fill="${ok === undefined ? C.track : ok ? C.green : C.red}"/>` + t(42, y, label, { size: 18, anchor: "start", fill: ok ? C.text : C.dim });
	return key(
		row(38, "N.I.N.A.", s.apiUp) +
			row(65, "Camera", s.apiUp ? !!s.camera?.connected : undefined) +
			row(92, "Mount", s.apiUp ? !!s.mount?.connected : undefined) +
			row(119, "Guider", s.apiUp ? !!s.guider?.connected : undefined),
	);
}

export function renderStart(s: NinaState): string {
	if (!s.apiUp) return offline("SEQUENCE");
	return s.sequence?.running
		? key(title("SEQUENCE") + big("RUNNING", C.green, 80, 28))
		: key(title("SEQUENCE") + `<polygon points="58,50 58,98 98,74" fill="${C.green}"/>` + sub("START", C.green, 124, 16));
}

export function renderStop(s: NinaState, holdFrac = 0): string {
	const inner = title("SEQUENCE") + `<rect x="52" y="52" width="40" height="40" rx="5" fill="${C.red}"/>` + sub(holdFrac > 0 ? "HOLD…" : "STOP · HOLD 1s", C.red, 124, 14);
	return key(inner + (holdFrac > 0 ? bar(holdFrac, C.red).replace(/y="120"/g, 'y="104"') : ""));
}

/* ---------------- filter wheel ---------------- */

export function renderFilterCurrent(s: NinaState): string {
	if (!s.apiUp) return offline("FILTER");
	const fw = s.filterWheel;
	if (!fw?.connected) return key(title("FILTER") + big("NO WHEEL", C.dim, 78, 30));
	const sel = fw.selected;
	if (fw.moving) return key(title("FILTER") + big("MOVING", C.blue, 80, 34) + sub(sel ? `from ${sel.name}` : "", C.dim, 108, 15), "#10283a", C.blue);
	if (!sel) return key(title("FILTER") + big("—", C.dim, 82, 46) + sub("unknown", C.dim, 108, 15));
	return key(title("FILTER") + big(sel.name, C.blue, 80, 44) + (sel.id >= 0 ? sub(`slot ${sel.id}`, C.dim, 108, 15) : ""));
}

/** The configurable "Select Filter" key. `name` is the filter chosen in the key's settings; `pending` = change requested, not yet confirmed. */
export function renderFilterKey(s: NinaState, name: string | undefined, pending = false): string {
	if (!s.apiUp) return offline("FILTER");
	if (!name) return key(title("FILTER") + big("SET UP", C.dim, 78, 32) + sub("see key settings", C.dim, 108, 13));
	const fw = s.filterWheel;
	if (!fw?.connected) return key(title("FILTER") + big(name, C.dim, 80, 42) + sub("no wheel", C.dim, 108, 15));
	const f = fw.filters.find((x) => x.name === name);
	if (!f) return key(title("FILTER") + big(name, C.red, 80, 42) + sub("not on wheel", C.red, 108, 14));
	if (pending) return key(title("FILTER") + big(f.name, C.blue, 80, 42) + sub("changing…", C.blue, 108, 15), "#10283a", C.blue);
	if (isActiveFilter(fw, f)) return key(title("FILTER") + big(f.name, C.green, 80, 42) + sub("ACTIVE", C.green, 108, 15), "#12301f", C.green);
	return key(title("FILTER") + big(f.name, C.text, 80, 42) + sub("tap to select", C.dim, 108, 13));
}

/* ---------------- tracking ---------------- */

/** Nominal RA rates in arcsec/sec (ASCOM DriveRates). */
export const TRACK_RATES: Record<string, string> = { Sidereal: "15.041", Lunar: "14.685", Solar: "15.000", King: "15.037" };

const modeColor = (mode: string) => (mode === "Stopped" ? C.red : mode === "Custom" ? C.yellow : C.green);

export function renderTrackingCurrent(s: NinaState): string {
	if (!s.apiUp) return offline("TRACKING");
	const m = s.mount;
	if (!m?.connected) return key(title("TRACKING") + big("NO MNT", C.dim, 80, 34));
	const mode = m.trackingMode ?? (m.tracking ? "On" : "Stopped");
	const rate = TRACK_RATES[mode];
	const subText = m.atPark ? "parked" : rate ? `${rate}"/s` : mode === "Stopped" ? "not tracking" : m.tracking ? "tracking" : "not tracking";
	return key(title("TRACKING") + big(mode.toUpperCase(), modeColor(mode), 80, 34) + sub(subText, C.dim, 108, 15));
}

/** The "Stopped" key is styled like the Stop Sequence key: red square, "STOP · HOLD 1s", progress bar while held. */
function renderTrackingStop(s: NinaState, pending: boolean, holdFrac: number): string {
	const sq = (fill: string) => `<rect x="52" y="52" width="40" height="40" rx="5" fill="${fill}"/>`;
	const m = s.mount;
	if (!m?.connected) return key(title("TRACKING") + sq(C.track) + sub("no mount", C.dim, 124, 14));
	if (holdFrac > 0) return key(title("TRACKING") + sq(C.red) + sub("HOLD…", C.red, 124, 14) + bar(holdFrac, C.red).replace(/y="120"/g, 'y="104"'));
	if (pending) return key(title("TRACKING") + sq(C.blue) + sub("setting…", C.blue, 124, 14), "#10283a", C.blue);
	if (m.trackingMode?.toLowerCase() === "stopped")
		return key(title("TRACKING") + `<rect x="54" y="54" width="36" height="36" rx="5" fill="none" stroke="${C.red}" stroke-width="4"/>` + sub("STOPPED", C.red, 124, 14), "#2a1414", C.red);
	return key(title("TRACKING") + sq(C.red) + sub("STOP · HOLD 1s", C.red, 124, 14));
}

export function renderTrackingOption(s: NinaState, mode: string, pending = false, holdFrac = 0): string {
	if (!s.apiUp) return offline("TRACK");
	if (mode === "Stopped") return renderTrackingStop(s, pending, holdFrac);
	const m = s.mount;
	if (!m?.connected) return key(title("TRACK") + big(mode.toUpperCase(), C.track, 80, 30));
	const rate = TRACK_RATES[mode];
	const active = m.trackingMode?.toLowerCase() === mode.toLowerCase();
	if (pending) return key(title("TRACK") + big(mode.toUpperCase(), C.blue, 80, 30) + sub("setting…", C.blue, 108, 15), "#10283a", C.blue);
	if (active) return key(title("TRACK") + big(mode.toUpperCase(), C.green, 80, 30) + sub(rate ? `${rate}"/s` : "ACTIVE", C.green, 108, 15), "#12301f", C.green);
	return key(title("TRACK") + big(mode.toUpperCase(), C.text, 80, 30) + sub(rate ? `${rate}"/s` : "", C.dim, 108, 15));
}

/* ---------------- sensor cooling ---------------- */

export function renderCooler(s: NinaState, phase: CoolerPhase, targetC: number, opts: { holdFrac?: number; pending?: boolean } = {}): string {
	if (!s.apiUp) return offline("COOLER");
	const cam = s.camera;
	const temp = cam?.tempC !== undefined ? `${cam.tempC.toFixed(1)}°` : "—";
	const hint = (txt: string, fill: string = C.dim) => sub(txt, fill, 128, 12);
	if (phase === "nocam") return key(title("COOLER") + big("NO CAM", C.dim, 80, 34));
	if (phase === "nocooler") return key(title("COOLER") + big("NO COOLER", C.dim, 76, 30) + sub("not supported", C.dim, 104, 13));
	if ((opts.holdFrac ?? 0) > 0) {
		const label = phase === "warming" ? "CANCEL" : "WARM UP";
		return key(title("COOLER") + big(label, C.orange, 70, 28) + sub("HOLD…", C.orange, 100, 15) + bar(opts.holdFrac ?? 0, C.orange), "#2a1f0f", C.orange);
	}
	if (opts.pending) return key(title("COOLER") + big("…", C.blue, 84, 40) + sub("sending", C.blue, 108, 14), "#10283a", C.blue);
	const power = cam?.coolerPower !== undefined ? ` · ${Math.round(cam.coolerPower)}%` : "";
	switch (phase) {
		case "off":
			return key(title("COOLER") + big("OFF", C.dim, 72, 40) + sub(temp, C.text, 98, 16) + hint(`tap: cool to ${targetC}°`));
		case "cooling":
			return key(title("COOLER") + big("COOLING", C.yellow, 70, 26) + sub(`${temp} → ${targetC}°`, C.text, 98, 15) + hint("hold 1s: warm up"), C.bg);
		case "cooled":
			return key(title("COOLER") + big("ON", C.green, 72, 40) + sub(`${temp}${power}`, C.text, 98, 15) + hint("hold 1s: warm up"), "#12301f", C.green);
		case "warming":
			return key(title("COOLER") + big("WARMING", C.orange, 70, 26) + sub(temp, C.text, 98, 16) + hint("hold 1s: cancel"), "#2a1f0f", C.orange);
	}
}

/* ---------------- park / home ---------------- */

export interface MountKeyOpts {
	holdFrac?: number;
	/** "parking" | "unparking" | "homing" while a command is in flight or settling */
	pending?: string;
}

const holdFace = (label: string, frac: number) => key(title("MOUNT") + big(label, C.orange, 78, 34) + sub("HOLD…", C.orange, 108, 15) + bar(frac, C.orange), "#2a1f0f", C.orange);
const pendingFace = (label: string) => key(title("MOUNT") + big(label, C.blue, 78, 30) + sub("please wait", C.blue, 108, 14), "#10283a", C.blue);

export function renderPark(s: NinaState, o: MountKeyOpts = {}): string {
	if (!s.apiUp) return offline("MOUNT");
	const m = s.mount;
	if (!m?.connected) return key(title("MOUNT") + big("NO MNT", C.dim, 80, 34));
	if ((o.holdFrac ?? 0) > 0) return holdFace("PARK", o.holdFrac ?? 0);
	if (o.pending) return pendingFace(o.pending.toUpperCase());
	switch (parkPlan(m)) {
		case "unpark":
			return key(title("MOUNT") + big("PARKED", C.orange, 78, 32) + sub("tap: unpark", C.dim, 108, 14), "#2a1f0f", C.orange);
		case "park":
			return key(title("MOUNT") + big("PARK", C.text, 78, 40) + sub("hold 1s", C.dim, 108, 14));
		default:
			return key(title("MOUNT") + big("NO PARK", C.dim, 78, 30) + sub("not supported", C.dim, 108, 13));
	}
}

export function renderHome(s: NinaState, o: MountKeyOpts = {}): string {
	if (!s.apiUp) return offline("MOUNT");
	const m = s.mount;
	if (!m?.connected) return key(title("MOUNT") + big("NO MNT", C.dim, 80, 34));
	if ((o.holdFrac ?? 0) > 0) return holdFace("HOME", o.holdFrac ?? 0);
	if (o.pending) return pendingFace(o.pending.toUpperCase());
	switch (homePlan(m)) {
		case "home":
			return m.atHome
				? key(title("MOUNT") + big("AT HOME", C.green, 78, 32) + sub("hold 1s: re-home", C.dim, 108, 13), "#12301f", C.green)
				: key(title("MOUNT") + big("HOME", C.text, 78, 40) + sub("hold 1s", C.dim, 108, 14));
		case "parked":
			return key(title("MOUNT") + big("HOME", C.dim, 78, 40) + sub("unpark first", C.dim, 108, 14));
		default:
			return key(title("MOUNT") + big("NO HOME", C.dim, 78, 30) + sub("not supported", C.dim, 108, 13));
	}
}

/* ---------------- focuser ---------------- */

export function renderFocusPosition(s: NinaState): string {
	if (!s.apiUp) return offline("FOCUS");
	const f = s.focuser;
	if (!f?.connected) return key(title("FOCUS") + big("NO FOCUSER", C.dim, 78, 24));
	const pos = f.position === undefined ? "--" : String(f.position);
	const temp = f.tempC === undefined ? "" : `${f.tempC.toFixed(1)}°C`;
	return f.moving
		? key(title("FOCUS") + big(pos, C.blue, 78, 40) + sub("moving…", C.blue, 108, 15), "#10283a", C.blue)
		: key(title("FOCUS") + big(pos, C.text, 78, 40) + sub(temp, C.dim, 108, 16));
}

export interface FocusMoveOpts {
	pending?: boolean;
}

export function renderFocusMove(s: NinaState, dir: "in" | "out", steps: number, o: FocusMoveOpts = {}, afRunning = false): string {
	const name = dir === "in" ? "FOCUS IN" : "FOCUS OUT";
	if (!s.apiUp) return offline("FOCUS");
	const f = s.focuser;
	if (!f?.connected) return key(title(name) + big("NO FOCUSER", C.dim, 78, 24));
	const label = `${dir === "in" ? "−" : "+"}${steps}`;
	if (o.pending || f.moving) return key(title(name) + big(label, C.blue, 78, 40) + sub("moving…", C.blue, 108, 15), "#10283a", C.blue);
	if (afRunning) return key(title(name) + big(label, C.dim, 78, 40) + sub("autofocus", C.dim, 108, 15));
	return key(title(name) + big(label, C.text, 78, 40) + sub(f.position === undefined ? "" : `pos ${f.position}`, C.dim, 108, 15));
}

export interface AutoFocusOpts {
	holdFrac?: number;
	/** seconds since the autofocus was started from this deck */
	elapsedS?: number;
}

export function renderAutoFocus(s: NinaState, afRunning: boolean, o: AutoFocusOpts = {}): string {
	if (!s.apiUp) return offline("FOCUS");
	const phase = autoFocusPhase(s.focuser, afRunning);
	if (phase === "nofocuser") return key(title("AUTOFOCUS") + big("NO FOCUSER", C.dim, 78, 24));
	const holding = (o.holdFrac ?? 0) > 0;
	if (phase === "running") {
		if (holding) return key(title("AUTOFOCUS") + big("CANCEL?", C.red, 78, 30) + sub("HOLD…", C.red, 108, 15) + bar(o.holdFrac ?? 0, C.red), "#2a1414", C.red);
		return key(title("AUTOFOCUS") + big("RUNNING", C.blue, 74, 28) + sub(fmtDuration(o.elapsedS ?? 0), C.blue, 98, 18) + sub("hold 1s: cancel", C.dim, 124, 12), "#10283a", C.blue);
	}
	if (holding) return key(title("AUTOFOCUS") + big("AF", C.orange, 78, 44) + sub("HOLD…", C.orange, 108, 15) + bar(o.holdFrac ?? 0, C.orange), "#2a1f0f", C.orange);
	return key(title("AUTOFOCUS") + big("AF", C.text, 78, 44) + sub("hold 1s", C.dim, 108, 14));
}

/* ---------------- flat panel ---------------- */

const YEL_BG = "#2a2510";
const pct = (n?: number) => (n === undefined ? "" : `${Math.round(n)}%`);

export function renderFlatLight(s: NinaState, pending = false): string {
	if (!s.apiUp) return offline("FLAT LIGHT");
	const f = s.flat;
	if (!f?.connected) return key(title("FLAT LIGHT") + big("NO PANEL", C.dim, 78, 28));
	if (!f.supportsOnOff) return key(title("FLAT LIGHT") + big("NO ON/OFF", C.dim, 78, 26));
	if (pending) return key(title("FLAT LIGHT") + big("WAIT", C.blue, 78, 36) + sub("switching…", C.blue, 108, 14), "#10283a", C.blue);
	return f.lightOn
		? key(title("FLAT LIGHT") + big("ON", C.yellow, 78, 46) + sub(pct(f.brightness), C.yellow, 108, 18), YEL_BG, C.yellow)
		: key(title("FLAT LIGHT") + big("OFF", C.text, 78, 46) + sub(pct(f.brightness), C.dim, 108, 18));
}

export function renderFlatCover(s: NinaState, o: { holdFrac?: number; pending?: string } = {}): string {
	if (!s.apiUp) return offline("FLAT COVER");
	const f = s.flat;
	if (!f?.connected) return key(title("FLAT COVER") + big("NO PANEL", C.dim, 78, 28));
	if (!f.supportsOpenClose) return key(title("FLAT COVER") + big("NO COVER", C.dim, 78, 28));
	if ((o.holdFrac ?? 0) > 0) {
		const closing = planCover(f, false) === "close";
		return key(title("FLAT COVER") + big(closing ? "CLOSE" : "OPEN", C.orange, 78, 36) + sub("HOLD…", C.orange, 108, 15) + bar(o.holdFrac ?? 0, C.orange), "#2a1f0f", C.orange);
	}
	const kind = coverKind(f);
	if (o.pending || kind === "moving") return key(title("FLAT COVER") + big((o.pending ?? "moving").toUpperCase(), C.blue, 78, 28) + sub("please wait", C.blue, 108, 14), "#10283a", C.blue);
	switch (kind) {
		case "open":
			return key(title("FLAT COVER") + big("OPEN", C.green, 78, 42) + sub("hold 1s: close", C.dim, 108, 13), "#12301f", C.green);
		case "closed":
			return key(title("FLAT COVER") + big("CLOSED", C.text, 78, 38) + sub("hold 1s: open", C.dim, 108, 13));
		case "error":
			return key(title("FLAT COVER") + big("ERROR", C.red, 78, 38) + sub("hold 1s: open", C.dim, 108, 13));
		default:
			return key(title("FLAT COVER") + big("UNKNOWN", C.yellow, 78, 30) + sub("hold 1s: open", C.dim, 108, 13));
	}
}

export function renderFlatLevel(s: NinaState, preset: number, pending = false): string {
	if (!s.apiUp) return offline("FLAT LEVEL");
	const f = s.flat;
	if (!f?.connected) return key(title("FLAT LEVEL") + big("NO PANEL", C.dim, 78, 28));
	if (pending) return key(title("FLAT LEVEL") + big(`${preset}%`, C.blue, 78, 40) + sub("setting…", C.blue, 108, 14), "#10283a", C.blue);
	const active = f.brightness !== undefined && Math.abs(f.brightness - preset) < 1;
	return active
		? key(title("FLAT LEVEL") + big(`${preset}%`, C.green, 78, 42) + sub("current", C.green, 108, 14), "#12301f", C.green)
		: key(title("FLAT LEVEL") + big(`${preset}%`, C.text, 78, 42) + sub(f.brightness === undefined ? "" : `now ${pct(f.brightness)}`, C.dim, 108, 14));
}

/* ---------------- switch panel ---------------- */

const clip = (n: string, max: number) => (n.length > max ? `${n.slice(0, max - 1)}…` : n);
const num2 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function renderSwitch(s: NinaState, raw: Record<string, unknown> | undefined, o: { holdFrac?: number; pending?: boolean } = {}): string {
	if (!s.apiUp) return offline("SWITCH");
	const st = settingsFrom(raw);
	if (!s.switches?.connected) return key(title("SWITCH") + big("NO SWITCH", C.dim, 78, 26));
	const w = findSwitch(s.switches, st.switchId);
	if (st.switchId === undefined) return key(title("SWITCH") + big("PICK ONE", C.dim, 78, 28) + sub("open settings", C.dim, 108, 13));
	if (!w) return key(title("SWITCH") + big("MISSING", C.red, 78, 28) + sub(`id ${st.switchId}`, C.dim, 108, 14));
	const name = title(clip(w.name.toUpperCase(), 12));
	const plan = planSwitch(s.switches, st);
	if (o.pending) return key(name + big("WAIT", C.blue, 78, 36) + sub("switching…", C.blue, 108, 14), "#10283a", C.blue);
	if (isBinary(w)) {
		if ((o.holdFrac ?? 0) > 0) return key(name + big("OFF?", C.orange, 78, 40) + sub("HOLD…", C.orange, 108, 15) + bar(o.holdFrac ?? 0, C.orange), "#2a1f0f", C.orange);
		if (!w.writable) return key(name + big(isOn(w) ? "ON" : "OFF", isOn(w) ? C.green : C.text, 78, 44) + sub("read-only", C.dim, 108, 14));
		return isOn(w)
			? key(name + big("ON", C.green, 78, 46) + sub("hold 1s: off", C.dim, 108, 13), "#12301f", C.green)
			: key(name + big("OFF", C.text, 78, 46) + sub("tap: on", C.dim, 108, 14));
	}
	const val = w.value === undefined ? "--" : num2(w.value);
	if (plan.kind === "needsvalue") return key(name + big(val, C.text, 78, 38) + sub("set a value", C.yellow, 108, 14));
	if (plan.kind === "set") {
		const active = w.value !== undefined && Math.abs(w.value - plan.value) < 1e-9;
		return active ? key(name + big(val, C.green, 78, 40) + sub("current", C.green, 108, 14), "#12301f", C.green) : key(name + big(val, C.text, 78, 40) + sub(`tap: set ${num2(plan.value)}`, C.dim, 108, 13));
	}
	return key(name + big(val, C.dim, 78, 38) + sub("read-only", C.dim, 108, 14));
}
