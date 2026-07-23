import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import archiver from "archiver";

export type ProjectType = "EXPO" | "XCODE" | "FLUTTER" | "REACT_NATIVE" | "MAUI" | "UNKNOWN";

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

  // Flutter: has pubspec.yaml and an ios/ Xcode project (Runner.xcodeproj/.xcworkspace)
  const pubspecYaml = path.join(dir, "pubspec.yaml");
  if (fs.existsSync(pubspecYaml)) {
    const iosDir = path.join(dir, "ios");
    if (fs.existsSync(iosDir) && hasXcodeProject(iosDir)) return "FLUTTER";
  }

  // Bare React Native: package.json depends on react-native, with an ios/ Xcode project
  const packageJson = path.join(dir, "package.json");
  if (fs.existsSync(packageJson)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));
      const hasReactNative = Boolean(pkg.dependencies?.["react-native"] ?? pkg.devDependencies?.["react-native"]);
      const iosDir = path.join(dir, "ios");
      if (hasReactNative && fs.existsSync(iosDir) && hasXcodeProject(iosDir)) return "REACT_NATIVE";
    } catch {}
  }

  // .NET MAUI: a .csproj (root or one level down) with <UseMaui>true</UseMaui>
  if (findMauiProjectFile(dir)) return "MAUI";

  // Xcode: has a .xcodeproj or .xcworkspace
  if (hasXcodeProject(dir)) return "XCODE";

  return "UNKNOWN";
}

function findCsprojFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".csproj")) {
      results.push(path.join(dir, entry.name));
    } else if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "bin" && entry.name !== "obj") {
      const nested = path.join(dir, entry.name);
      for (const nestedEntry of fs.readdirSync(nested, { withFileTypes: true })) {
        if (nestedEntry.isFile() && nestedEntry.name.endsWith(".csproj")) {
          results.push(path.join(nested, nestedEntry.name));
        }
      }
    }
  }

  return results;
}

export function findMauiProjectFile(dir: string): string | null {
  for (const csproj of findCsprojFiles(dir)) {
    const content = fs.readFileSync(csproj, "utf8");
    if (/<UseMaui>\s*true\s*<\/UseMaui>/i.test(content)) return csproj;
  }
  return null;
}

function hasXcodeProject(dir: string): boolean {
  const entries = fs.readdirSync(dir);
  return entries.some((e) => e.endsWith(".xcodeproj") || e.endsWith(".xcworkspace"));
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
  if (type === "FLUTTER" || type === "REACT_NATIVE") return findXcodeBundleId(path.join(dir, "ios"));
  if (type === "MAUI") return findMauiBundleId(dir);
  return null;
}

// Falls back to the local git remote when no .ferome config has a saved repo yet
// (e.g. a fresh clone, or a project type like MAUI that has no package.json to
// infer anything from in the first place).
export function detectGitHubRepo(dir: string): string | null {
  let remoteUrl: string;
  try {
    remoteUrl = execSync("git remote get-url origin", { cwd: dir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }

  if (!remoteUrl) return null;

  const withoutProtocol = remoteUrl.replace(/^https?:\/\//, "").replace(/^git@github\.com:/, "github.com/");
  const withoutHost = withoutProtocol.replace(/^github\.com\//, "");
  const repo = withoutHost.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");

  return /^[^/]+\/[^/]+$/.test(repo) ? repo : null;
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

function findMauiBundleId(dir: string): string | null {
  const csproj = findMauiProjectFile(dir);
  if (!csproj) return null;

  const content = fs.readFileSync(csproj, "utf8");

  // Prefer an iOS-specific override (Condition mentioning "ios") over the shared default.
  const iosSpecific = [...content.matchAll(/<ApplicationId\s+Condition="[^"]*ios[^"]*"[^>]*>([^<]+)<\/ApplicationId>/gi)];
  if (iosSpecific[0]?.[1]) return iosSpecific[0][1].trim();

  const generic = content.match(/<ApplicationId>([^<]+)<\/ApplicationId>/i);
  if (generic?.[1]) return generic[1].trim();

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
        "ios/.symlinks/**",
        "ios/Flutter/ephemeral/**",
        "ios/Flutter/Generated.xcconfig",
        "ios/Flutter/flutter_export_environment.sh",
        "ios/Flutter/App.framework/**",
        "ios/Flutter/Flutter.framework/**",
        "ios/Flutter/Flutter.podspec",
        "ios/Flutter/.last_build_id",
        ".dart_tool/**",
        "android/**",
        "linux/**",
        "macos/**",
        "web/**",
        "windows/**",
        ".expo/**",
        "dist/**",
        "build/**",
        "bin/**",
        "obj/**",
        "**/bin/**",
        "**/obj/**",
        "*.ipa",
        "*.zip",
      ],
    });

    archive.finalize();
  });
}
