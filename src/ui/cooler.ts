// Settings panel for the "Sensor Cooling" key. Bundled to com.sirsnacks.ninadeck.sdPlugin/ui/cooler.js.
import streamDeck from "@elgato/streamdeck";

const DEFAULT_C = -10;
const input = document.getElementById("temp") as HTMLInputElement;
let last = DEFAULT_C;

const valid = (n: number) => Number.isFinite(n) && n >= -60 && n <= 40;

function show(v: unknown): void {
	last = typeof v === "number" && valid(v) ? v : DEFAULT_C;
	input.value = String(last);
}

streamDeck.onConnected((_info, actionInfo) => show((actionInfo.payload.settings as { targetTemp?: number }).targetTemp));
streamDeck.settings.onDidReceiveSettings<{ targetTemp?: number }>((ev) => show(ev.payload.settings.targetTemp));

input.addEventListener("change", () => {
	const n = input.value.trim() === "" ? NaN : Number(input.value);
	if (!valid(n)) {
		input.value = String(last); // reject junk, keep the old value
		return;
	}
	last = n;
	void streamDeck.settings.setSettings({ targetTemp: n });
});
