import streamDeck, { action, DidReceiveSettingsEvent, KeyAction, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { command, refreshEquipment, state, NinaState } from "../core/store.js";
import { isActiveFilter, resolveFilter, wantedFilterName } from "../core/parse.js";
import { coolPath, coolerPhase, planCooler, targetTempFrom, warmPath } from "../core/cooler.js";
import { HoldTracker } from "../core/hold.js";
import { MOUNT_PATHS, homePlan, parkPlan } from "../core/mountcmd.js";
import { brightnessFrom, brightnessPath, coverKind, coverPath, lightPath, planBrightness, planCover, planLight } from "../core/flat.js";
import { findSwitch, planSwitch, settingsFrom, switchPath } from "../core/switches.js";
import { autoFocusPath, movePath, planFocusMove, positionTolerance, stepsFrom, targetPosition } from "../core/focus.js";
import {
	renderCamera,
	renderCooler,
	renderExposure,
	renderFilterCurrent,
	renderFilterKey,
	renderFrames,
	renderAutoFocus,
	renderFlatCover,
	renderFlatLevel,
	renderFlatLight,
	renderFocusMove,
	renderFocusPosition,
	renderGuiding,
	renderHome,
	renderMount,
	renderPark,
	renderSwitch,
	renderStart,
	renderStatus,
	renderStop,
	renderTarget,
	renderTrackingCurrent,
	renderTrackingOption,
} from "../core/render.js";

const toDataUri = (svg: string) => `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;

type Settings = Record<string, unknown>;

/** Every visible key registers here; one 1 Hz ticker repaints them all. */
const visible = new Map<string, { action: KeyAction; settings: Settings; render: (s: NinaState) => string; last?: string }>();

export function startTicker(): void {
	setInterval(() => {
		for (const v of visible.values()) {
			const svg = v.render(state);
			if (svg !== v.last) {
				v.last = svg;
				void v.action.setImage(toDataUri(svg));
			}
		}
	}, 1000);
}

abstract class LiveKey extends SingletonAction {
	/** `settings` are this key's own settings (from its property inspector); `id` is the key's unique context id. */
	protected abstract draw(s: NinaState, settings: Settings, id: string): string;

	protected paint(a: KeyAction): void {
		const entry = visible.get(a.id);
		if (!entry) return;
		entry.last = entry.render(state);
		void a.setImage(toDataUri(entry.last));
	}

	override onWillAppear(ev: WillAppearEvent): void {
		if (!ev.action.isKey()) return;
		const entry = {
			action: ev.action,
			settings: (ev.payload.settings ?? {}) as Settings,
			render: (s: NinaState) => this.draw(s, entry.settings, ev.action.id),
		} as { action: KeyAction; settings: Settings; render: (s: NinaState) => string; last?: string };
		visible.set(ev.action.id, entry);
		this.paint(ev.action);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
		const entry = visible.get(ev.action.id);
		if (!entry || !ev.action.isKey()) return;
		entry.settings = (ev.payload.settings ?? {}) as Settings;
		this.paint(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		visible.delete(ev.action.id);
	}
}

const UUID = "com.sirsnacks.ninadeck";

@action({ UUID: `${UUID}.exposure` })
export class ExposureKey extends LiveKey {
	protected draw = (s: NinaState) => renderExposure(s);
}

@action({ UUID: `${UUID}.frames` })
export class FramesKey extends LiveKey {
	protected draw = (s: NinaState) => renderFrames(s);
}

@action({ UUID: `${UUID}.target` })
export class TargetKey extends LiveKey {
	protected draw = (s: NinaState) => renderTarget(s);
}

@action({ UUID: `${UUID}.guiding` })
export class GuidingKey extends LiveKey {
	protected draw = (s: NinaState) => renderGuiding(s);
}

@action({ UUID: `${UUID}.camera` })
export class CameraKey extends LiveKey {
	protected draw = (s: NinaState) => renderCamera(s);
}

@action({ UUID: `${UUID}.mount` })
export class MountKey extends LiveKey {
	protected draw = (s: NinaState) => renderMount(s);
}

@action({ UUID: `${UUID}.status` })
export class StatusKey extends LiveKey {
	protected draw = (s: NinaState) => renderStatus(s);
}

@action({ UUID: `${UUID}.start` })
export class StartKey extends LiveKey {
	protected draw = (s: NinaState) => renderStart(s);

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (state.sequence?.running) {
			await ev.action.showAlert(); // already running; do nothing
			return;
		}
		if (await command("/sequence/start")) await ev.action.showOk();
		else await ev.action.showAlert();
	}
}

/** Stop requires holding the key for 1 second so a stray tap cannot kill a running sequence. */
@action({ UUID: `${UUID}.stop` })
export class StopKey extends LiveKey {
	private static readonly HOLD_MS = 1000;
	private holds = new Map<string, { t0: number; timer: ReturnType<typeof setInterval> }>();

	protected draw = (s: NinaState) => renderStop(s);

	override onKeyDown(ev: KeyDownEvent): void {
		const a = ev.action;
		const t0 = Date.now();
		const timer = setInterval(async () => {
			const frac = (Date.now() - t0) / StopKey.HOLD_MS;
			if (frac >= 1) {
				this.clear(a.id);
				const ok = await command("/sequence/stop");
				if (ok) await a.showOk();
				else await a.showAlert();
				return;
			}
			const entry = visible.get(a.id);
			if (entry) {
				entry.last = renderStop(state, frac);
				void a.setImage(toDataUri(entry.last));
			}
		}, 100);
		this.holds.set(a.id, { t0, timer });
	}

	override onKeyUp(ev: KeyUpEvent): void {
		this.clear(ev.action.id);
		if (ev.action.isKey()) this.paint(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.clear(ev.action.id);
		super.onWillDisappear(ev);
	}

	private clear(id: string): void {
		const h = this.holds.get(id);
		if (h) clearInterval(h.timer);
		this.holds.delete(id);
	}
}

/* ---------------- filter wheel ---------------- */

@action({ UUID: `${UUID}.filter` })
export class FilterCurrentKey extends LiveKey {
	protected draw = (s: NinaState) => renderFilterCurrent(s);
}

/** Changing filter or tracking rate mid-exposure would ruin the frame, so these keys refuse while the camera is exposing. */
const busyExposing = () => !!state.camera?.isExposing;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One configurable key: drag it onto the deck as many times as you like and pick the filter for each key in its
 * settings panel. The panel's drop-down is filled from the connected wheel (via the /filters route in plugin.ts).
 */
@action({ UUID: `${UUID}.filterselect` })
export class FilterSelectKey extends LiveKey {
	private pendingUntil = new Map<string, number>();

	protected draw(s: NinaState, settings: Settings, id: string): string {
		const f = resolveFilter(s.filterWheel, settings);
		const pending = (this.pendingUntil.get(id) ?? 0) > Date.now() && !(f && isActiveFilter(s.filterWheel, f));
		return renderFilterKey(s, wantedFilterName(settings), pending);
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const settings = (ev.payload.settings ?? {}) as Settings;
		const fw = state.filterWheel;
		const f = resolveFilter(fw, settings);
		if (!f) {
			streamDeck.logger.warn(`Select Filter key has no usable filter (wanted "${wantedFilterName(settings) ?? "none set"}")`);
			return void (await ev.action.showAlert());
		}
		if (isActiveFilter(fw, f)) return;
		if (busyExposing()) {
			streamDeck.logger.warn(`Refused filter change to ${f.name}: camera is exposing`);
			return void (await ev.action.showAlert());
		}
		this.pendingUntil.set(ev.action.id, Date.now() + 15_000);
		this.paint(ev.action);
		// The wheel can take a while to move, so allow a long timeout.
		const ok = await command(`/equipment/filterwheel/change-filter?filterId=${f.id}`, 30_000);
		await refreshEquipment();
		if (!ok) {
			this.pendingUntil.delete(ev.action.id);
			streamDeck.logger.warn(`change-filter failed for ${f.name} (id ${f.id})`);
			await ev.action.showAlert();
		}
		this.paint(ev.action);
	}
}

/* ---------------- tracking ---------------- */

@action({ UUID: `${UUID}.tracking` })
export class TrackingCurrentKey extends LiveKey {
	protected draw = (s: NinaState) => renderTrackingCurrent(s);
}

/**
 * Tracking selector. Mode numbers follow the Advanced API (0 Sidereal, 1 Lunar, 2 Solar, 3 King, 4 Stopped);
 * 4 = Stopped was confirmed on the user's simulator mount. "Stopped" must be held for 1 second so a stray tap
 * cannot stop tracking.
 */
class TrackingOptionKey extends LiveKey {
	private static readonly HOLD_MS = 1000;
	private pendingUntil = new Map<string, number>();
	private holdStart = new Map<string, number>();
	private holdTimer = new Map<string, ReturnType<typeof setInterval>>();

	constructor(
		private readonly mode: string,
		private readonly modeId: number,
		private readonly requiresHold = false,
	) {
		super();
	}

	private isActive(): boolean {
		return state.mount?.trackingMode?.toLowerCase() === this.mode.toLowerCase();
	}

	protected draw(s: NinaState, _settings: Settings, id: string): string {
		const t0 = this.holdStart.get(id);
		const holdFrac = t0 === undefined ? 0 : Math.min(1, (Date.now() - t0) / TrackingOptionKey.HOLD_MS);
		const done = s.mount?.trackingMode?.toLowerCase() === this.mode.toLowerCase();
		return renderTrackingOption(s, this.mode, (this.pendingUntil.get(id) ?? 0) > Date.now() && !done, holdFrac);
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!this.requiresHold) return this.apply(ev.action);
		if (this.isActive()) return;
		if (busyExposing()) {
			streamDeck.logger.warn(`Refused tracking change to ${this.mode}: camera is exposing`);
			return void (await ev.action.showAlert());
		}
		const a = ev.action;
		this.holdStart.set(a.id, Date.now());
		this.holdTimer.set(
			a.id,
			setInterval(() => {
				if (Date.now() - (this.holdStart.get(a.id) ?? Date.now()) >= TrackingOptionKey.HOLD_MS) {
					this.cancelHold(a.id);
					void this.apply(a);
				} else this.paint(a);
			}, 100),
		);
	}

	override onKeyUp(ev: KeyUpEvent): void {
		this.cancelHold(ev.action.id);
		if (ev.action.isKey()) this.paint(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.cancelHold(ev.action.id);
		super.onWillDisappear(ev);
	}

	private cancelHold(id: string): void {
		const t = this.holdTimer.get(id);
		if (t) clearInterval(t);
		this.holdTimer.delete(id);
		this.holdStart.delete(id);
	}

	private async apply(a: KeyAction): Promise<void> {
		if (this.isActive()) return;
		if (busyExposing()) {
			streamDeck.logger.warn(`Refused tracking change to ${this.mode}: camera is exposing`);
			return void (await a.showAlert());
		}
		this.pendingUntil.set(a.id, Date.now() + 8_000);
		this.paint(a);
		const ok = await command(`/equipment/mount/tracking?mode=${this.modeId}`);
		await sleep(1000);
		await refreshEquipment();
		const reported = state.mount?.trackingMode;
		if (!ok || reported?.toLowerCase() !== this.mode.toLowerCase()) {
			this.pendingUntil.delete(a.id);
			streamDeck.logger.warn(`Tracking change to ${this.mode} (mode=${this.modeId}) failed or not confirmed; mount reports ${reported ?? "unknown"}, api ok=${ok}`);
			await a.showAlert();
		}
		this.paint(a);
	}
}

/* ---------------- sensor cooling ---------------- */

/**
 * Cooler toggle. Cooler off: tap to cool to the key's target temperature (set in its settings panel).
 * Cooler on: hold 1 s to warm up (N.I.N.A.'s gradual default warm-up, never an abrupt switch-off).
 * While warming, hold 1 s to cancel. Warming is refused while the camera is exposing.
 */
@action({ UUID: `${UUID}.cooler` })
export class CoolerKey extends LiveKey {
	private static readonly WARM_TRACK_MS = 60 * 60_000; // forget a local "warming" flag after an hour
	private hold = new HoldTracker(1000);
	private warmingSince = new Map<string, number>();
	private pendingUntil = new Map<string, number>();

	private isWarming(id: string): boolean {
		const t = this.warmingSince.get(id);
		if (t === undefined) return false;
		if (Date.now() - t > CoolerKey.WARM_TRACK_MS || (state.camera && !state.camera.coolerOn)) {
			this.warmingSince.delete(id); // finished (cooler is off) or stale
			return false;
		}
		return true;
	}

	protected draw(s: NinaState, settings: Settings, id: string): string {
		const phase = coolerPhase(s.camera, this.isWarming(id));
		return renderCooler(s, phase, targetTempFrom(settings), { holdFrac: this.hold.frac(id), pending: (this.pendingUntil.get(id) ?? 0) > Date.now() });
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const a = ev.action;
		const settings = (ev.payload.settings ?? {}) as Settings;
		const plan = planCooler(coolerPhase(state.camera, this.isWarming(a.id)));
		if (plan === "unavailable") return void (await a.showAlert());
		if (plan === "cool") return this.run(a, "cool", settings);
		if (plan === "warm" && busyExposing()) {
			streamDeck.logger.warn("Refused warm-up: camera is exposing");
			return void (await a.showAlert());
		}
		this.hold.start(
			a.id,
			() => this.paint(a),
			() => void this.run(a, plan, settings),
		);
	}

	override onKeyUp(ev: KeyUpEvent): void {
		this.hold.cancel(ev.action.id);
		if (ev.action.isKey()) this.paint(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.hold.cancel(ev.action.id);
		super.onWillDisappear(ev);
	}

	private async run(a: KeyAction, plan: "cool" | "warm" | "cancel-warm", settings: Settings): Promise<void> {
		const path = plan === "cool" ? coolPath(targetTempFrom(settings)) : warmPath(plan === "cancel-warm");
		this.pendingUntil.set(a.id, Date.now() + 6_000);
		this.paint(a);
		const ok = await command(path, 15_000);
		this.pendingUntil.delete(a.id);
		if (ok) {
			if (plan === "warm") this.warmingSince.set(a.id, Date.now());
			else if (plan === "cancel-warm") this.warmingSince.delete(a.id);
		} else {
			streamDeck.logger.warn(`Cooler command failed: ${path}`);
			await a.showAlert();
		}
		await refreshEquipment();
		this.paint(a);
	}
}

/* ---------------- park / home ---------------- */

/**
 * Shared behavior for keys that physically move the mount: they need a 1 s hold, are refused while the camera is
 * exposing, show "please wait" while the command runs, and then settle once the mount reports its new state.
 */
abstract class MountMoveKey extends LiveKey {
	protected hold = new HoldTracker(1000);
	private pending = new Map<string, { label: string; until: number }>();

	protected pendingLabel(id: string): string | undefined {
		const p = this.pending.get(id);
		if (!p) return undefined;
		if (p.until <= Date.now()) {
			this.pending.delete(id);
			return undefined;
		}
		return p.label;
	}

	/**
	 * Runs the command. The API answers immediately ("Parking", "Homing") while the mount keeps slewing, so the key
	 * stays on "please wait" and re-reads the mount every 2 s until it reports the move is finished (3 min max).
	 */
	protected async run(a: KeyAction, path: string, label: string, done: (m: NonNullable<typeof state.mount>) => boolean): Promise<void> {
		this.pending.set(a.id, { label, until: Date.now() + 200_000 });
		this.paint(a);
		const ok = await command(path, 15_000);
		if (!ok) {
			this.pending.delete(a.id);
			streamDeck.logger.warn(`Mount command failed: ${path}`);
			await refreshEquipment();
			await a.showAlert();
			this.paint(a);
			return;
		}
		const deadline = Date.now() + 180_000;
		let finished = false;
		while (Date.now() < deadline) {
			await sleep(2000);
			await refreshEquipment();
			const m = state.mount;
			if (m && !m.slewing && done(m)) {
				finished = true;
				break;
			}
			this.paint(a);
		}
		this.pending.delete(a.id);
		if (!finished) {
			streamDeck.logger.warn(`Mount did not finish within 3 min: ${path}`);
			await a.showAlert();
		}
		this.paint(a);
	}

	protected startHold(a: KeyAction, action: () => void): void {
		if (busyExposing()) {
			streamDeck.logger.warn("Refused mount move: camera is exposing");
			void a.showAlert();
			return;
		}
		this.hold.start(
			a.id,
			() => this.paint(a),
			() => action(),
		);
	}

	override onKeyUp(ev: KeyUpEvent): void {
		this.hold.cancel(ev.action.id);
		if (ev.action.isKey()) this.paint(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.hold.cancel(ev.action.id);
		super.onWillDisappear(ev);
	}
}

/** Park: hold 1 s to park; when parked, a tap unparks. */
@action({ UUID: `${UUID}.park` })
export class ParkKey extends MountMoveKey {
	protected draw(s: NinaState, _settings: Settings, id: string): string {
		return renderPark(s, { holdFrac: this.hold.frac(id), pending: this.pendingLabel(id) });
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const a = ev.action;
		const plan = parkPlan(state.mount);
		if (plan === "unavailable") return void (await a.showAlert());
		if (plan === "unpark") return this.run(a, MOUNT_PATHS.unpark, "unparking", (m) => !m.atPark);
		this.startHold(a, () => void this.run(a, MOUNT_PATHS.park, "parking", (m) => m.atPark));
	}
}

/** Home: hold 1 s to send the mount to its home position (needs an unparked mount). */
@action({ UUID: `${UUID}.home` })
export class HomeKey extends MountMoveKey {
	protected draw(s: NinaState, _settings: Settings, id: string): string {
		return renderHome(s, { holdFrac: this.hold.frac(id), pending: this.pendingLabel(id) });
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const a = ev.action;
		if (homePlan(state.mount) !== "home") {
			streamDeck.logger.warn(`Home not possible right now (${homePlan(state.mount)})`);
			return void (await a.showAlert());
		}
		this.startHold(a, () => void this.run(a, MOUNT_PATHS.home, "homing", () => true));
	}
}

/* ---------------- focuser ---------------- */

@action({ UUID: `${UUID}.focus` })
export class FocusPositionKey extends LiveKey {
	protected draw = (s: NinaState) => renderFocusPosition(s);
}

/** Autofocus started from this deck. Shared so the move keys can lock out while it runs. */
const af: { since?: number } = {};
const afRunning = () => af.since !== undefined;

/**
 * Nudges the focuser by the key's step size (set in its settings panel). Refused while the camera is exposing
 * (the frame would be ruined), while autofocus runs, or while the focuser is already moving. Verifies the position afterwards.
 */
abstract class FocusMoveKey extends LiveKey {
	protected abstract readonly dir: "in" | "out";
	private pendingUntil = new Map<string, number>();

	protected draw(s: NinaState, settings: Settings, id: string): string {
		const pending = (this.pendingUntil.get(id) ?? 0) > Date.now();
		return renderFocusMove(s, this.dir, stepsFrom(settings), { pending }, afRunning());
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const a = ev.action;
		const steps = stepsFrom(visible.get(a.id)?.settings);
		const plan = planFocusMove(state.focuser, afRunning());
		if (plan !== "move" || busyExposing()) {
			streamDeck.logger.warn(`Refused focus move (${plan}${busyExposing() ? ", camera exposing" : ""})`);
			return void (await a.showAlert());
		}
		const target = targetPosition(state.focuser!.position!, this.dir, steps);
		this.pendingUntil.set(a.id, Date.now() + 100_000);
		this.paint(a);
		const ok = await command(movePath(target), 15_000);
		// The API answers "Move started" at once, so wait for the focuser to arrive before checking the position.
		if (ok) {
			// done when the focuser has stopped and is at the target; if it never gets there, give up after the grace period
			const t0 = Date.now();
			await sleep(1500);
			for (;;) {
				await refreshEquipment();
				const f = state.focuser;
				const arrived = f?.position !== undefined && Math.abs(f.position - target) <= positionTolerance(steps);
				if (!f?.moving && (arrived || Date.now() - t0 > 8_000)) break;
				if (Date.now() - t0 > 90_000) break;
				this.paint(a);
				await sleep(1000);
			}
		} else await refreshEquipment();
		this.pendingUntil.delete(a.id);
		const pos = state.focuser?.position;
		if (!ok || pos === undefined || Math.abs(pos - target) > positionTolerance(steps)) {
			streamDeck.logger.warn(`Focus move to ${target} ${ok ? `ended at ${pos}` : "failed"}`);
			await a.showAlert();
		}
		this.paint(a);
	}
}

@action({ UUID: `${UUID}.focus-in` })
export class FocusInKey extends FocusMoveKey {
	protected readonly dir = "in" as const;
}

@action({ UUID: `${UUID}.focus-out` })
export class FocusOutKey extends FocusMoveKey {
	protected readonly dir = "out" as const;
}

/**
 * Autofocus: hold 1 s to start (refused while exposing); while running, hold 1 s to cancel.
 * The API has no "autofocus running" flag, so the deck tracks it: running from the start until the request returns
 * (if it blocks) or, if it returns at once, until the focuser and camera have been idle for 25 s.
 */
@action({ UUID: `${UUID}.autofocus` })
export class AutoFocusKey extends LiveKey {
	private static readonly IDLE_MS = 25_000;
	private static readonly MAX_MS = 20 * 60_000;
	private hold = new HoldTracker(1000);

	protected draw(s: NinaState, _settings: Settings, id: string): string {
		return renderAutoFocus(s, afRunning(), { holdFrac: this.hold.frac(id), elapsedS: af.since ? (Date.now() - af.since) / 1000 : 0 });
	}

	override onKeyDown(ev: KeyDownEvent): void {
		const a = ev.action;
		if (!state.focuser?.connected) return void a.showAlert();
		if (afRunning()) return this.hold.start(a.id, () => this.paint(a), () => void this.cancel(a));
		if (busyExposing()) {
			streamDeck.logger.warn("Refused autofocus: camera is exposing");
			return void a.showAlert();
		}
		this.hold.start(a.id, () => this.paint(a), () => void this.start(a));
	}

	override onKeyUp(ev: KeyUpEvent): void {
		this.hold.cancel(ev.action.id);
		if (ev.action.isKey()) this.paint(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.hold.cancel(ev.action.id);
		super.onWillDisappear(ev);
	}

	private async start(a: KeyAction): Promise<void> {
		const mine = Date.now();
		af.since = mine;
		this.paint(a);
		const ok = await command(autoFocusPath(), AutoFocusKey.MAX_MS);
		if (af.since !== mine) return; // cancelled meanwhile
		if (!ok) {
			af.since = undefined;
			streamDeck.logger.warn("Autofocus request failed");
			await a.showAlert();
			return void this.paint(a);
		}
		if (Date.now() - mine > 5000) af.since = undefined; // the call blocked until autofocus finished
		else {
			// returned at once: autofocus runs in the background; wait until nothing has moved or exposed for a while
			let lastActive = Date.now();
			while (af.since === mine && Date.now() - lastActive < AutoFocusKey.IDLE_MS && Date.now() - mine < AutoFocusKey.MAX_MS) {
				await sleep(2000);
				await refreshEquipment();
				if (state.focuser?.moving || state.camera?.isExposing) lastActive = Date.now();
			}
			if (af.since === mine) af.since = undefined;
		}
		await refreshEquipment();
		this.paint(a);
	}

	private async cancel(a: KeyAction): Promise<void> {
		af.since = undefined; // unlock the keys even if the cancel call fails; the log records it
		this.paint(a);
		if (!(await command(autoFocusPath(true), 15_000))) {
			streamDeck.logger.warn("Autofocus cancel failed (only an autofocus started through the API can be cancelled)");
			await a.showAlert();
		}
	}
}

/* ---------------- flat panel ---------------- */

/** Tap toggles the flat light. Switching it on is refused while the camera is exposing. */
@action({ UUID: `${UUID}.flat-light` })
export class FlatLightKey extends LiveKey {
	private pendingUntil = new Map<string, number>();

	protected draw(s: NinaState, _settings: Settings, id: string): string {
		return renderFlatLight(s, (this.pendingUntil.get(id) ?? 0) > Date.now());
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const a = ev.action;
		const plan = planLight(state.flat, busyExposing());
		if (plan === "unavailable" || plan === "refused") {
			streamDeck.logger.warn(`Flat light press ignored (${plan})`);
			return void (await a.showAlert());
		}
		const on = plan === "on";
		this.pendingUntil.set(a.id, Date.now() + 10_000);
		this.paint(a);
		const ok = await command(lightPath(on), 10_000);
		await sleep(800);
		await refreshEquipment();
		this.pendingUntil.delete(a.id);
		if (!ok || state.flat?.lightOn !== on) {
			streamDeck.logger.warn(`Flat light did not turn ${on ? "on" : "off"}`);
			await a.showAlert();
		}
		this.paint(a);
	}
}

/** Hold 1 s to open or close the flat panel cover (refused while exposing). Waits until the cover reports its new position. */
@action({ UUID: `${UUID}.flat-cover` })
export class FlatCoverKey extends LiveKey {
	private hold = new HoldTracker(1000);
	private pending = new Map<string, { label: string; until: number }>();

	protected draw(s: NinaState, _settings: Settings, id: string): string {
		const p = this.pending.get(id);
		return renderFlatCover(s, { holdFrac: this.hold.frac(id), pending: p && p.until > Date.now() ? p.label : undefined });
	}

	override onKeyDown(ev: KeyDownEvent): void {
		const a = ev.action;
		const plan = planCover(state.flat, busyExposing());
		if (plan === "unavailable" || plan === "refused") {
			streamDeck.logger.warn(`Flat cover press ignored (${plan})`);
			return void a.showAlert();
		}
		this.hold.start(a.id, () => this.paint(a), () => void this.move(a, plan));
	}

	override onKeyUp(ev: KeyUpEvent): void {
		this.hold.cancel(ev.action.id);
		if (ev.action.isKey()) this.paint(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.hold.cancel(ev.action.id);
		super.onWillDisappear(ev);
	}

	private async move(a: KeyAction, plan: "open" | "close"): Promise<void> {
		const want = plan === "open" ? "open" : "closed";
		this.pending.set(a.id, { label: plan === "open" ? "opening" : "closing", until: Date.now() + 90_000 });
		this.paint(a);
		let ok = await command(coverPath(plan === "close"), 15_000);
		if (ok) {
			const deadline = Date.now() + 60_000; // the cover takes a while; the API may answer before it arrives
			for (;;) {
				await sleep(1500);
				await refreshEquipment();
				ok = coverKind(state.flat) === want;
				if (ok || Date.now() > deadline) break;
				this.paint(a);
			}
		}
		this.pending.delete(a.id);
		if (!ok) {
			streamDeck.logger.warn(`Flat cover did not reach "${want}" (state: ${state.flat?.coverState})`);
			await a.showAlert();
		}
		this.paint(a);
	}
}

/** Tap sets the panel to this key's preset brightness (settings panel, default 50%). */
@action({ UUID: `${UUID}.flat-level` })
export class FlatLevelKey extends LiveKey {
	private pendingUntil = new Map<string, number>();

	protected draw(s: NinaState, settings: Settings, id: string): string {
		return renderFlatLevel(s, brightnessFrom(settings), (this.pendingUntil.get(id) ?? 0) > Date.now());
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const a = ev.action;
		const level = brightnessFrom(visible.get(a.id)?.settings);
		const plan = planBrightness(state.flat, busyExposing());
		if (plan !== "set") {
			streamDeck.logger.warn(`Flat brightness press ignored (${plan})`);
			return void (await a.showAlert());
		}
		this.pendingUntil.set(a.id, Date.now() + 10_000);
		this.paint(a);
		const ok = await command(brightnessPath(level), 10_000);
		await sleep(800);
		await refreshEquipment();
		this.pendingUntil.delete(a.id);
		const now = state.flat?.brightness;
		if (!ok || now === undefined || Math.abs(now - level) > 1) {
			streamDeck.logger.warn(`Flat brightness ${level}% not applied (now ${now})`);
			await a.showAlert();
		}
		this.paint(a);
	}
}

/* ---------------- switch panel ---------------- */

/**
 * One configurable key per switch (pick the switch in the key's settings panel). On/off switches: tap turns on, hold 1 s turns off
 * (it may be power for the camera or mount). Other switches set the value chosen in the panel.
 */
@action({ UUID: `${UUID}.switch` })
export class SwitchKey extends LiveKey {
	private hold = new HoldTracker(1000);
	private pendingUntil = new Map<string, number>();

	protected draw(s: NinaState, settings: Settings, id: string): string {
		return renderSwitch(s, settings, { holdFrac: this.hold.frac(id), pending: (this.pendingUntil.get(id) ?? 0) > Date.now() });
	}

	override onKeyDown(ev: KeyDownEvent): void {
		const a = ev.action;
		const cfg = settingsFrom(visible.get(a.id)?.settings);
		const plan = planSwitch(state.switches, cfg);
		if (plan.kind === "on" || plan.kind === "set") return void this.apply(a, cfg.switchId!, plan.value);
		if (plan.kind === "off") return this.hold.start(a.id, () => this.paint(a), () => void this.apply(a, cfg.switchId!, plan.value));
		streamDeck.logger.warn(`Switch press ignored (${plan.kind})`);
		void a.showAlert();
	}

	override onKeyUp(ev: KeyUpEvent): void {
		this.hold.cancel(ev.action.id);
		if (ev.action.isKey()) this.paint(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.hold.cancel(ev.action.id);
		super.onWillDisappear(ev);
	}

	private async apply(a: KeyAction, id: number, value: number): Promise<void> {
		this.pendingUntil.set(a.id, Date.now() + 25_000);
		this.paint(a);
		let ok = await command(switchPath(id, value), 10_000);
		if (ok) {
			// asynchronous drivers apply the value after answering, so give it up to ~10 seconds
			for (let i = 0; i < 14; i++) {
				await sleep(700);
				await refreshEquipment();
				const w = findSwitch(state.switches, id);
				ok = w?.value !== undefined && Math.abs(w.value - value) < 1e-6;
				if (ok) break;
			}
		}
		this.pendingUntil.delete(a.id);
		if (!ok) {
			streamDeck.logger.warn(`Switch ${id} did not reach ${value}`);
			await a.showAlert();
		}
		this.paint(a);
	}
}

/** The decorator only attaches the manifest UUID, so we can apply it by hand to stamp out one registered action per key. */
const stamp = <C extends new (...args: never[]) => SingletonAction>(uuid: string, cls: C) => action({ UUID: uuid })(cls as never, {} as ClassDecoratorContext) as unknown as C;

const TRACKING_MODES: [string, number][] = [
	["Sidereal", 0],
	["Lunar", 1],
	["Solar", 2],
	["King", 3],
	["Stopped", 4],
];

/** Actions that need constructor arguments (one instance per UUID). */
export function parameterizedActions(): SingletonAction[] {
	const out: SingletonAction[] = [];
	for (const [name, id] of TRACKING_MODES)
		out.push(new (stamp(`${UUID}.trk-${name.toLowerCase()}`, TrackingOptionKey) as unknown as new (mode: string, id: number, hold: boolean) => SingletonAction)(name, id, name === "Stopped"));
	return out;
}
