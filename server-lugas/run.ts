import app from "./app";
import { config } from "./shared.js";
import { existsSync } from "node:fs";

const PORT = Number(process.env.PORT || 3100);
// containers need a non-loopback bind; 127.0.0.1 remains valid for local runs
const HOST = process.env.HOST || "0.0.0.0";

const server = app.serve({ port: PORT, hostname: HOST, maxRequestBodySize: config.maxUploadBytes * 2 });

console.log(`zcode-web (lugas/bun) listening on http://${HOST}:${PORT}`);
console.log(`  cli runtime: ${config.cliNode || "(unset)"} (${config.cliNode && existsSync(config.cliNode) ? "found" : "MISSING — job spawns fail-closed"})`);
console.log(`  auth      : ${config.token ? "bearer token required" : "OPEN (set ZCODE_WEB_TOKEN!)"}`);
console.log(server.url);
