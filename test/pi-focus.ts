// Runs the bundled Focus step settings panel in jsdom against a fake Stream Deck websocket.
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

const ACTION = "com.sirsnacks.ninadeck.focus-in";
const dom = await JSDOM.fromFile(new URL("../com.sirsnacks.ninadeck.sdPlugin/ui/focus.html", import.meta.url).pathname, { runScripts: "dangerously", resources: "usable", beforeParse: (w: any) => (w.WebSocket = FakeWS) });
await new Promise((r) => setTimeout(r, 300));
const w: any = dom.window;
const input = w.document.getElementById("steps") as HTMLInputElement;
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const saves = () => sent.filter((m) => m.event === "setSettings");
const type = async (v: string) => {
	input.value = v;
	input.dispatchEvent(new w.Event("change"));
	await tick();
};

w.connectElgatoStreamDeckSocket(
	28196,
	"PI-UUID",
	"registerPropertyInspector",
	JSON.stringify({ application: { language: "en", platform: "windows", version: "6.9" }, plugin: { version: "0.5" }, devicePixelRatio: 1, colors: {}, devices: [] }),
	JSON.stringify({ action: ACTION, context: "CTX", device: "D", payload: { settings: { steps: 250 }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } }),
);
await tick();
assert.equal(input.value, "250", "shows the saved step size");
await type("500");
assert.deepEqual(saves().at(-1).payload, { steps: 500 });
const n = saves().length;
for (const bad of ["abc", "", "0", "-5", "2.5", "999999"]) {
	await type(bad);
	assert.equal(input.value, "500", `rejected ${JSON.stringify(bad)}`);
}
assert.equal(saves().length, n, "nothing saved for invalid input");
FakeWS.last.deliver({ event: "didReceiveSettings", action: ACTION, context: "PI-UUID", device: "D", payload: { settings: { steps: 25 }, coordinates: { column: 0, row: 0 }, isInMultiAction: false } });
await tick();
assert.equal(input.value, "25");
console.log("focus settings panel assertions passed");
process.exit(0);
