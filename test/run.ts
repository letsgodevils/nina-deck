import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { NinaState } from "../src/core/store.js";

const real = JSON.parse(readFileSync(new URL("./fixtures/real.json", import.meta.url), "utf8"));
const OUT = "/tmp/previews";
mkdirSync(OUT, { recursive: true });

/** .NET-style timestamp with 7 fractional digits and a local offset, like the real camera/info response. */
function netDate(ms: number): string {
	const d = new Date(ms - 7 * 3600_000); // fake UTC-07:00
	return d.toISOString().replace("Z", "").replace(/\.(\d{3})$/, ".$10000") + "-07:00";
}

// Guider/info and filterwheel/info were NOT in the user's capture, so these are synthetic.
const synthGuiderInfo = { Response: { Connected: true, State: "Guiding" }, Success: true, StatusCode: 200 };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// Filterwheel/info matches the user's real response (Alpaca simulator wheel); we just make "selected" mutable.
const FILTERS = real["/equipment/filterwheel/info"].Response.AvailableFilters as { Name: string; Id: number }[];
const synthFilterInfo = (selected: string, moving = false) => {
	const r = clone(real["/equipment/filterwheel/info"]);
	r.Response.SelectedFilter = FILTERS.find((f) => f.Name === selected);
	r.Response.IsMoving = moving;
	return r;
};
let mockFilter = "l";
// 0 Sidereal, 1 Lunar, 2 Solar, 3 King, 4 Stopped: confirmed on the user's simulator mount (mode=4 -> TrackingMode "Stopped").
const MODE_NAMES = ["Sidereal", "Lunar", "Solar", "King", "Stopped"];
let mockTracking = "Stopped";
const coolerCalls: string[] = [];

/* ---------- 1. run the real pollers against a mock server serving the user's real JSON ---------- */
const exposureEnd = Date.now() + 42_000;
const server = createServer((req, res) => {
	const path = (req.url ?? "").replace("/v2/api", "");
	let body: unknown;
	if (path === "/equipment/camera/info") {
		body = clone(real[path]);
		(body as any).Response.ExposureEndTime = netDate(exposureEnd);
	} else if (path === "/equipment/guider/info") body = synthGuiderInfo;
	else if (path.startsWith("/equipment/camera/cool") || path.startsWith("/equipment/camera/warm")) {
		coolerCalls.push(path);
		body = { Response: "ok", Success: true, StatusCode: 200 };
	} else if (path === "/equipment/filterwheel/info") body = synthFilterInfo(mockFilter);
	else if (path.startsWith("/equipment/filterwheel/change-filter")) {
		const id = Number(new URL(req.url!, "http://x").searchParams.get("filterId"));
		const f = FILTERS.find((x) => x.Id === id);
		if (f) mockFilter = f.Name;
		body = f ? { Response: "Filter changed", Success: true, StatusCode: 200 } : { Response: "x", Error: "Filter not available", Success: false, StatusCode: 409 };
	} else if (path.startsWith("/equipment/mount/tracking")) {
		const id = Number(new URL(req.url!, "http://x").searchParams.get("mode"));
		const name = MODE_NAMES[id];
		if (name) mockTracking = name;
		body = name ? { Response: "Tracking mode changed", Success: true, StatusCode: 200 } : { Response: "x", Error: "Invalid tracking mode", Success: false, StatusCode: 409 };
	} else if (path === "/equipment/mount/info") {
		body = clone(real[path]);
		(body as any).Response.TrackingMode = mockTracking;
		(body as any).Response.TrackingEnabled = mockTracking !== "Stopped";
	} else if (path === "/sequence/start" || path === "/sequence/stop") body = { Response: "ok", Success: true, StatusCode: 200 };
	else if (real[path]) body = real[path];
	else {
		res.statusCode = 404;
		res.end("{}");
		return;
	}
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(body));
});
await new Promise<void>((r) => server.listen(18888, r));
process.env.NINA_BASE = "http://localhost:18888/v2/api";

const { state, startPolling, stopPolling, command } = await import("../src/core/store.js");
const P = await import("../src/core/parse.js");
const R = await import("../src/core/render.js");

startPolling();
await new Promise((r) => setTimeout(r, 2500));

console.log("--- polled state from REAL fixtures ---");
console.log(JSON.stringify(state, null, 1));

assert.equal(state.apiUp, true);
assert.equal(state.camera?.connected, true);
assert.equal(state.camera?.isExposing, true);
assert.ok(Math.abs((state.camera!.exposureEndMs! - exposureEnd)) < 5, "7-digit .NET date parsed to the right ms");
assert.equal(state.camera?.tempC, undefined, '"NaN" temperature becomes undefined');
assert.equal(state.mount?.tracking, false);
assert.equal(state.mount?.flipHours, 24);
assert.equal(state.sequence?.running, true);
assert.equal(state.sequence?.target, undefined);
assert.equal(state.sequence?.nextTarget, "M 42 Panel 1");
assert.deepEqual(state.sequence?.exposure, { name: "Smart Exposure", durationS: 60, completed: 0, total: 50, filter: undefined });
assert.equal(state.guider?.connected, true);
assert.equal(state.guider?.hasData, false);
assert.equal(await command("/sequence/start"), true);
assert.equal(await command("/nope"), false);
console.log("real-fixture assertions passed");

// --- filter wheel + tracking (synthetic wheel schema; real mount fields) ---
const { refreshEquipment } = await import("../src/core/store.js");
assert.equal(state.filterWheel?.connected, true);
assert.equal(state.filterWheel?.filters.length, 6);
assert.equal(state.filterWheel?.moving, false);
assert.deepEqual(state.filterWheel?.selected, { id: 0, name: "l" });
assert.equal(state.mount?.trackingMode, "Stopped");
assert.equal(await command("/equipment/filterwheel/change-filter?filterId=3"), true);
assert.equal(await command("/equipment/filterwheel/change-filter?filterId=99"), false);
await refreshEquipment();
assert.deepEqual(state.filterWheel?.selected, { id: 3, name: "B" });
assert.equal(await command("/equipment/mount/tracking?mode=1"), true);
await refreshEquipment();
assert.equal(state.mount?.trackingMode, "Lunar");
assert.equal(state.mount?.tracking, true);
assert.equal(await command("/equipment/mount/tracking?mode=4"), true);
await refreshEquipment();
assert.equal(state.mount?.trackingMode, "Stopped");
assert.equal(state.mount?.tracking, false);
mockFilter = "l";
mockTracking = "Stopped";
// schema tolerance: strings, name-only selection, garbage, not-connected
assert.deepEqual(P.parseFilterWheel({ Response: { Connected: true, AvailableFilters: ["L", "R"], SelectedFilter: "R" } }), { connected: true, moving: false, filters: [{ id: 0, name: "L" }, { id: 1, name: "R" }], selected: { id: 1, name: "R" } });
assert.equal(P.parseFilterWheel({ Response: "Filterwheel not connected" }).connected, false);
assert.equal(P.parseFilterWheel(undefined).filters.length, 0);
assert.deepEqual(P.resolveFilter(state.filterWheel, { filterName: "G" }), { id: 2, name: "G" });
assert.equal(P.resolveFilter(state.filterWheel, { filterName: "Nope" }), undefined);
assert.equal(P.resolveFilter(state.filterWheel, {}), undefined);
assert.equal(P.resolveFilter({ connected: false, moving: false, filters: [] }, { filterName: "G" }), undefined);
console.log("filter wheel / tracking assertions passed");

// --- sensor cooling ---
const C = await import("../src/core/cooler.js");
assert.equal(state.camera?.canSetTemperature, false, "real simulator camera cannot set temperature");
assert.equal(C.coolerPhase(state.camera, false), "nocooler");
assert.equal(C.coolerPhase(undefined, false), "nocam");
const cam0 = state.camera!;
const withCooler = (o: Partial<typeof cam0>) => ({ ...cam0, canSetTemperature: true, ...o });
assert.equal(C.coolerPhase(withCooler({ coolerOn: false }), false), "off");
assert.equal(C.coolerPhase(withCooler({ coolerOn: true, atTargetTemp: false }), false), "cooling");
assert.equal(C.coolerPhase(withCooler({ coolerOn: true, atTargetTemp: true }), false), "cooled");
assert.equal(C.coolerPhase(withCooler({ coolerOn: true, atTargetTemp: true }), true), "warming");
assert.equal(C.coolerPhase(withCooler({ coolerOn: false }), true), "off", "warming flag ignored once the cooler is off");
assert.deepEqual(["nocam", "nocooler", "off", "cooling", "cooled", "warming"].map((p) => C.planCooler(p as any)), ["unavailable", "unavailable", "cool", "warm", "warm", "cancel-warm"]);
assert.equal(C.coolPath(-10), "/equipment/camera/cool?temperature=-10&minutes=-1");
assert.equal(C.coolPath(-12.5), "/equipment/camera/cool?temperature=-12.5&minutes=-1");
assert.equal(C.warmPath(), "/equipment/camera/warm?minutes=-1");
assert.equal(C.warmPath(true), "/equipment/camera/warm?minutes=-1&cancel=true");
assert.equal(C.targetTempFrom({ targetTemp: -15 }), -15);
assert.equal(C.targetTempFrom({ targetTemp: "-5" }), -5);
assert.equal(C.targetTempFrom({ targetTemp: 999 }), -10);
assert.equal(C.targetTempFrom({ targetTemp: "abc" }), -10);
assert.equal(C.targetTempFrom(undefined), -10);
assert.equal(await command(C.coolPath(-10)), true);
assert.equal(await command(C.warmPath(true)), true);
assert.deepEqual(coolerCalls, ["/equipment/camera/cool?temperature=-10&minutes=-1", "/equipment/camera/warm?minutes=-1&cancel=true"]);

// --- hold timer ---
const { HoldTracker } = await import("../src/core/hold.js");
{
	const h = new HoldTracker(120, 10);
	let done = 0;
	h.start("k", () => {}, () => done++);
	await new Promise((r) => setTimeout(r, 60));
	assert.ok(h.frac("k") > 0.2 && h.frac("k") < 0.9, `mid-hold frac ${h.frac("k")}`);
	h.cancel("k");
	await new Promise((r) => setTimeout(r, 150));
	assert.equal(done, 0, "released early: no action");
	assert.equal(h.frac("k"), 0);
	h.start("k", () => {}, () => done++);
	await new Promise((r) => setTimeout(r, 220));
	assert.equal(done, 1, "held long enough: fires exactly once");
	assert.equal(h.frac("k"), 0, "resets after firing");
}
console.log("cooler / hold assertions passed");

const keys = (s: NinaState, now = Date.now()) => ({
	"1-exposure": R.renderExposure(s, now),
	"2-frames": R.renderFrames(s),
	"3-target": R.renderTarget(s),
	"4-guiding": R.renderGuiding(s),
	"5-camera": R.renderCamera(s),
	"6-mount": R.renderMount(s),
	"7-status": R.renderStatus(s),
	"8-start": R.renderStart(s),
	"9-stop": R.renderStop(s),
});
const dump = (scenario: string, s: NinaState, now = Date.now()) => {
	for (const [k, svg] of Object.entries(keys(s, now))) writeFileSync(`${OUT}/${scenario}_${k}.svg`, svg);
};

const extras = (scenario: string, s: NinaState, pendingSlot = -1) => {
	const out: Record<string, string> = {
		"a-filter": R.renderFilterCurrent(s),
		...Object.fromEntries(["l", "R", "G", "B", "Nope"].map((n, i) => [`b${i}-slot`, R.renderFilterKey(s, n, i === pendingSlot)])),
		"b9-unset": R.renderFilterKey(s, undefined),
		"c-tracking": R.renderTrackingCurrent(s),
		...Object.fromEntries(["Sidereal", "Lunar", "Solar", "King", "Stopped"].map((m, i) => [`d${i}-trk`, R.renderTrackingOption(s, m, false)])),
	};
	for (const [k, svg] of Object.entries(out)) writeFileSync(`${OUT}/X-${scenario}_${k}.svg`, svg);
};

dump("A-real-snapshot", structuredClone(state));

/* ---------- 2. synthetic mid-session scenario built by mutating the real fixtures ---------- */
const seq = clone(real["/sequence/json"]);
const targets = seq.Response.find((n: any) => n.Name === "Targets_Container");
targets.Items[2].Status = "RUNNING"; // "M 42 Panel 3" running
targets.Items[2].Items = [{ Status: "RUNNING", Name: "Smart Exposure", Type: "LIGHT", ExposureTime: 180, Iterations: 50, CompletedIterations: 12, Filter: "Ha" }];
targets.Items[0].Status = "FINISHED";
targets.Items[1].Status = "FINISHED";
seq.Response[1].Status = "FINISHED";
seq.Response[1].Items[0].Status = "FINISHED";
targets.Status = "RUNNING";

const cam = clone(real["/equipment/camera/info"]);
const now = Date.now();
Object.assign(cam.Response, { Temperature: -10.1, CoolerOn: true, CoolerPower: 63.2, AtTargetTemp: true, IsExposing: true, ExposureEndTime: netDate(now + 95_000) });
const graph = clone(real["/equipment/guider/graph"]);
Object.assign(graph.Response.RMS, { DataPoints: 100, Total: 0.62, RA: 0.41, Dec: 0.47, Scale: 1.5, TotalText: 'Tot: 0.62 (0.93")', RAText: 'RA: 0.41 (0.62")', DecText: 'Dec: 0.47 (0.71")' });
const mnt = clone(real["/equipment/mount/info"]);
Object.assign(mnt.Response, { TrackingEnabled: true, AtPark: false, TimeToMeridianFlip: 1.7, Altitude: 52.3 });

const mid: NinaState = {
	apiUp: true,
	lastOkMs: now,
	camera: P.parseCamera(cam),
	guider: { ...P.parseGuiderInfo(synthGuiderInfo), ...P.parseGuiderGraph(graph) },
	mount: P.parseMount(mnt),
	sequence: P.parseSequence(seq),
	filterWheel: P.parseFilterWheel(synthFilterInfo("H")),
};
assert.equal(mid.sequence?.target, "M 42 Panel 3");
assert.deepEqual(mid.sequence?.exposure, { name: "Smart Exposure", durationS: 180, completed: 12, total: 50, filter: "Ha" });
assert.equal(mid.guider?.totalArcsec, 0.93);
assert.equal(mid.guider?.raArcsec, 0.62);
assert.equal(mid.camera?.tempC, -10.1);
assert.equal(R.fmtDuration(95), "1:35");
assert.equal(R.fmtDuration(3725), "1:02:05");
assert.equal(R.fmtHM(0.12 * 3600), "0:07");
assert.equal(R.fmtHM(1.7 * 3600), "1:42");
dump("B-mid-session", mid, now);

// bad guiding + near flip + exposure finishing/readout
const bad = structuredClone(mid);
bad.guider = { ...bad.guider!, totalArcsec: 2.1, raArcsec: 1.8, decArcsec: 1.1, state: "Guiding" };
bad.mount = { ...bad.mount!, flipHours: 0.12 };
bad.camera = { ...bad.camera!, exposureEndMs: now - 500 };
dump("C-bad-guiding-readout", bad, now);

// long target name wrapping + no sequence-derived data + guider lost
const odd = structuredClone(mid);
odd.sequence = { running: true, target: "NGC 7000 North America Nebula Mosaic Panel 12", exposure: undefined };
odd.guider = { connected: false, hasData: false };
dump("D-long-name-no-guider", odd, now);

extras("1-mid", mid, 3);
extras("2-real-no-wheel", { ...structuredClone(state), filterWheel: undefined });
extras("3-offline", { apiUp: false, lastOkMs: 0 });
const solar = structuredClone(mid);
solar.mount = { ...solar.mount!, trackingMode: "Solar", atPark: false };
solar.filterWheel = P.parseFilterWheel(synthFilterInfo("S"));
extras("4-solar-sii", solar);
const sel = (name: string | undefined, st: NinaState, pend = false) => R.renderFilterKey(st, name, pend);
const nowheel = { ...structuredClone(mid), filterWheel: undefined };
const row = { "s0-unset": sel(undefined, mid), "s1-idle": sel("R", mid), "s2-active": sel("H", mid), "s3-pending": sel("B", mid, true), "s4-missing": sel("Ha", mid), "s5-nowheel": sel("R", nowheel), "s6-offline": sel("R", { apiUp: false, lastOkMs: 0 }) };
for (const [k, svg] of Object.entries(row)) writeFileSync(`${OUT}/Y-${k}.svg`, svg);
const stopped = structuredClone(mid);
stopped.mount = { ...stopped.mount!, trackingMode: "Stopped", tracking: false };
for (const [k, svg] of Object.entries({ "t0-idle": R.renderTrackingOption(mid, "Stopped"), "t1-hold": R.renderTrackingOption(mid, "Stopped", false, 0.6), "t2-pending": R.renderTrackingOption(mid, "Stopped", true), "t3-active": R.renderTrackingOption(stopped, "Stopped"), "t4-cur": R.renderTrackingCurrent(stopped), "t5-offline": R.renderTrackingOption({ apiUp: false, lastOkMs: 0 }, "Stopped") })) writeFileSync(`${OUT}/Z-${k}.svg`, svg);
{
	const camBase = { ...mid.camera!, canSetTemperature: true, tempC: -10.1, coolerPower: 63.2 };
	const st = (o: Partial<typeof camBase>): NinaState => ({ ...mid, camera: { ...camBase, ...o } });
	const rows: Record<string, string> = {
		"c0-off": R.renderCooler(st({ coolerOn: false, tempC: 21.4 }), "off", -10),
		"c1-cooling": R.renderCooler(st({ coolerOn: true, atTargetTemp: false, tempC: -3.2 }), "cooling", -10),
		"c2-cooled": R.renderCooler(st({ coolerOn: true, atTargetTemp: true }), "cooled", -10),
		"c3-warming": R.renderCooler(st({ coolerOn: true, tempC: -6 }), "warming", -10),
		"c4-hold": R.renderCooler(st({ coolerOn: true, atTargetTemp: true }), "cooled", -10, { holdFrac: 0.6 }),
		"c5-pending": R.renderCooler(st({ coolerOn: false }), "off", -10, { pending: true }),
		"c6-nocooler": R.renderCooler(structuredClone(state), "nocooler", -10),
		"c7-nocam": R.renderCooler({ ...mid, camera: undefined }, "nocam", -10),
	};
	for (const [k, svg] of Object.entries(rows)) writeFileSync(`${OUT}/W-${k}.svg`, svg);
}
const moving = structuredClone(mid);
moving.filterWheel = P.parseFilterWheel(synthFilterInfo("R", true));
assert.equal(moving.filterWheel.moving, true);
extras("5-moving", moving, 3);

// ---- park / home ----
{
	const M = await import("../src/core/mountcmd.js");
	const mk = (o: Record<string, unknown>) => P.parseMount({ Response: { Connected: true, AtPark: false, AtHome: false, CanPark: true, CanFindHome: true, Slewing: false, ...o }, Success: true } as any);
	// parse: flags come through, and missing capability flags default to "supported"
	const base = mk({});
	assert.equal(base.atHome, false);
	assert.equal(base.canPark, true);
	assert.equal(mk({ AtHome: true }).atHome, true);
	assert.equal(mk({ CanPark: false }).canPark, false);
	assert.equal(mk({ CanFindHome: false }).canFindHome, false);
	// paths
	assert.equal(M.MOUNT_PATHS.park, "/equipment/mount/park");
	assert.equal(M.MOUNT_PATHS.unpark, "/equipment/mount/unpark");
	assert.equal(M.MOUNT_PATHS.home, "/equipment/mount/home");
	// plans
	assert.equal(M.parkPlan(undefined), "unavailable");
	assert.equal(M.parkPlan(base), "park");
	assert.equal(M.parkPlan(mk({ AtPark: true })), "unpark");
	assert.equal(M.parkPlan(mk({ CanPark: false })), "unavailable");
	assert.equal(M.parkPlan(mk({ Connected: false })), "unavailable");
	assert.equal(M.homePlan(base), "home");
	assert.equal(M.homePlan(mk({ AtPark: true })), "parked");
	assert.equal(M.homePlan(mk({ CanFindHome: false })), "unavailable");
	// previews
	const withMount = (m: any) => ({ ...mid, mount: m });
	const rows: Record<string, string> = {
		"p0-park": R.renderPark(withMount(base)),
		"p1-hold": R.renderPark(withMount(base), { holdFrac: 0.6 }),
		"p2-pending": R.renderPark(withMount(base), { pending: "parking" }),
		"p3-parked": R.renderPark(withMount(mk({ AtPark: true }))),
		"p4-nopark": R.renderPark(withMount(mk({ CanPark: false }))),
		"p5-nomount": R.renderPark(withMount(mk({ Connected: false }))),
		"h0-home": R.renderHome(withMount(base)),
		"h1-hold": R.renderHome(withMount(base), { holdFrac: 0.6 }),
		"h2-pending": R.renderHome(withMount(base), { pending: "homing" }),
		"h3-athome": R.renderHome(withMount(mk({ AtHome: true }))),
		"h4-parked": R.renderHome(withMount(mk({ AtPark: true }))),
		"h5-nohome": R.renderHome(withMount(mk({ CanFindHome: false }))),
		"h6-offline": R.renderHome({ apiUp: false, lastOkMs: 0 }),
	};
	for (const [k, svg] of Object.entries(rows)) {
		assert.ok(svg.startsWith("<svg") || svg.startsWith("data:") || svg.includes("<svg"), k);
		writeFileSync(`${OUT}/V-${k}.svg`, svg);
	}
	assert.ok(rows["p3-parked"].includes("PARKED"));
	assert.ok(rows["h4-parked"].includes("unpark first"));
	assert.ok(rows["h3-athome"].includes("AT HOME"));
}

// ---- focuser ----
{
	const F = await import("../src/core/focus.js");
	const mkF = (o: Record<string, unknown>) => P.parseFocuser({ Response: { Connected: true, Position: 12345, StepSize: 4, Temperature: 18.46, IsMoving: false, IsSettling: false, ...o }, Success: true } as any);
	const f = mkF({});
	assert.equal(f.position, 12345);
	assert.equal(f.tempC, 18.46);
	assert.equal(f.moving, false);
	assert.equal(mkF({ IsSettling: true }).moving, true, "settling counts as moving");
	assert.equal(mkF({ Position: "NaN" }).position, undefined);
	assert.equal(P.parseFocuser({ Success: false } as any).connected, false);
	// settings -> steps
	assert.equal(F.stepsFrom(undefined), 100);
	assert.equal(F.stepsFrom({ steps: 250 }), 250);
	assert.equal(F.stepsFrom({ steps: "40" }), 40);
	for (const bad of [0, -1, 2.5, 1e6, "x", null]) assert.equal(F.stepsFrom({ steps: bad }), 100);
	// targets and paths
	assert.equal(F.targetPosition(1000, "out", 100), 1100);
	assert.equal(F.targetPosition(1000, "in", 100), 900);
	assert.equal(F.targetPosition(50, "in", 100), 0, "never below zero");
	assert.equal(F.movePath(900.4), "/equipment/focuser/move?position=900");
	assert.equal(F.autoFocusPath(), "/equipment/focuser/auto-focus");
	assert.equal(F.autoFocusPath(true), "/equipment/focuser/auto-focus?cancel=true");
	assert.equal(F.positionTolerance(100), 5);
	assert.equal(F.positionTolerance(10), 2);
	// plans
	assert.equal(F.planFocusMove(undefined, false), "unavailable");
	assert.equal(F.planFocusMove(mkF({ Connected: false }), false), "unavailable");
	assert.equal(F.planFocusMove(f, false), "move");
	assert.equal(F.planFocusMove(f, true), "busy");
	assert.equal(F.planFocusMove(mkF({ IsMoving: true }), false), "busy");
	assert.equal(F.autoFocusPhase(f, false), "idle");
	assert.equal(F.autoFocusPhase(f, true), "running");
	assert.equal(F.autoFocusPhase(undefined, false), "nofocuser");
	// previews
	const withF = (x: any) => ({ ...mid, focuser: x });
	const rows: Record<string, string> = {
		"f0-pos": R.renderFocusPosition(withF(f)),
		"f1-pos-moving": R.renderFocusPosition(withF(mkF({ IsMoving: true }))),
		"f2-pos-big": R.renderFocusPosition(withF(mkF({ Position: 123456 }))),
		"f3-none": R.renderFocusPosition(withF(mkF({ Connected: false }))),
		"i0-in": R.renderFocusMove(withF(f), "in", 100),
		"i1-out": R.renderFocusMove(withF(f), "out", 2500),
		"i2-pending": R.renderFocusMove(withF(f), "out", 100, { pending: true }),
		"i3-af-lock": R.renderFocusMove(withF(f), "in", 100, {}, true),
		"a0-idle": R.renderAutoFocus(withF(f), false),
		"a1-hold": R.renderAutoFocus(withF(f), false, { holdFrac: 0.6 }),
		"a2-running": R.renderAutoFocus(withF(f), true, { elapsedS: 95 }),
		"a3-cancel": R.renderAutoFocus(withF(f), true, { holdFrac: 0.5 }),
		"a4-none": R.renderAutoFocus(withF(mkF({ Connected: false })), false),
		"a5-offline": R.renderAutoFocus({ apiUp: false, lastOkMs: 0 }, false),
	};
	for (const [k, svg] of Object.entries(rows)) {
		assert.ok(svg.includes("<svg"), k);
		writeFileSync(`${OUT}/U-${k}.svg`, svg);
	}
	assert.ok(rows["f0-pos"].includes("12345") && rows["f0-pos"].includes("18.5"));
	assert.ok(rows["i0-in"].includes("−100") && rows["i1-out"].includes("+2500"));
	assert.ok(rows["a2-running"].includes("RUNNING") && rows["a2-running"].includes("1:35"));
}

// ---- flat panel + switches ----
{
	const FL = await import("../src/core/flat.js");
	const SW = await import("../src/core/switches.js");
	const mkFlat = (o: Record<string, unknown>) => P.parseFlat({ Response: { Connected: true, CoverState: "Open", LightOn: false, Brightness: 30, SupportsOpenClose: true, SupportsOnOff: true, ...o }, Success: true } as any);
	const flat = mkFlat({});
	assert.equal(flat.lightOn, false);
	assert.equal(flat.brightness, 30);
	assert.equal(P.parseFlat({ Success: false } as any).connected, false);
	// paths
	assert.equal(FL.lightPath(true), "/equipment/flatdevice/set-light?on=true");
	assert.equal(FL.lightPath(false), "/equipment/flatdevice/set-light?on=false");
	assert.equal(FL.coverPath(true), "/equipment/flatdevice/set-cover?closed=true");
	assert.equal(FL.brightnessPath(42.4), "/equipment/flatdevice/set-brightness?brightness=42");
	// settings
	assert.equal(FL.brightnessFrom(undefined), 50);
	assert.equal(FL.brightnessFrom({ brightness: 0 }), 0);
	assert.equal(FL.brightnessFrom({ brightness: "75" }), 75);
	for (const bad of [-1, 101, 2.5, "x", null]) assert.equal(FL.brightnessFrom({ brightness: bad }), 50);
	// cover state
	for (const [raw, kind] of [["Open", "open"], ["Closed", "closed"], ["NeitherOpenNorClosed", "moving"], ["Error", "error"], ["Unknown", "unknown"], ["NotPresent", "unknown"]] as const) assert.equal(FL.coverKind(mkFlat({ CoverState: raw })), kind, raw);
	// plans
	assert.equal(FL.planLight(undefined, false), "unavailable");
	assert.equal(FL.planLight(flat, false), "on");
	assert.equal(FL.planLight(flat, true), "refused", "light on while exposing is refused");
	assert.equal(FL.planLight(mkFlat({ LightOn: true }), true), "off", "turning off is always allowed");
	assert.equal(FL.planLight(mkFlat({ SupportsOnOff: false }), false), "unavailable");
	assert.equal(FL.planCover(flat, false), "close");
	assert.equal(FL.planCover(mkFlat({ CoverState: "Closed" }), false), "open");
	assert.equal(FL.planCover(mkFlat({ CoverState: "Unknown" }), false), "open");
	assert.equal(FL.planCover(mkFlat({ CoverState: "NeitherOpenNorClosed" }), false), "unavailable");
	assert.equal(FL.planCover(flat, true), "refused");
	assert.equal(FL.planCover(mkFlat({ SupportsOpenClose: false }), false), "unavailable");
	assert.equal(FL.planBrightness(flat, true), "set", "light off: fine while exposing");
	assert.equal(FL.planBrightness(mkFlat({ LightOn: true }), true), "refused");
	// switches
	const mkSw = (writable: any[], readonly: any[] = []) => P.parseSwitches({ Response: { Connected: true, WritableSwitches: writable, ReadonlySwitches: readonly }, Success: true } as any);
	const sw = mkSw(
		[
			{ Id: 0, Name: "Dew heater", Value: 0, TargetValue: 0, Minimum: 0, Maximum: 1, StepSize: 1 },
			{ Id: 1, Name: "Fan", Value: 20, Minimum: 0, Maximum: 100, StepSize: 1 },
			{ Id: 2, Name: "Mount power", Value: 1, Minimum: 0, Maximum: 1, StepSize: 1 },
		],
		[{ Id: 3, Name: "Voltage", Value: 12 }],
	);
	assert.equal(sw.switches.length, 4);
	assert.equal(sw.switches[3].writable, false);
	assert.equal(P.parseSwitches({ Response: { Connected: true, WritableSwitches: [{ Id: 5 }] } } as any).switches[0].name, "Switch 5");
	assert.equal(SW.switchPath(2, 0), "/equipment/switch/set?index=2&value=0");
	assert.deepEqual(SW.settingsFrom({ switchId: "3", setValue: "40" }), { switchId: 3, setValue: 40 });
	assert.deepEqual(SW.settingsFrom({ switchId: 1.5 }), { switchId: undefined, setValue: undefined });
	assert.equal(SW.isBinary(sw.switches[0]), true);
	assert.equal(SW.isBinary(sw.switches[1]), false);
	assert.deepEqual(SW.planSwitch(undefined, {}), { kind: "unavailable" });
	assert.deepEqual(SW.planSwitch(sw, {}), { kind: "noselection" });
	assert.deepEqual(SW.planSwitch(sw, { switchId: 9 }), { kind: "unavailable" });
	assert.deepEqual(SW.planSwitch(sw, { switchId: 3 }), { kind: "readonly" });
	assert.deepEqual(SW.planSwitch(sw, { switchId: 0 }), { kind: "on", value: 1 });
	assert.deepEqual(SW.planSwitch(sw, { switchId: 2 }), { kind: "off", value: 0 }, "turning off an on switch");
	assert.deepEqual(SW.planSwitch(sw, { switchId: 1 }), { kind: "needsvalue" });
	assert.deepEqual(SW.planSwitch(sw, { switchId: 1, setValue: 150 }), { kind: "needsvalue" }, "out of range");
	assert.deepEqual(SW.planSwitch(sw, { switchId: 1, setValue: 60 }), { kind: "set", value: 60 });
	// previews
	const withAll = (f: any, st: any) => ({ ...mid, flat: f, switches: st });
	const rows: Record<string, string> = {
		"l0-off": R.renderFlatLight(withAll(flat, sw)),
		"l1-on": R.renderFlatLight(withAll(mkFlat({ LightOn: true, Brightness: 65 }), sw)),
		"l2-pending": R.renderFlatLight(withAll(flat, sw), true),
		"l3-none": R.renderFlatLight(withAll(mkFlat({ Connected: false }), sw)),
		"c0-open": R.renderFlatCover(withAll(flat, sw)),
		"c1-closed": R.renderFlatCover(withAll(mkFlat({ CoverState: "Closed" }), sw)),
		"c2-moving": R.renderFlatCover(withAll(mkFlat({ CoverState: "NeitherOpenNorClosed" }), sw)),
		"c3-hold": R.renderFlatCover(withAll(flat, sw), { holdFrac: 0.6 }),
		"c4-pending": R.renderFlatCover(withAll(flat, sw), { pending: "closing" }),
		"c5-unknown": R.renderFlatCover(withAll(mkFlat({ CoverState: "Unknown" }), sw)),
		"c6-nocover": R.renderFlatCover(withAll(mkFlat({ SupportsOpenClose: false }), sw)),
		"b0-level": R.renderFlatLevel(withAll(flat, sw), 50),
		"b1-current": R.renderFlatLevel(withAll(flat, sw), 30),
		"b2-pending": R.renderFlatLevel(withAll(flat, sw), 80, true),
		"s0-off": R.renderSwitch(withAll(flat, sw), { switchId: 0 }),
		"s1-on": R.renderSwitch(withAll(flat, sw), { switchId: 2 }),
		"s2-holdoff": R.renderSwitch(withAll(flat, sw), { switchId: 2 }, { holdFrac: 0.5 }),
		"s3-value": R.renderSwitch(withAll(flat, sw), { switchId: 1, setValue: 60 }),
		"s4-valuecur": R.renderSwitch(withAll(flat, sw), { switchId: 1, setValue: 20 }),
		"s5-needsvalue": R.renderSwitch(withAll(flat, sw), { switchId: 1 }),
		"s6-readonly": R.renderSwitch(withAll(flat, sw), { switchId: 3 }),
		"s7-pick": R.renderSwitch(withAll(flat, sw), {}),
		"s8-missing": R.renderSwitch(withAll(flat, sw), { switchId: 9 }),
		"s9-none": R.renderSwitch(withAll(flat, undefined), { switchId: 0 }),
		"s10-longname": R.renderSwitch(withAll(flat, mkSw([{ Id: 0, Name: "Primary Camera Power Outlet", Value: 1, Minimum: 0, Maximum: 1, StepSize: 1 }])), { switchId: 0 }),
	};
	for (const [k, svg] of Object.entries(rows)) {
		assert.ok(svg.includes("<svg"), k);
		writeFileSync(`${OUT}/S-${k}.svg`, svg);
	}
	assert.ok(rows["l1-on"].includes("65%") && rows["l1-on"].includes(">ON<"));
	assert.ok(rows["c5-unknown"].includes("UNKNOWN"));
	assert.ok(rows["s7-pick"].includes("PICK ONE") && rows["s8-missing"].includes("MISSING"));
	assert.ok(rows["s10-longname"].includes("…"), "long switch names are clipped");
}

// ---- real flat panel + switch responses (user's ASCOM simulators) ----
{
	const SW = await import("../src/core/switches.js");
	const FL = await import("../src/core/flat.js");
	const real = JSON.parse(readFileSync(new URL("./fixtures/flat-switch.json", import.meta.url), "utf8"));
	const f = P.parseFlat(real.flat);
	assert.equal(f.connected, true);
	assert.equal(f.coverState, "Closed");
	assert.equal(f.brightness, 0);
	assert.equal(FL.planCover(f, false), "open");
	assert.equal(FL.planLight(f, false), "on");
	const st = P.parseSwitches(real.switch);
	assert.equal(st.switches.length, 10);
	assert.deepEqual(st.switches.filter((w) => w.writable).map((w) => w.id), [0, 1, 2, 3]);
	assert.equal(SW.isBinary(st.switches[0]), true);
	assert.equal(SW.isBinary(st.switches[1]), true);
	assert.equal(SW.isBinary(st.switches[2]), false, "0-100 step 10 is a ranged switch");
	assert.equal(SW.isBinary(st.switches[3]), false);
	assert.deepEqual(SW.planSwitch(st, { switchId: 1 }), { kind: "on", value: 1 });
	assert.deepEqual(SW.planSwitch(st, { switchId: 2, setValue: 50 }), { kind: "set", value: 50 });
	assert.deepEqual(SW.planSwitch(st, { switchId: 3, setValue: 300 }), { kind: "needsvalue" });
	assert.deepEqual(SW.planSwitch(st, { switchId: 7 }), { kind: "readonly" });
	console.log("real flat/switch fixtures passed");
}

// N.I.N.A. not running
stopPolling();
server.close();
dump("E-offline", { apiUp: false, lastOkMs: 0 }, now);
console.log("synthetic scenarios rendered to", OUT);
process.exit(0);
