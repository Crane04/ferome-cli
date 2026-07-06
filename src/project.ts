import fs from "fs";
import path from "path";
import archiver from "archiver";

export type ProjectType = "EXPO" | "XCODE" | "UNKNOWN";

export interface FeromeProjectConfig {
  projectId?: string;
  projectName?: string;
  type?: Exclude<ProjectType, "UNKNOWN">;
  bundleId?: string;
  githubRepo?: string;
  appleKeyId?: string;
  scheme?: string;
}

const FEROME_DIR = ".ferome";
const FEROME_CONFIG = "config.json";

export function detectProjectType(dir: string): ProjectType {
  // Expo: has app.json or app.config.js/ts with expo field, or eas.json
  const appJson = path.join(dir, "app.json");
  const easJson = path.join(dir, "eas.json");

  if (fs.existsSync(easJson)) return "EXPO";

  if (fs.existsSync(appJson)) {
    try {
      const json = JSON.parse(fs.readFileSync(appJson, "utf8"));
      if (json.expo) return "EXPO";
    } catch {}
  }

  // Xcode: has a .xcodeproj or .xcworkspace
  const entries = fs.readdirSync(dir);
  const hasXcode = entries.some(
    (e) => e.endsWith(".xcodeproj") || e.endsWith(".xcworkspace")
  );
  if (hasXcode) return "XCODE";

  return "UNKNOWN";
}

export function findXcodeScheme(dir: string): string | null {
  const entries = fs.readdirSync(dir);
  const xcodeproj = entries.find((e) => e.endsWith(".xcodeproj"));
  if (xcodeproj) return path.basename(xcodeproj, ".xcodeproj");
  return null;
}

export function findBundleId(dir: string, type: ProjectType): string | null {
  if (type === "EXPO") return findExpoBundleId(dir);
  if (type === "XCODE") return findXcodeBundleId(dir);
  return null;
}

export function readProjectConfig(dir: string): FeromeProjectConfig {
  const configPath = path.join(dir, FEROME_DIR, FEROME_CONFIG);
  if (!fs.existsSync(configPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as FeromeProjectConfig;
  } catch {
    return {};
  }
}

export function saveProjectConfig(dir: string, config: FeromeProjectConfig): void {
  const configDir = path.join(dir, FEROME_DIR);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, FEROME_CONFIG),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8"
  );
}

export function resetProjectConfig(dir: string): boolean {
  const configPath = path.join(dir, FEROME_DIR, FEROME_CONFIG);
  if (!fs.existsSync(configPath)) return false;

  fs.unlinkSync(configPath);
  return true;
}

function findExpoBundleId(dir: string): string | null {
  const appJson = path.join(dir, "app.json");
  if (fs.existsSync(appJson)) {
    try {
      const json = JSON.parse(fs.readFileSync(appJson, "utf8"));
      const bundleId = json.expo?.ios?.bundleIdentifier ?? json.ios?.bundleIdentifier;
      if (typeof bundleId === "string" && bundleId.trim()) return bundleId.trim();
    } catch {}
  }

  for (const filename of ["app.config.js", "app.config.ts"]) {
    const configPath = path.join(dir, filename);
    if (!fs.existsSync(configPath)) continue;

    const content = fs.readFileSync(configPath, "utf8");
    const match = content.match(/bundleIdentifier\s*:\s*["']([^"']+)["']/);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

function findXcodeBundleId(dir: string): string | null {
  const entries = fs.readdirSync(dir);
  const xcodeproj = entries.find((entry) => entry.endsWith(".xcodeproj"));
  if (!xcodeproj) return null;

  const pbxproj = path.join(dir, xcodeproj, "project.pbxproj");
  if (!fs.existsSync(pbxproj)) return null;

  const content = fs.readFileSync(pbxproj, "utf8");
  const match = content.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/);
  if (!match?.[1]) return null;

  return match[1].trim().replace(/^"|"$/g, "");
}

export function zipProject(dir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 6 } });

    output.on("close", resolve);
    archive.on("error", reject);

    archive.pipe(output);

    // Add project files, skip common noise
    archive.glob("**/*", {
      cwd: dir,
      ignore: [
        "node_modules/**",
        ".git/**",
        ".ferome/**",
        "ios/Pods/**",
        "android/**",
        ".expo/**",
        "dist/**",
        "build/**",
        "*.ipa",
        "*.zip",
      ],
    });

    archive.finalize();
  });
}
