// Stream Deck throws (and the plugin dies) if code registers an action whose UUID is not in the manifest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("com.sirsnacks.ninadeck.sdPlugin/manifest.json", "utf8"));
const inManifest = new Set<string>(manifest.Actions.map((a: any) => a.UUID));
const src = readFileSync("src/actions/live.ts", "utf8");

const fromDecorators = [...src.matchAll(/@action\(\{ UUID: `\$\{UUID\}\.([\w-]+)` \}\)/g)].map((m) => `com.sirsnacks.ninadeck.${m[1]}`);
const modes = [...src.matchAll(/\["(\w+)", \d\]/g)].map((m) => `com.sirsnacks.ninadeck.trk-${m[1].toLowerCase()}`);
const registered = [...fromDecorators, ...modes];

assert.ok(registered.length >= 14, `found ${registered.length} registered actions`);
for (const id of registered) assert.ok(inManifest.has(id), `registered but missing from manifest: ${id}`);
for (const id of inManifest) assert.ok(registered.includes(id), `in manifest but never registered: ${id}`);
assert.equal(new Set(registered).size, registered.length, "duplicate UUIDs");
for (const a of manifest.Actions.filter((a: any) => a.PropertyInspectorPath)) {
	readFileSync(`com.sirsnacks.ninadeck.sdPlugin/${a.PropertyInspectorPath}`); // file exists
}
console.log(`manifest consistency passed (${registered.length} actions)`);
