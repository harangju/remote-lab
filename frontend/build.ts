import { resolve } from "path";
import { readdirSync, copyFileSync } from "fs";

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "src/main.tsx")],
  outdir: resolve(import.meta.dir, "dist"),
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

const outDir = resolve(import.meta.dir, "dist");
const publicDir = resolve(import.meta.dir, "public");
const jsFile = result.outputs.find((o) => o.path.endsWith(".js"));
const scriptName = jsFile ? jsFile.path.split("/").pop()! : "main.js";
const buildHash = Date.now().toString(36);
const html = await Bun.file(resolve(publicDir, "index.html")).text();
await Bun.write(
  resolve(outDir, "index.html"),
  html.replace("/main.js", `/${scriptName}?v=${buildHash}`),
);

for (const file of readdirSync(publicDir)) {
  if (file === "index.html") continue;
  copyFileSync(resolve(publicDir, file), resolve(outDir, file));
}

console.log(`Built ${result.outputs.length} files to dist/`);
