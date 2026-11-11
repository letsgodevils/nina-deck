// Runs the bundled Switch settings panel in jsdom against a fake Stream Deck websocket that answers "/switches".
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
	deliver(msg: unknown) {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}
}

const ACTION = "com.sirsnacks.ninadeck.switch";
const dom = await JSDOM.fromFile(new URL("../com.sirsnacks.ninadeck.sdPlugin/ui/switch.html", import.meta.url).pathname, { runScripts: "dangerously", resources: "usable", beforeParse: (w: any) => (w.WebSocket = FakeWS) });
await new Promise((r) => setTimeout(r, 300));
const w: any = dom.window;
const doc = w.document;
const sel = doc.getElementById("switch") as HTMLSelectElement;
const valueRow = doc.getElementById("valuerow") as HTMLElement;
const valueInput = doc.getElementById("value") as HTMLInputElement;
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const lastReq = () => sent.filter((m) => m.event === "sendToPlugin" && m.payload?.path?.endsWith("/switches")).at(-1);
const saves = () => sent.filter((m) => m.event === "setSettings");
const answer = (req: any, body: unknown) => FakeWS.last.deliver({ event: "sendToPropertyInspector", action: ACTION, context: "PI-UUID", payload: { __type: "response", id: req.payload.id, path: req.payload.path, status: 200, body } });

w.connectElgatoStreamDeckSocket(
	28196,
	"PI-UUID",
	"registerPropertyInspector",
	JSON.stringify({ application: { language: "en", platform: "windows", version: "6.9" }, plugin: { version: "0.8" }, devicePixelRatio: 1, colors: {}, devices: [] }),
	JSON.stringify({ action: ACTION, context: "CTX", device: "D", payload: { settings: { switchId: 1 }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } }),
);
await tick();
const req1 = lastReq();
assert.ok(req1, "panel requested the switch list");
assert.equal(sel.value, "1", "saved switch shown before the list arrives");
assert.match(doc.getElementById("hint").textContent, /Waiting/);

answer(req1, {
	connected: true,
	switches: [
		{ id: 0, name: "Dew heater", min: 0, max: 1, binary: true },
		{ id: 1, name: "Fan speed", min: 0, max: 100, binary: false },
	],
});
await tick();
assert.deepEqual([...sel.options].map((o) => o.textContent), ["Choose a switch…", "Dew heater", "Fan speed"]);
assert.equal(sel.value, "1");
assert.equal(valueRow.style.display, "block", "value field shown for a non-binary switch");

// pick the binary switch: value field hides, switch saved
sel.value = "0";
sel.dispatchEvent(new w.Event("change"));
await tick();
assert.deepEqual(saves().at(-1).payload, { switchId: 0 });
assert.equal(valueRow.style.display, "none");
assert.match(doc.getElementById("hint").textContent, /hold 1 second/);

// back to the ranged switch and set a value
sel.value = "1";
sel.dispatchEvent(new w.Event("change"));
await tick();
valueInput.value = "40";
valueInput.dispatchEvent(new w.Event("change"));
await tick();
assert.deepEqual(saves().at(-1).payload, { switchId: 1, setValue: 40 });
const n = saves().length;
for (const bad of ["abc", "", "150", "-1"]) {
	valueInput.value = bad;
	valueInput.dispatchEvent(new w.Event("change"));
	await tick();
	assert.equal(valueInput.value, "40", `rejected ${JSON.stringify(bad)}`);
}
assert.equal(saves().length, n, "nothing saved for invalid values");

// refresh -> device disconnected
doc.getElementById("refresh").click();
await tick();
const req2 = lastReq();
assert.notEqual(req2.payload.id, req1.payload.id);
answer(req2, { connected: false, switches: [] });
await tick();
assert.match(doc.getElementById("hint").textContent, /No switch device/);
assert.match(sel.options[sel.options.length - 1].textContent ?? "", /not connected/);

// settings pushed from the app
FakeWS.last.deliver({ event: "didReceiveSettings", action: ACTION, context: "PI-UUID", device: "D", payload: { settings: { switchId: 0 }, coordinates: { column: 0, row: 0 }, isInMultiAction: false } });
await tick();
assert.equal(sel.value, "0");
console.log("switch settings panel assertions passed");
process.exit(0);
