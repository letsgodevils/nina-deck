// Settings panel for the "Select Filter" key. Bundled to com.sirsnacks.ninadeck.sdPlugin/ui/filter.js.
import streamDeck from "@elgato/streamdeck";

interface FilterList {
	connected: boolean;
	filters: { id: number; name: string }[];
}

let savedName = "";
let list: FilterList | undefined; // undefined until the plugin answers

const select = document.getElementById("filter") as HTMLSelectElement;
const hint = document.getElementById("hint") as HTMLDivElement;

function addOption(value: string, text: string): void {
	const o = document.createElement("option");
	o.value = value;
	o.textContent = text;
	select.appendChild(o);
}

function render(): void {
	select.innerHTML = "";
	addOption("", "Choose a filter…");
	const names = list?.filters.map((f) => f.name) ?? [];
	for (const n of names) addOption(n, n);
	if (savedName && !names.includes(savedName)) addOption(savedName, `${savedName} (${list && !list.connected ? "wheel not connected" : "not on wheel"})`);
	select.value = savedName;

	if (!list) hint.textContent = "Waiting for the N.I.N.A. plugin…";
	else if (!list.connected) hint.textContent = "No filter wheel is connected in N.I.N.A. Connect it, then press Refresh.";
	else hint.textContent = "Add this action to as many keys as you like and pick a different filter on each.";
}

async function refresh(): Promise<void> {
	try {
		const res = await streamDeck.plugin.fetch("/filters");
		list = res.ok ? (res.body as unknown as FilterList) : undefined;
	} catch {
		list = undefined;
	}
	render();
}

streamDeck.onConnected((_info, actionInfo) => {
	const s = actionInfo.payload.settings as { filterName?: string };
	savedName = typeof s?.filterName === "string" ? s.filterName : "";
	render();
	void refresh();
});

streamDeck.settings.onDidReceiveSettings<{ filterName?: string }>((ev) => {
	savedName = ev.payload.settings.filterName ?? "";
	render();
});

select.addEventListener("change", () => {
	savedName = select.value;
	void streamDeck.settings.setSettings({ filterName: savedName });
});
document.getElementById("refresh")?.addEventListener("click", () => void refresh());
