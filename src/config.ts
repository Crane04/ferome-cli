import Conf from "conf";

interface FeromeConfig {
  token: string;
}

export const SERVER_URL = "https://api.ferome.dev";

export const config = new Conf<FeromeConfig>({
  projectName: "ferome",
  defaults: {
    token: "",
  },
});

export function getToken(): string | null {
  const token = config.get("token");
  return token || null;
}

export function saveToken(token: string): void {
  config.set("token", token);
}

export function clearAuth(): void {
  config.set("token", "");
}
