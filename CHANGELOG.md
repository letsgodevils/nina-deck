# Changelog

Per-version notes from development (newest last). See the README for the full, current feature list.


Live N.I.N.A. status on a Stream Deck XL, using the N.I.N.A. "Advanced API" plugin (http://localhost:1888).

Keys: Exposure countdown, Frame count, Target, Guiding RMS (PHD2), Sensor temp, Meridian flip, Connections, Start, Stop (hold 1s).

Install: double-click com.sirsnacks.ninadeck.streamDeckPlugin. Drag keys from the "N.I.N.A." category.
Requires: N.I.N.A. Advanced API plugin enabled and running on the same PC (default port 1888).

Dev: npm install; npm test (mock server + render previews); npm run build.
Tweak guiding colors: RMS_GOOD / RMS_OK at the top of src/core/render.ts.

## Version 0.2
Filter wheel: "Current Filter" key plus one "Select Filter" action. Drag it onto as many keys as you like; in each key's settings panel pick the filter from a drop-down filled from your wheel. Active filter is highlighted.
Tracking: "Tracking Rate" key plus Sidereal / Lunar / Solar / King keys.
Filter and tracking changes are refused while the camera is exposing (the key flashes an alert).
Track: Stop key (hold 1 second). Mode 4 = Stopped was confirmed on the simulator mount; the key checks the mount's reported mode afterwards and flashes an alert if it doesn't match.
Plugin log (Stream Deck > Preferences > Plugins, or the plugin's logs folder) records refused/failed commands.

## Version 0.5
Sensor Cooling key: cooler off -> tap to cool to the target temperature (set in the key's settings panel, default -10 C).
Cooler on -> hold 1 s to warm up (uses N.I.N.A.'s gradual default warm-up via /equipment/camera/warm?minutes=-1).
While warming -> hold 1 s to cancel. Warm-up is refused while the camera is exposing.
Needs a camera that supports temperature control; otherwise the key shows NO COOLER.

## Version 0.6
Park Mount key: hold 1 s to park (/equipment/mount/park). When parked the key shows PARKED; a tap unparks (/equipment/mount/unpark).
Home Mount key: hold 1 s to send the mount to its home position (/equipment/mount/home). Needs an unparked mount.
Both are refused while the camera is exposing, show "please wait" while the mount moves, and re-read the mount state afterwards.
Keys show NO PARK / NO HOME if the mount driver reports it can't do it.
Note: the exact home/park/unpark endpoint behavior couldn't be checked against the API docs; verify on your simulator first
(curl.exe http://localhost:1888/v2/api/equipment/mount/park, then mount/info and look at AtPark).

## Version 0.7 (focuser)
Focus Position: current focuser position and temperature (blue "moving..." while it moves).
Focus In / Focus Out: nudge the focuser by a step size you set per key in its settings panel (default 100). In = lower position, Out = higher.
Refused while the camera is exposing, while autofocus runs, or while the focuser is already moving; the position is checked afterwards.
Autofocus: hold 1 s to start (/equipment/focuser/auto-focus); while running, hold 1 s to cancel (?cancel=true; N.I.N.A. only cancels an AF started through the API).
The API has no "autofocus running" flag, so the deck tracks it itself (until the request returns, or until focuser and camera have been idle for 25 s).

## Version 0.8 (flat panel + switches)
Flat Light: tap to turn the panel light on/off (shows brightness). Turning it ON is refused while the camera is exposing; OFF is always allowed.
Flat Cover: hold 1 s to open/close the cover (refused while exposing). Stays on "please wait" until N.I.N.A. reports Open/Closed (60 s max).
Flat Brightness: tap to set the panel to this key's preset (settings panel, whole percent 0-100); green when it matches the current level.
Switch: one key per switch; pick the switch (and, for non on/off switches, the value to set) in the key's settings panel.
On/off switches: tap = on, hold 1 s = off (it could be camera or mount power). The key re-reads the switch afterwards and alerts if it didn't change.
Endpoints: flatdevice/info|set-light?on=|set-cover?closed=|set-brightness?brightness=, switch/info|set?index=&value= (from the API docs; not yet run against a device here).
