// Reproduces vercel/eve#6566: parallel `eve eval` processes can import a
// half-written authored module cache file.
//
// Each round clears eve's authored module cache, then starts PROCESSES copies of
// `eve eval --list` at once. Every process bundles and imports the same eval
// files, so they all write the same cache paths. A process that imports a file
// another process is still writing fails.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROUNDS = Number(process.env.ROUNDS ?? 30);
const PROCESSES = Number(process.env.PROCESSES ?? 4);
const FIXTURE_MB = Number(process.env.FIXTURE_MB ?? 8);

const root = import.meta.dirname;
const cacheDir = join(root, "node_modules", ".cache", "eve", "authored-modules");
const eveBin = join(root, "node_modules", "eve", "bin", "eve.js");

const HALF_WRITTEN = [
  /Unexpected end of input/,
  /does not export a valid EveEval/,
  /Invalid or unexpected token/,
  /Unterminated string/,
  /missing \) after argument list/,
  /SyntaxError/,
];

writeFixture();

let failedRounds = 0;
let failedProcesses = 0;
let otherFailures = 0;
const samples = new Map();

for (let round = 1; round <= ROUNDS; round++) {
  rmSync(cacheDir, { recursive: true, force: true });
  const results = await Promise.all(Array.from({ length: PROCESSES }, () => runEveEvalList()));
  let halfWritten = 0;
  for (const { code, output } of results) {
    if (code === 0) continue;
    const match = HALF_WRITTEN.find((pattern) => pattern.test(output));
    if (match) {
      halfWritten++;
      const line = firstErrorLines(output);
      if (!samples.has(line)) samples.set(line, round);
    } else {
      otherFailures++;
      console.error(`round ${round}: unexpected failure (exit ${code}):\n${output}`);
    }
  }
  if (halfWritten > 0) failedRounds++;
  failedProcesses += halfWritten;
  console.log(
    `round ${String(round).padStart(2)}: ${halfWritten}/${PROCESSES} processes imported a half-written module`,
  );
}

console.log("");
if (samples.size > 0) {
  console.log("Sample errors:");
  for (const [line, round] of samples) console.log(`  [round ${round}] ${line}`);
  console.log("");
}
console.log(
  `Failed in ${failedRounds} of ${ROUNDS} rounds; ${failedProcesses} of ${ROUNDS * PROCESSES} processes imported a half-written module.`,
);
if (otherFailures > 0) console.log(`${otherFailures} processes failed for another reason (see above).`);
process.exitCode = failedProcesses > 0 ? 1 : 0;

function runEveEvalList() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [eveBin, "eval", "--list"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
  });
}

function firstErrorLines(output) {
  return output
    .replaceAll(`${root}/`, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /error|Caused by|does not export/i.test(line))
    .slice(0, 2)
    .join(" | ");
}

// One large string literal, imported by every eval: each cache file is several MB,
// which keeps bundling cheap but makes each write long enough to race.
function writeFixture() {
  const path = join(root, "evals", "fixtures", "rows.ts");
  mkdirSync(join(root, "evals", "fixtures"), { recursive: true });
  const lines = ["export const rows: string[] = [", `  "${"x".repeat(FIXTURE_MB * 1024 * 1024)}",`, "];", ""];
  writeFileSync(path, lines.join("\n"));
}
