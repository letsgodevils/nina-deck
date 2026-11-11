// Settings panel for the "Focus In" / "Focus Out" keys. Bundled to com.sirsnacks.ninadeck.sdPlugin/ui/focus.js.
import streamDeck from "@elgato/streamdeck";

const DEFAULT_STEPS = 100;
const input = document.getElementById("steps") as HTMLInputElement;
let last = DEFAULT_STEPS;

const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 100000;

function show(v: unknown): void {
	last = typeof v === "number" && valid(v) ? v : DEFAULT_STEPS;
	input.value = String(last);
}

streamDeck.onConnected((_info, actionInfo) => show((actionInfo.payload.settings as { steps?: number }).steps));
streamDeck.settings.onDidReceiveSettings<{ steps?: number }>((ev) => show(ev.payload.settings.steps));

input.addEventListener("change", () => {
	const n = input.value.trim() === "" ? NaN : Number(input.value);
	if (!valid(n)) {
		input.value = String(last); // reject junk, keep the old value
		return;
	}
	last = n;
	void streamDeck.settings.setSettings({ steps: n });
});
