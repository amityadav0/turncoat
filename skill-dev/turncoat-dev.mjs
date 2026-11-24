#!/usr/bin/env node
// Development entry point for the Turncoat skill helper. Not part of the installed skill.
//
// It runs every command exactly as skill/scripts/turncoat.mjs does, and adds one development-only
// command, test-send, which signs a transaction with a local test key on a local chain or BSC testnet
// (never mainnet). The shipped helper has no test-send and loads nothing outside its own folder.
//
//   node skill-dev/turncoat-dev.mjs test-send --to <contract or token> --data 0x… [--value 0]
//   node skill-dev/turncoat-dev.mjs <any helper command> …
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main, parseArgs, loadConfig, need, req, explorerTx, tokenOf } from "../skill/scripts/turncoat.mjs";
import { runCli } from "./testsend.mjs";

export async function devMain(argv) {
  if (argv[0] !== "test-send") return main(argv);
  const { opts } = parseArgs(argv);
  return runCli(loadConfig(), opts, { need, req, explorerTx, tokenOf });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  devMain(process.argv.slice(2))
    .then((out) => { process.stdout.write(out.help ?? JSON.stringify(out, null, 2) + "\n"); })
    .catch((e) => { process.stdout.write(JSON.stringify({ error: e.message }) + "\n"); process.exit(1); });
}
