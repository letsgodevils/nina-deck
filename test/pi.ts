// Runs the real, bundled settings panel (ui/filter.html + ui/filter.js, which includes Elgato's own browser SDK)
// in jsdom, against a fake Stream Deck websocket that answers the panel's "/filters" request.
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const sent: any[] = [];
class FakeWS {
	static last: FakeWS;
	readyState = 0;
	onopen?: (e: unknown) => void;
	onmessage?: (e: { data: string }) => void;
	constructor(public url: string) {
		FakeWS.last = this;
		setTimeout(() => {
			this.readyState = 1;
			this.onopen?.({});
		}, 0);
	}
	send(d: string) {
		sent.push(JSON.parse(d));
	}
	addEventListener(ev: string, fn: any) {
		(this as any)["on" + ev] = fn;
	}
	close() {}
	/** Deliver a message from the "Stream Deck app" to the panel. */
	deliver(msg: unknown) {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}
}

const ACTION = "com.sirsnacks.ninadeck.filterselect";
const dom = await JSDOM.fromFile(new URL("../com.sirsnacks.ninadeck.sdPlugin/ui/filter.html", import.meta.url).pathname, {
	runScripts: "dangerously",
	resources: "usable",
	beforeParse: (w: any) => (w.WebSocket = FakeWS),
});
await new Promise((r) => setTimeout(r, 300)); // let filter.js load
const w: any = dom.window;
const doc = w.document;
const sel = doc.getElementById("filter") as HTMLSelectElement;
const lastFilterRequest = () => sent.filter((m) => m.event === "sendToPlugin" && m.payload?.path?.endsWith("/filters")).at(-1);
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

// 1. panel opens on a key that already has "H" saved
w.connectElgatoStreamDeckSocket(
	28196,
	"PI-UUID",
	"registerPropertyInspector",
	JSON.stringify({ application: { language: "en", platform: "windows", version: "6.9" }, plugin: { version: "0.2" }, devicePixelRatio: 1, colors: {}, devices: [] }),
	JSON.stringify({ action: ACTION, context: "CTX", device: "D", payload: { settings: { filterName: "H" }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } }),
);
await tick();
assert.deepEqual(sent[0], { event: "registerPropertyInspector", uuid: "PI-UUID" });
const req1 = lastFilterRequest();
assert.ok(req1, "panel requested the filter list");
assert.equal(sel.value, "H", "saved filter shown before the list arrives");
assert.match(doc.getElementById("hint").textContent, /Waiting/);

// 2. plugin answers with the user's real simulator wheel
const names = ["l", "R", "G", "B", "S", "H"];
const answer = (req: any, body: unknown) =>
	FakeWS.last.deliver({ event: "sendToPropertyInspector", action: ACTION, context: "PI-UUID", payload: { __type: "response", id: req.payload.id, path: req.payload.path, status: 200, body } });
answer(req1, { connected: true, filters: names.map((name, id) => ({ id, name })) });
await tick();
assert.deepEqual([...sel.options].map((o) => o.textContent), ["Choose a filter…", ...names]);
assert.equal(sel.value, "H");
assert.match(doc.getElementById("hint").textContent, /as many keys/);

// 3. user picks another filter -> settings are saved
sel.value = "G";
sel.dispatchEvent(new w.Event("change"));
await tick();
const save = sent.filter((m) => m.event === "setSettings").at(-1);
assert.deepEqual(save.payload, { filterName: "G" });
assert.equal(save.context, "PI-UUID");

// 4. refresh -> wheel now disconnected
doc.getElementById("refresh").click();
await tick();
const req2 = lastFilterRequest();
assert.notEqual(req2.payload.id, req1.payload.id, "refresh sends a new request");
answer(req2, { connected: false, filters: [] });
await tick();
assert.match(doc.getElementById("hint").textContent, /No filter wheel/);
assert.equal(sel.value, "G");
assert.match(sel.options[sel.options.length - 1].textContent ?? "", /wheel not connected/);

// 5. settings pushed from the app (e.g. another window) update the panel
FakeWS.last.deliver({ event: "didReceiveSettings", action: ACTION, context: "PI-UUID", device: "D", payload: { settings: { filterName: "B" }, coordinates: { column: 0, row: 0 }, isInMultiAction: false } });
await tick();
assert.equal(sel.value, "B");
console.log("settings panel assertions passed");
process.exit(0);
