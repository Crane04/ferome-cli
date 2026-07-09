import { getToken, getServerUrl } from "./config.js";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const url = `${getServerUrl()}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      message = formatApiError(parsed.error) ?? message;
    } catch {}
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

function formatApiError(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (Array.isArray(error)) return error.map(String).join(", ");

  if (typeof error === "object") {
    const flattened = error as {
      formErrors?: unknown[];
      fieldErrors?: Record<string, unknown[]>;
    };
    const messages: string[] = [];

    for (const item of flattened.formErrors ?? []) {
      messages.push(String(item));
    }

    for (const [field, items] of Object.entries(flattened.fieldErrors ?? {})) {
      for (const item of items ?? []) {
        messages.push(`${field}: ${String(item)}`);
      }
    }

    if (messages.length > 0) return messages.join("\n");
    return JSON.stringify(error);
  }

  return String(error);
}

export interface Build {
  id: string;
  projectId?: string;
  status: "QUEUED" | "STARTED" | "SUCCESS" | "FAILED";
  type: "EXPO" | "XCODE" | "FLUTTER" | "REACT_NATIVE";
  bundleId?: string;
  project?: {
    id: string;
    name: string;
    githubOwner: string;
    githubRepo: string;
  };
  githubRunId?: string | null;
  githubRunUrl?: string | null;
  githubWorkflowUrl?: string | null;
  ipaUrl?: string;
  logs?: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  type: "EXPO" | "XCODE" | "FLUTTER" | "REACT_NATIVE";
  bundleId: string;
  githubOwner: string;
  githubRepo: string;
  defaultScheme?: string | null;
  appleKeyId: string;
  createdAt: string;
  updatedAt: string;
  _count: { builds: number };
  builds: Array<{ id: string; status: Build["status"]; createdAt: string }>;
}

export interface AppleApiKey {
  name?: string | null;
  appleKeyId: string;
  issuerId: string;
  createdAt: string;
}

export async function triggerBuild(formData: FormData): Promise<{ buildId: string; projectId: string; status: string }> {
  return request("/builds", {
    method: "POST",
    body: formData,
  });
}

export async function getBuild(buildId: string): Promise<Build> {
  return request<Build>(`/builds/${buildId}`);
}

export async function listBuilds(): Promise<Build[]> {
  return request<Build[]>("/builds");
}

export async function listProjects(): Promise<Project[]> {
  return request<Project[]>("/builds/projects");
}

export async function listAppleKeys(): Promise<AppleApiKey[]> {
  return request<AppleApiKey[]>("/builds/keys");
}

export async function saveAppleKey(data: {
  appleKeyId: string;
  issuerId: string;
  p8Content: string;
  name?: string;
}): Promise<void> {
  return request("/builds/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function renameAppleKey(appleKeyId: string, name: string): Promise<void> {
  return request(`/builds/keys/${encodeURIComponent(appleKeyId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function deleteAppleKey(appleKeyId: string): Promise<void> {
  return request(`/builds/keys/${encodeURIComponent(appleKeyId)}`, { method: "DELETE" });
}
