#!/usr/bin/env node

import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const appRoot = process.cwd();
const appName = path.basename(appRoot);
const standaloneAppRoot = path.join(
  appRoot,
  ".next",
  "standalone",
  "apps",
  appName,
);

await mkdir(path.join(standaloneAppRoot, ".next"), { recursive: true });
await cp(
  path.join(appRoot, ".next", "static"),
  path.join(standaloneAppRoot, ".next", "static"),
  { recursive: true },
);

const publicDirectory = path.join(appRoot, "public");
if (existsSync(publicDirectory)) {
  await cp(publicDirectory, path.join(standaloneAppRoot, "public"), {
    recursive: true,
  });
}
