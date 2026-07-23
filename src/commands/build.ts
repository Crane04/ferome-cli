import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import {
  detectGitHubRepo,
  detectProjectType,
  findBundleId,
  findXcodeScheme,
  readProjectConfig,
  saveProjectConfig,
  zipProject,
} from "../project.js";
import { triggerBuild, getBuild, listAppleKeys } from "../api.js";
import { getToken } from "../config.js";

interface BuildOptions {
  projectName?: string;
  bundleId?: string;
  repo?: string;
  appleKeyId?: string;
  scheme?: string;
  autoSubmit?: boolean;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

async function promptWithDefault(question: string, defaultValue: string | null): Promise<string> {
  if (!defaultValue) return prompt(question);

  const answer = await prompt(`${question} (${defaultValue}): `);
  return answer || defaultValue;
}

function normalizeGitHubRepo(input: string): string {
  const trimmed = input.trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "").replace(/^git@github\.com:/, "github.com/");
  const withoutHost = withoutProtocol.replace(/^github\.com\//, "");
  return withoutHost.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
}

async function resolveAppleKeyId(optionKeyId?: string): Promise<string> {
  if (optionKeyId) return optionKeyId;

  const keys = await listAppleKeys();

  if (keys.length === 1) {
    console.log(chalk.dim(`Using Apple API key: ${keys[0].appleKeyId}`));
    return keys[0].appleKeyId;
  }

  if (keys.length > 1) {
    console.log(chalk.dim("\nSaved Apple API keys:"));
    for (const key of keys) {
      console.log(chalk.dim(`- ${key.appleKeyId}`));
    }
    return prompt("\nApple API Key ID: ");
  }

  console.error(chalk.red("No Apple API keys saved. Run: ferome keys add"));
  process.exit(1);
}

export async function buildCommand(opts: BuildOptions): Promise<void> {
  console.log(chalk.bold("\nferome build\n"));

  if (!getToken()) {
    console.error(chalk.red("Not logged in. Run: ferome login"));
    process.exit(1);
  }

  const cwd = process.cwd();
  const projectConfig = readProjectConfig(cwd);

  // Detect project type
  const spinner = ora("Detecting project type...").start();
  const type = detectProjectType(cwd);

  if (type === "UNKNOWN") {
    spinner.fail("Could not detect project type. Make sure you're in an Expo, Flutter, React Native, .NET MAUI, or Xcode project root.");
    process.exit(1);
  }

  spinner.succeed(`Detected ${chalk.cyan(type)} project`);

  // Gather required info
  const detectedBundleId = findBundleId(cwd, type);
  const bundleId = opts.bundleId ?? await promptWithDefault("Bundle identifier", projectConfig.bundleId ?? detectedBundleId);
  const repoInput = opts.repo ?? await promptWithDefault("Your GitHub repo", projectConfig.githubRepo ?? detectGitHubRepo(cwd));
  const repo = normalizeGitHubRepo(repoInput);
  const appleKeyId = await resolveAppleKeyId(opts.appleKeyId ?? projectConfig.appleKeyId);

  let scheme = opts.scheme ?? projectConfig.scheme;
  if (type === "XCODE" && !scheme) {
    const detected = findXcodeScheme(cwd);
    scheme = detected ?? await prompt("Xcode scheme: ");
    console.log(chalk.dim(`Using scheme: ${scheme}`));
  }
  if (type === "FLUTTER" && !scheme) {
    scheme = findXcodeScheme(path.join(cwd, "ios")) ?? "Runner";
    console.log(chalk.dim(`Using scheme: ${scheme}`));
  }
  if (type === "REACT_NATIVE" && !scheme) {
    const detected = findXcodeScheme(path.join(cwd, "ios"));
    scheme = detected ?? await prompt("Xcode scheme: ");
    console.log(chalk.dim(`Using scheme: ${scheme}`));
  }

  // Zip project
  const zipSpinner = ora("Zipping project...").start();
  const tmpDir = os.tmpdir();
  const zipPath = path.join(tmpDir, `ferome-${Date.now()}.zip`);

  try {
    await zipProject(cwd, zipPath);
    const bytes = fs.statSync(zipPath).size;
    const sizeLabel = bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    zipSpinner.succeed(`Project zipped (${sizeLabel})`);
  } catch (err) {
    zipSpinner.fail("Failed to zip project");
    console.error(err);
    process.exit(1);
  }

  // Upload and trigger
  const uploadSpinner = ora("Uploading and triggering build...").start();

  try {
    const formData = new FormData();
    const blob = new Blob([fs.readFileSync(zipPath)], { type: "application/zip" });
    formData.append("project", blob, "project.zip");
    formData.append("type", type);
    formData.append("bundleId", bundleId);
    formData.append("githubRepo", repo);
    formData.append("appleKeyId", appleKeyId);
    formData.append("autoSubmit", opts.autoSubmit ? "true" : "false");
    if (opts.projectName) formData.append("projectName", opts.projectName);
    if (scheme) formData.append("scheme", scheme);

    const result = await triggerBuild(formData);
    uploadSpinner.succeed(`Build queued — ID: ${chalk.cyan(result.buildId)} Project: ${chalk.cyan(result.projectId)}`);

    saveProjectConfig(cwd, {
      ...projectConfig,
      projectId: result.projectId,
      projectName: opts.projectName ?? projectConfig.projectName,
      type,
      bundleId,
      githubRepo: repo,
      appleKeyId,
      scheme,
    });

    // Clean up zip
    fs.unlinkSync(zipPath);

    // Poll for result
    console.log(chalk.dim("\nWaiting for build to complete (this takes 10–20 min)...\n"));
    await pollBuild(result.buildId);
  } catch (err: unknown) {
    uploadSpinner.fail("Failed to trigger build");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    fs.unlinkSync(zipPath);
    process.exit(1);
  }
}

async function pollBuild(buildId: string): Promise<void> {
  const spinner = ora("Build running on macOS runner...").start();
  const INTERVAL = 15_000; // 15 seconds
  const MAX_WAIT = 30 * 60 * 1000; // 30 min
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT) {
    await sleep(INTERVAL);

    try {
      const build = await getBuild(buildId);

      if (build.status === "SUCCESS") {
        spinner.succeed(chalk.green("Build succeeded!"));
        if (build.ipaUrl) {
          console.log(`\n${chalk.bold("IPA download URL:")}`);
          console.log(chalk.cyan(build.ipaUrl));
          console.log(chalk.dim("\nNote: GitHub artifact links require a GitHub login to download."));
        }
        if (build.submittedAt) {
          console.log(chalk.green("\nSubmitted to App Store Connect."));
        } else if (build.submitError) {
          console.log(chalk.yellow(`\nSubmission to App Store Connect failed: ${build.submitError}`));
        }
        return;
      }

      if (build.status === "FAILED") {
        spinner.fail(chalk.red("Build failed"));
        if (build.logs) console.log(chalk.dim(build.logs));
        process.exit(1);
      }

      // Still running
      const elapsed = Math.round((Date.now() - start) / 1000 / 60);
      spinner.text = `Build running... (${elapsed}m elapsed)`;
    } catch {
      // Network hiccup, keep polling
    }
  }

  spinner.fail("Timed out waiting for build. Check status with: ferome status " + buildId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
