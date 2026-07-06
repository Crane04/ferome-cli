import chalk from "chalk";
import { resetProjectConfig } from "../project.js";

export function resetCommand(): void {
  const didReset = resetProjectConfig(process.cwd());

  if (!didReset) {
    console.log(chalk.dim("No local Ferome project config found."));
    return;
  }

  console.log(chalk.green("Reset local Ferome project config."));
}
