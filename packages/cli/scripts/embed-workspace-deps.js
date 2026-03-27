#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function shouldEmbedPath(sourcePath) {
  const normalized = sourcePath.split(path.sep).join("/");
  if (normalized.includes("/__tests__/")) {
    return false;
  }

  if (normalized.endsWith(".test.js") || normalized.endsWith(".test.d.ts")) {
    return false;
  }

  return true;
}

function embedWorkspacePackage(cliRootDir, workspaceRelativeDir, packageName) {
  const sourceDir = path.resolve(cliRootDir, workspaceRelativeDir);
  const sourcePackageJsonPath = path.join(sourceDir, "package.json");
  const sourceDistDir = path.join(sourceDir, "dist");

  if (!fs.existsSync(sourcePackageJsonPath)) {
    throw new Error(`Missing package.json for ${packageName} at ${sourcePackageJsonPath}`);
  }

  if (!fs.existsSync(sourceDistDir)) {
    throw new Error(`Missing built dist for ${packageName} at ${sourceDistDir}`);
  }

  const sourcePackageJson = readJson(sourcePackageJsonPath);
  const destinationPackageDir = path.join(
    cliRootDir,
    "dist",
    "node_modules",
    ...packageName.split("/")
  );
  const destinationDistDir = path.join(destinationPackageDir, "dist");

  fs.rmSync(destinationPackageDir, { recursive: true, force: true });
  ensureDir(destinationDistDir);
  fs.cpSync(sourceDistDir, destinationDistDir, {
    recursive: true,
    filter: (sourcePath) => shouldEmbedPath(sourcePath),
  });

  const embeddedPackageJson = {
    name: sourcePackageJson.name,
    version: sourcePackageJson.version,
    main: sourcePackageJson.main ?? "dist/index.js",
    types: sourcePackageJson.types,
  };

  fs.writeFileSync(
    path.join(destinationPackageDir, "package.json"),
    `${JSON.stringify(embeddedPackageJson, null, 2)}\n`,
    "utf8"
  );
}

function clearEmbeddedWorkspacePackages(cliRootDir) {
  const embeddedRoot = path.join(cliRootDir, "dist", "node_modules", "@memorymesh");
  fs.rmSync(path.join(embeddedRoot, "core"), { recursive: true, force: true });
  fs.rmSync(path.join(embeddedRoot, "runtime"), { recursive: true, force: true });
}

function main() {
  const cliRootDir = path.resolve(__dirname, "..");
  clearEmbeddedWorkspacePackages(cliRootDir);
  embedWorkspacePackage(cliRootDir, "../core", "@memorymesh/core");
  embedWorkspacePackage(cliRootDir, "../runtime", "@memorymesh/runtime");
}

main();
