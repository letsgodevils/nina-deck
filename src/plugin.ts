import { isBinary } from "./core/switches.js";
import streamDeck from "@elgato/streamdeck";
import { startPolling, state } from "./core/store.js";
import {
	CameraKey,
	CoolerKey,
	ExposureKey,
	FilterCurrentKey,
	FilterSelectKey,
	FramesKey,
	AutoFocusKey,
	FocusInKey,
	FocusOutKey,
	FocusPositionKey,
	FlatCoverKey,
	FlatLevelKey,
	FlatLightKey,
	GuidingKey,
	HomeKey,
	MountKey,
	SwitchKey,
	ParkKey,
	StartKey,
	StatusKey,
	StopKey,
	TargetKey,
	TrackingCurrentKey,
	parameterizedActions,
	startTicker,
} from "./actions/live.js";

for (const a of [
	new ExposureKey(),
	new FramesKey(),
	new TargetKey(),
	new GuidingKey(),
	new CameraKey(),
	new CoolerKey(),
	new MountKey(),
	new ParkKey(),
	new FocusPositionKey(),
	new FocusInKey(),
	new FocusOutKey(),
	new AutoFocusKey(),
	new FlatLightKey(),
	new FlatCoverKey(),
	new FlatLevelKey(),
	new SwitchKey(),
	new HomeKey(),
	new StatusKey(),
	new StartKey(),
	new StopKey(),
	new FilterCurrentKey(),
	new FilterSelectKey(),
	new TrackingCurrentKey(),
	...parameterizedActions(),
]) {
	streamDeck.actions.registerAction(a);
}

// The "Select Filter" settings panel asks for the wheel's filter list through this route.
streamDeck.ui.registerRoute("/filters", (_req, res) =>
	res.success({ connected: !!state.filterWheel?.connected, filters: state.filterWheel?.filters.map((f) => ({ id: f.id, name: f.name })) ?? [] }),
);

// The "Switch" settings panel asks for the writable switches through this route.
streamDeck.ui.registerRoute("/switches", (_req, res) =>
	res.success({
		connected: !!state.switches?.connected,
		switches: (state.switches?.switches ?? []).filter((w) => w.writable).map((w) => ({ id: w.id, name: w.name, min: w.min, max: w.max, binary: isBinary(w) })),
	}),
);

startPolling();
startTicker();
void streamDeck.connect();
