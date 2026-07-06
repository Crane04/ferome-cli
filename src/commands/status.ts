import chalk from "chalk";
import { getBuild, listBuilds, listProjects, Build } from "../api.js";
import { getToken } from "../config.js";

function statusColor(status: Build["status"]): string {
  switch (status) {
    case "SUCCESS": return chalk.green(status);
    case "FAILED":  return chalk.red(status);
    case "STARTED": return chalk.yellow(status);
    case "QUEUED":  return chalk.dim(status);
  }
}

export async function statusCommand(buildId: string): Promise<void> {
  if (!getToken()) {
    console.error(chalk.red("Not logged in. Run: ferome login"));
    process.exit(1);
  }

  try {
    const build = await getBuild(buildId);

    console.log(`\nBuild ${chalk.cyan(build.id)}`);
    if (build.project) {
      console.log(`Project: ${build.project.name} (${build.project.githubOwner}/${build.project.githubRepo})`);
    }
    console.log(`Status : ${statusColor(build.status)}`);
    console.log(`Type   : ${build.type}`);
    console.log(`Created: ${new Date(build.createdAt).toLocaleString()}`);

    if (build.githubRunUrl) {
      console.log(`${chalk.bold("Logs   :")} ${chalk.cyan(build.githubRunUrl)}`);
    } else if (build.githubWorkflowUrl) {
      console.log(`${chalk.bold("Workflow:")} ${chalk.cyan(build.githubWorkflowUrl)}`);
    }

    if (build.ipaUrl) {
      console.log(`\n${chalk.bold("IPA:")} ${chalk.cyan(build.ipaUrl)}`);
    }

    if (build.logs && build.status === "FAILED") {
      console.log(`\n${chalk.dim("Logs:")}\n${build.logs}`);
    }
  } catch (err: unknown) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

export async function buildsCommand(): Promise<void> {
  if (!getToken()) {
    console.error(chalk.red("Not logged in. Run: ferome login"));
    process.exit(1);
  }

  try {
    const builds = await listBuilds();

    if (builds.length === 0) {
      console.log(chalk.dim("\nNo builds yet. Run: ferome build"));
      return;
    }

    console.log(`\n${chalk.bold("Recent builds:")}\n`);

    for (const build of builds) {
      const date = new Date(build.createdAt).toLocaleDateString();
      const name = build.project?.name ?? build.bundleId ?? "unknown";
      console.log(`${chalk.cyan(build.id.slice(0, 12))}  ${statusColor(build.status).padEnd(10)}  ${build.type.padEnd(5)}  ${date}  ${name}`);
    }
  } catch (err: unknown) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

export async function projectsCommand(): Promise<void> {
  if (!getToken()) {
    console.error(chalk.red("Not logged in. Run: ferome login"));
    process.exit(1);
  }

  try {
    const projects = await listProjects();

    if (projects.length === 0) {
      console.log(chalk.dim("\nNo projects yet. Run: ferome build"));
      return;
    }

    console.log(`\n${chalk.bold("Projects:")}\n`);

    for (const project of projects) {
      const repo = `${project.githubOwner}/${project.githubRepo}`;
      const latest = project.builds[0];
      const status = latest ? statusColor(latest.status) : chalk.dim("NO BUILDS");
      console.log(`${chalk.cyan(project.id.slice(0, 12))}  ${status.padEnd(10)}  ${project.type.padEnd(5)}  ${project.name}  ${chalk.dim(repo)}  ${chalk.dim(project.bundleId)}`);
    }
  } catch (err: unknown) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
