import chalk from "chalk";
import fs from "fs";
import readline from "readline";
import { listAppleKeys, saveAppleKey } from "../api.js";
import { getToken } from "../config.js";

interface AddKeyOptions {
  keyId?: string;
  issuerId?: string;
  file?: string;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

export async function addKeyCommand(opts: AddKeyOptions): Promise<void> {
  if (!getToken()) {
    console.error(chalk.red("Not logged in. Run: ferome login"));
    process.exit(1);
  }

  const appleKeyId = opts.keyId ?? await prompt("Apple API Key ID: ");
  const issuerId = opts.issuerId ?? await prompt("Apple Issuer ID: ");
  const file = opts.file ?? await prompt(".p8 file path: ");

  if (!fs.existsSync(file)) {
    console.error(chalk.red(`File not found: ${file}`));
    process.exit(1);
  }

  const p8Content = fs.readFileSync(file, "utf8").trim();

  try {
    await saveAppleKey({ appleKeyId, issuerId, p8Content });
    console.log(chalk.green(`\nSaved Apple API key ${appleKeyId}.`));
  } catch (err: unknown) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

export async function listKeysCommand(): Promise<void> {
  if (!getToken()) {
    console.error(chalk.red("Not logged in. Run: ferome login"));
    process.exit(1);
  }

  try {
    const keys = await listAppleKeys();

    if (keys.length === 0) {
      console.log(chalk.dim("\nNo Apple API keys saved. Run: ferome keys add"));
      return;
    }

    console.log(`\n${chalk.bold("Apple API keys:")}\n`);
    for (const key of keys) {
      const date = new Date(key.createdAt).toLocaleDateString();
      console.log(`${chalk.cyan(key.appleKeyId)}  ${chalk.dim(key.issuerId)}  ${chalk.dim(date)}`);
    }
  } catch (err: unknown) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
