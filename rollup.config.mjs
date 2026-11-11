import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";

const sdPlugin = "com.sirsnacks.ninadeck.sdPlugin";

// Plugin (runs in Stream Deck's Node.js)
const plugin = {
	input: "src/plugin.ts",
	output: { file: `${sdPlugin}/bin/plugin.js`, sourcemap: false, format: "es" },
	external: [/^node:/],
	plugins: [
		typescript({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"], exclude: ["src/ui/**"], outDir: undefined, noEmit: false, declaration: false }),
		nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
		commonjs(),
		terser(),
		{ name: "emit-module-package-file", generateBundle() { this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" }); } },
	],
};

// Key settings panels (run in Stream Deck's browser pane)
const panel = (name) => ({
	input: `src/ui/${name}.ts`,
	output: { file: `${sdPlugin}/ui/${name}.js`, sourcemap: false, format: "iife" },
	plugins: [
		typescript({ tsconfig: "./tsconfig.ui.json", include: ["src/ui/**/*.ts"], outDir: undefined, noEmit: false, declaration: false }),
		nodeResolve({ browser: true, exportConditions: ["browser"] }),
		commonjs(),
		terser(),
	],
});

export default [plugin, panel("filter"), panel("cooler"), panel("focus"), panel("flatlevel"), panel("switch")];
