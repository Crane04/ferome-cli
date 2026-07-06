#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { loginCommand } from "./commands/login.js";
import { buildCommand } from "./commands/build.js";
import { statusCommand, buildsCommand, projectsCommand } from "./commands/status.js";
import { serverCommand, setServerCommand } from "./commands/server.js";
import { addKeyCommand, listKeysCommand } from "./commands/keys.js";
import { workflowCommand } from "./commands/workflow.js";
import { resetCommand } from "./commands/reset.js";
import { expoTokenCommand } from "./commands/expo.js";

const program = new Command();

program
  .name("ferome")
  .description(chalk.bold("iOS builds for Windows developers. No Mac required."))
  .version("0.1.0");

program
  .command("login")
  .description("Authenticate with GitHub")
  .action(loginCommand);

const server = program
  .command("server")
  .description("Show or change the Ferome API server");

server
  .command("show")
  .description("Show the configured Ferome API server")
  .action(serverCommand);

server
  .command("set <url>")
  .description("Set the Ferome API server")
  .action(setServerCommand);

const keys = program
  .command("keys")
  .description("Manage Apple API keys");

keys
  .command("add")
  .description("Save an Apple App Store Connect API key")
  .option("--key-id <id>", "Apple App Store Connect API key ID")
  .option("--issuer-id <id>", "Apple issuer ID")
  .option("--file <path>", "Path to the .p8 private key file")
  .action(addKeyCommand);

keys
  .command("list")
  .description("List saved Apple API keys")
  .action(listKeysCommand);

const expo = program
  .command("expo")
  .description("Expo helper commands");

expo
  .command("token")
  .description("Show how to create and save the EXPO_TOKEN secret")
  .action(expoTokenCommand);

program
  .command("build")
  .description("Trigger an iOS build for the current project")
  .option("--project-name <name>", "Name to use when creating/updating the Ferome project")
  .option("--bundle-id <id>", "Bundle identifier (e.g. com.yourco.app)")
  .option("--repo <owner/repo>", "GitHub repo to run the workflow in")
  .option("--apple-key-id <id>", "Apple App Store Connect API key ID")
  .option("--scheme <scheme>", "Xcode scheme (Xcode projects only)")
  .option("--auto-submit", "Submit the built app after a successful build")
  .action((opts) =>
    buildCommand({
      projectName: opts.projectName,
      bundleId: opts.bundleId,
      repo: opts.repo,
      appleKeyId: opts.appleKeyId,
      scheme: opts.scheme,
      autoSubmit: opts.autoSubmit,
    })
  );

program
  .command("init")
  .description("Set up the current project for Ferome builds")
  .option("--force", "Overwrite an existing Ferome workflow")
  .option("--type <type>", "Project type to set up: EXPO or XCODE")
  .action(workflowCommand);

program
  .command("workflow")
  .description("Install the Ferome GitHub Actions workflow in the current project")
  .option("--force", "Overwrite an existing Ferome workflow")
  .option("--type <type>", "Project type to install workflow for: EXPO or XCODE")
  .action(workflowCommand);

program
  .command("reset")
  .description("Reset saved Ferome settings for the current project")
  .action(resetCommand);

program
  .command("status <buildId>")
  .description("Check the status of a build")
  .action(statusCommand);

program
  .command("builds")
  .description("List your recent builds")
  .action(buildsCommand);

program
  .command("projects")
  .description("List your Ferome projects")
  .action(projectsCommand);

program.parse(process.argv);
