// Settings panel for the "Switch" key. Bundled to com.sirsnacks.ninadeck.sdPlugin/ui/switch.js.
import streamDeck from "@elgato/streamdeck";

interface SwitchInfo {
	id: number;
	name: string;
	min?: number;
	max?: number;
	binary: boolean;
}
interface SwitchList {
	connected: boolean;
	switches: SwitchInfo[];
}
type Cfg = { switchId?: number; setValue?: number };

let cfg: Cfg = {};
let list: SwitchList | undefined; // undefined until the plugin answers

const select = document.getElementById("switch") as HTMLSelectElement;
const valueRow = document.getElementById("valuerow") as HTMLDivElement;
const valueInput = document.getElementById("value") as HTMLInputElement;
const hint = document.getElementById("hint") as HTMLDivElement;

function addOption(value: string, text: string): void {
	const o = document.createElement("option");
	o.value = value;
	o.textContent = text;
	select.appendChild(o);
}

const current = () => list?.switches.find((w) => w.id === cfg.switchId);

function render(): void {
	select.innerHTML = "";
	addOption("", "Choose a switch…");
	for (const w of list?.switches ?? []) addOption(String(w.id), w.name);
	if (cfg.switchId !== undefined && !current()) addOption(String(cfg.switchId), `Switch ${cfg.switchId} (${list && !list.connected ? "not connected" : "not found"})`);
	select.value = cfg.switchId === undefined ? "" : String(cfg.switchId);

	const w = current();
	valueRow.style.display = w && !w.binary ? "block" : "none";
	if (w && !w.binary) {
		valueInput.min = String(w.min ?? "");
		valueInput.max = String(w.max ?? "");
		valueInput.value = cfg.setValue === undefined ? "" : String(cfg.setValue);
	}

	if (!list) hint.textContent = "Waiting for the N.I.N.A. plugin…";
	else if (!list.connected) hint.textContent = "No switch device is connected in N.I.N.A. Connect it, then press Refresh.";
	else if (w?.binary) hint.textContent = "On/off switch: tap the key to turn it on, hold 1 second to turn it off.";
	else if (w) hint.textContent = "Pressing the key sets this value.";
	else hint.textContent = "Add this action to as many keys as you like and pick a different switch on each.";
}

async function refresh(): Promise<void> {
	try {
		const res = await streamDeck.plugin.fetch("/switches");
		list = res.ok ? (res.body as unknown as SwitchList) : undefined;
	} catch {
		list = undefined;
	}
	render();
}

const save = () => void streamDeck.settings.setSettings(cfg);

streamDeck.onConnected((_info, actionInfo) => {
	cfg = { ...(actionInfo.payload.settings as Cfg) };
	render();
	void refresh();
});

streamDeck.settings.onDidReceiveSettings<Cfg>((ev) => {
	cfg = { ...ev.payload.settings };
	render();
});

select.addEventListener("change", () => {
	cfg = select.value === "" ? {} : { switchId: Number(select.value) };
	render();
	save();
});

valueInput.addEventListener("change", () => {
	const n = valueInput.value.trim() === "" ? NaN : Number(valueInput.value);
	const w = current();
	if (!Number.isFinite(n) || (w?.min !== undefined && n < w.min) || (w?.max !== undefined && n > w.max)) {
		valueInput.value = cfg.setValue === undefined ? "" : String(cfg.setValue); // reject junk / out of range
		return;
	}
	cfg = { ...cfg, setValue: n };
	save();
});

document.getElementById("refresh")?.addEventListener("click", () => void refresh());
