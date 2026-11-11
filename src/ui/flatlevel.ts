// Settings panel for the "Flat Brightness" key. Bundled to com.sirsnacks.ninadeck.sdPlugin/ui/flatlevel.js.
import streamDeck from "@elgato/streamdeck";

const DEFAULT = 50;
const input = document.getElementById("level") as HTMLInputElement;
let last = DEFAULT;

const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= 100;

function show(v: unknown): void {
	last = typeof v === "number" && valid(v) ? v : DEFAULT;
	input.value = String(last);
}

streamDeck.onConnected((_info, actionInfo) => show((actionInfo.payload.settings as { brightness?: number }).brightness));
streamDeck.settings.onDidReceiveSettings<{ brightness?: number }>((ev) => show(ev.payload.settings.brightness));

input.addEventListener("change", () => {
	const n = input.value.trim() === "" ? NaN : Number(input.value);
	if (!valid(n)) {
		input.value = String(last); // reject junk, keep the old value
		return;
	}
	last = n;
	void streamDeck.settings.setSettings({ brightness: n });
});
