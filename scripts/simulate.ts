/**
 * Run:  npm run simulate                       (uses scripts/seven-rounds.config.json)
 *       npm run simulate -- path/to/other.json
 * Prints the report and saves it to reports/<config name>-report.txt
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { SimulationError, runSimulation, type SimulationConfig } from "./simulation";

const file = resolve(process.argv[2] ?? "scripts/seven-rounds.config.json");

let cfg: SimulationConfig;
try {
  cfg = JSON.parse(readFileSync(file, "utf8")) as SimulationConfig;
} catch (e) {
  console.error(`Could not read ${file}: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

try {
  const { report } = runSimulation(cfg);
  console.log(report);
  mkdirSync("reports", { recursive: true });
  const out = resolve("reports", `${basename(file, ".json").replace(/\.config$/, "")}-report.txt`);
  writeFileSync(out, report, "utf8");
  console.log(`Report saved to ${out}`);
} catch (e) {
  if (e instanceof SimulationError) {
    console.error(`\nProblem in your config: ${e.message}\n`);
    process.exit(2);
  }
  throw e;
}
