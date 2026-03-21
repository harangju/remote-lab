import { resolve } from "path";

Bun.serve({
  port: 5173,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
      const target = `http://localhost:3000${url.pathname}${url.search}`;
      return fetch(target, req);
    }

    const buildResult = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "src/main.tsx")],
      outdir: resolve(import.meta.dir, "dist"),
      splitting: true,
      target: "browser",
      format: "esm",
    });

    if (!buildResult.success) {
      return new Response("Build failed", { status: 500 });
    }

    const filePath = url.pathname === "/" || !url.pathname.includes(".")
      ? resolve(import.meta.dir, "dist/index.html")
      : resolve(import.meta.dir, "dist", url.pathname.slice(1));

    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);

    return new Response(Bun.file(resolve(import.meta.dir, "dist/index.html")));
  },
});

console.log("Dev server running at http://localhost:5173");
