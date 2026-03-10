import { resolve } from "path";

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "main.tsx")],
  outdir: resolve(import.meta.dir, "../dist"),
  minify: true,
  splitting: true,
  target: "browser",
  format: "esm",
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
// Copy index.html to dist/, injecting the built script name
const outDir = resolve(import.meta.dir, "../dist");
const jsFile = result.outputs.find((o) => o.path.endsWith(".js"));
const scriptName = jsFile ? jsFile.path.split("/").pop()! : "main.js";
const html = await Bun.file(resolve(import.meta.dir, "../public/index.html")).text();
await Bun.write(
  resolve(outDir, "index.html"),
  html.replace("/main.js", `/${scriptName}`),
);

console.log(`Built ${result.outputs.length} files to dist/`);
