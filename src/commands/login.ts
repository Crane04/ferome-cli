import chalk from "chalk";
import { SERVER_URL, saveToken } from "../config.js";
import http from "http";
import { exec } from "child_process";
import { URL } from "url";

export async function loginCommand(): Promise<void> {
  const loginUrl = `${SERVER_URL}/auth/github?cli=1`;

  console.log(chalk.bold("\nferome login\n"));
  console.log("Opening GitHub to authenticate...");
  console.log(chalk.dim(`If the browser doesn't open, visit:\n${loginUrl}\n`));

  // Open browser
  const opener = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${opener} "${loginUrl}"`);

  // Start local callback server to capture token
  const token = await waitForToken();

  if (!token) {
    console.error(chalk.red("Login failed. No token received."));
    process.exit(1);
  }

  saveToken(token);
  console.log(chalk.green("\nLogged in successfully."));
}

function waitForToken(): Promise<string | null> {
  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, "http://localhost:9898");
      const token = url.searchParams.get("token");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family:sans-serif;padding:40px">
          <h2>ferome</h2>
          <p>${token ? "Authenticated. You can close this tab." : "Authentication failed."}</p>
        </body></html>
      `);

      clearTimeout(timeout);
      server.close(() => resolve(token));
    });

    server.listen(9898, () => {
      // Server is waiting for GitHub to redirect back
    });

    // Timeout after 2 minutes
    timeout = setTimeout(() => {
      server.close(() => resolve(null));
    }, 120_000);
  });
}
