import chalk from "chalk";
import { getServerUrl, setServerUrl } from "../config.js";

export function serverCommand(): void {
  console.log(`\nServer: ${chalk.cyan(getServerUrl())}`);
}

export function setServerCommand(url: string): void {
  setServerUrl(url);
  console.log(`\nServer set to ${chalk.cyan(getServerUrl())}`);
}
