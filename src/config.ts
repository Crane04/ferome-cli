import Conf from "conf";

interface FeromeConfig {
  token: string;
  serverUrl: string;
}

export const config = new Conf<FeromeConfig>({
  projectName: "ferome",
  defaults: {
    token: "",
    serverUrl: "https://api.ferome.dev",
  },
});

export function getToken(): string | null {
  const token = config.get("token");
  return token || null;
}

export function saveToken(token: string): void {
  config.set("token", token);
}

export function getServerUrl(): string {
  if (process.env.FEROME_SERVER_URL) {
    return normalizeServerUrl(process.env.FEROME_SERVER_URL);
  }

  return config.get("serverUrl");
}

export function setServerUrl(serverUrl: string): void {
  config.set("serverUrl", normalizeServerUrl(serverUrl));
}

export function clearAuth(): void {
  config.set("token", "");
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}
