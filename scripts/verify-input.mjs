// Prints the Standard-JSON input for BscScan source verification (same settings as compile.mjs).
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sources = { "contracts/src/Turncoat.sol": { content: fs.readFileSync(path.join(root, "contracts/src/Turncoat.sol"), "utf8") } };
const re = /import\s+\{[^}]*\}\s+from\s+"([^"]+)";/g;
const queue = ["contracts/src/Turncoat.sol"];
while (queue.length) {
  const file = queue.shift();
  const content = sources[file].content;
  for (const m of content.matchAll(re)) {
    let dep = m[1];
    if (dep.startsWith(".")) dep = path.posix.normalize(path.posix.join(path.posix.dirname(file), dep));
    if (sources[dep]) continue;
    sources[dep] = { content: fs.readFileSync(path.join(root, "node_modules", dep), "utf8") };
    queue.push(dep);
  }
}
process.stdout.write(JSON.stringify({
  language: "Solidity",
  sources,
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
}, null, 2));
