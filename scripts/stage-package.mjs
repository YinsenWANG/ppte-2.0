import {
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
const root = "artifacts/npm-package";
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
cpSync("dist/packages", `${root}/dist/packages`, { recursive: true });
for (const app of ["cli", "mcp"])
  cpSync(`dist/apps/${app}`, `${root}/dist/apps/${app}`, { recursive: true });
mkdirSync(`${root}/host`, { recursive: true });
cpSync("apps/host/dist/index.html", `${root}/host/index.html`, {
  recursive: false,
});
cpSync("skills/ppte", `${root}/skills/ppte`, { recursive: true });
cpSync("schemas", `${root}/schemas`, { recursive: true });
cpSync("examples", `${root}/examples`, { recursive: true });
cpSync("README-AGENT.md", `${root}/README.md`);
cpSync("LICENSE", `${root}/LICENSE`);
const repo = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync(
  `${root}/package.json`,
  JSON.stringify(
    {
      name: "ppte-cli",
      version: "0.7.0",
      description: "File-based PPTe presentation compiler and editor tools",
      type: "module",
      license: repo.license,
      engines: { node: ">=22" },
      bin: {
        ppte: "dist/apps/cli/index.js",
        "ppte-mcp": "dist/apps/mcp/index.js",
      },
      dependencies: { fflate: repo.devDependencies.fflate },
      optionalDependencies: { playwright: repo.devDependencies.playwright },
    },
    null,
    2,
  ) + "\n",
);
for (const app of ["cli", "mcp"])
  chmodSync(`${root}/dist/apps/${app}/index.js`, 0o755);
console.log(
  `Staged ${root}; install the local tarball. This does not publish to npm.`,
);
