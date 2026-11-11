// Runs the bundled Sensor Cooling settings panel in jsdom against a fake Stream Deck websocket.
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

const ACTION = "com.sirsnacks.ninadeck.cooler";
const dom = await JSDOM.fromFile(new URL("../com.sirsnacks.ninadeck.sdPlugin/ui/cooler.html", import.meta.url).pathname, { runScripts: "dangerously", resources: "usable", beforeParse: (w: any) => (w.WebSocket = FakeWS) });
await new Promise((r) => setTimeout(r, 300));
const w: any = dom.window;
const input = w.document.getElementById("temp") as HTMLInputElement;
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
	JSON.stringify({ action: ACTION, context: "CTX", device: "D", payload: { settings: { targetTemp: -15 }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } }),
);
await tick();
assert.equal(input.value, "-15", "shows the saved target");

await type("-5");
assert.deepEqual(saves().at(-1).payload, { targetTemp: -5 });
const n = saves().length;
await type("abc");
assert.equal(input.value, "-5", "junk rejected, old value restored");
await type("");
assert.equal(input.value, "-5", "empty rejected");
await type("99");
assert.equal(input.value, "-5", "out-of-range rejected");
assert.equal(saves().length, n, "nothing saved for invalid input");
await type("-12.5");
assert.deepEqual(saves().at(-1).payload, { targetTemp: -12.5 });

FakeWS.last.deliver({ event: "didReceiveSettings", action: ACTION, context: "PI-UUID", device: "D", payload: { settings: { targetTemp: 0 }, coordinates: { column: 0, row: 0 }, isInMultiAction: false } });
await tick();
assert.equal(input.value, "0");
console.log("cooler settings panel assertions passed");
process.exit(0);
