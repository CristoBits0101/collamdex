import esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const config = {
  bundle: true,
  entryPoints: ["src/extension.ts"],
  external: ["vscode"],
  format: "cjs",
  logLevel: "info",
  minify: production,
  outfile: "dist/extension.js",
  platform: "node",
  sourcemap: !production,
  target: "node20"
};

if (watch) {
  const context = await esbuild.context(config);
  await context.watch();
  console.log("Collamdex build watcher is running.");
} else {
  await esbuild.build(config);
}
