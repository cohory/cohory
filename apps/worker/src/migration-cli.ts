import { setPoolRole } from "@cohory/db";
import { getMigrationRuntime, MigrationError } from "@cohory/migration";
import { runCli } from "@cohory/migration/cli";

setPoolRole("worker");

const io = {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  out: (line: string) => {
    console.info(line);
  },
};

try {
  process.exit(await runCli(getMigrationRuntime(), io, process.argv.slice(2)));
} catch (error: unknown) {
  const message =
    error instanceof MigrationError ? `${error.code}: ${error.message}` : String(error);
  console.error(
    JSON.stringify({ level: "error", msg: "migration command failed", error: message }),
  );
  process.exit(1);
}
