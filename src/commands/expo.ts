import chalk from "chalk";
import { readProjectConfig } from "../project.js";

export function expoTokenCommand(): void {
  const projectConfig = readProjectConfig(process.cwd());
  const repo = projectConfig.githubRepo ?? "<owner/repo>";

  console.log(chalk.bold("\nExpo token setup\n"));
  console.log("Create an Expo access token:");
  console.log(chalk.cyan("https://expo.dev/settings/access-tokens"));
  console.log("");
  console.log("Then save it to this GitHub repo:");
  console.log(chalk.cyan(`gh secret set EXPO_TOKEN -R ${repo}`));
  console.log(chalk.dim("\nPaste the Expo token when the GitHub CLI prompts for the secret value."));
}
