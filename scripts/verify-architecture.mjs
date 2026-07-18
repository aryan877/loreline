import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const server = new URL("../apps/server/", import.meta.url);
const failures = [];

async function exists(url) {
  return stat(url).then(
    () => true,
    () => false,
  );
}

async function walk(url, options = {}) {
  const entries = await readdir(url, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (options.ignore?.has(entry.name)) continue;
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
    if (entry.isDirectory()) files.push(...(await walk(child, options)));
    else files.push(child);
  }
  return files;
}

const serverPackage = JSON.parse(
  await readFile(new URL("package.json", server), "utf8"),
);
const serverDependencies = {
  ...serverPackage.dependencies,
  ...serverPackage.devDependencies,
};
for (const dependency of ["next", "@next/env", "react", "react-dom", "server-only"]) {
  if (dependency in serverDependencies) {
    failures.push(`apps/server still depends on ${dependency}`);
  }
}

for (const legacyPath of [
  "next.config.ts",
  "next.config.js",
  "next-env.d.ts",
  "src/app",
  ".next",
  ".next-docker",
]) {
  if (await exists(new URL(legacyPath, server))) {
    failures.push(`legacy server path exists: apps/server/${legacyPath}`);
  }
}

const sourceRoot = new URL("src/", server);
const sourceFiles = await walk(sourceRoot);
for (const file of sourceFiles) {
  if (![".ts", ".tsx"].includes(extname(file.pathname))) continue;
  const source = await readFile(file, "utf8");
  const name = relative(new URL("..", root).pathname, file.pathname);
  if (/from\s+["']next(?:\/|["'])|import\s+["']server-only["']/.test(source)) {
    failures.push(`framework import leaked into ${name}`);
  }
  if (/\bvoid\s+indexBook\s*\(/.test(source)) {
    failures.push(`detached indexing job exists in ${name}`);
  }
}

const sourceTopLevel = await readdir(sourceRoot, { withFileTypes: true });
for (const entry of sourceTopLevel) {
  if (entry.isFile() && entry.name !== "main.ts") {
    failures.push(`loose server source file exists: apps/server/src/${entry.name}`);
  }
}

for (const base of [new URL("apps/", root), new URL("packages/", root)]) {
  const directories = [base];
  while (directories.length) {
    const current = directories.pop();
    const entries = await readdir(current, { withFileTypes: true });
    if (!entries.length) {
      failures.push(`empty directory exists: ${relative(root.pathname, current.pathname)}`);
    }
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !new Set(["node_modules", ".next", ".next-docker", ".turbo", "coverage", "dist", "build"]).has(entry.name)
      ) {
        directories.push(new URL(`${entry.name}/`, current));
      }
    }
  }
}

const dockerfile = await readFile(new URL("Dockerfile", root), "utf8");
if (dockerfile.includes("apps/server/.next")) {
  failures.push("Dockerfile still expects a Next.js server artifact");
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Architecture verified: Next.js is web-only and the Effect server is clean.");
}
