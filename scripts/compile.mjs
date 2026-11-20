// Compiles contracts with solc-js and writes ABI + bytecode to build/.
import solc from "solc";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sources = {};
for (const f of ["contracts/src/Turncoat.sol", "contracts/test/Mocks.sol"]) {
  sources[f] = { content: fs.readFileSync(path.join(root, f), "utf8") };
}

function findImports(p) {
  const candidate = path.join(root, "node_modules", p);
  if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, "utf8") };
  return { error: "not found: " + p };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (out.errors || []).filter((e) => e.severity === "error");
for (const e of out.errors || []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);

fs.mkdirSync(path.join(root, "build"), { recursive: true });
for (const [file, contracts] of Object.entries(out.contracts)) {
  for (const [name, c] of Object.entries(contracts)) {
    if (!["Turncoat", "MockAgentID", "MockUSDT"].includes(name)) continue;
    fs.writeFileSync(
      path.join(root, "build", `${name}.json`),
      JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2)
    );
    console.log("compiled", name, `(${c.evm.bytecode.object.length / 2} bytes)`);
  }
}
