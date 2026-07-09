# ferome

iOS builds for Windows developers. No Mac required.

```sh
npm i -g @ferome/cli
```

Requires a free account at [ferome.dev](https://ferome.dev) — sign in with GitHub, then:

```sh
ferome login
```

## Quick start

```sh
ferome login          # authenticate once
ferome init            # write the GitHub Actions workflow for this project
ferome build           # zip, upload, build, and download the signed .ipa
```

## Commands

| Command | Description |
| --- | --- |
| `ferome login` | Authenticate with GitHub |
| `ferome init` | Detect the project type and write its GitHub Actions workflow |
| `ferome workflow` | Same as `init` — installs the workflow file |
| `ferome build` | Trigger an iOS build for the current project |
| `ferome status <buildId>` | Check the status of a specific build |
| `ferome builds` | List your recent builds |
| `ferome projects` | List your Ferome projects |
| `ferome keys add` | Save an Apple App Store Connect API key |
| `ferome keys list` | List saved Apple API keys |
| `ferome keys rename <keyId> <name>` | Rename a saved Apple API key |
| `ferome keys remove <keyId>` | Delete a saved Apple API key |
| `ferome expo token` | Show how to create and save the `EXPO_TOKEN` secret |
| `ferome reset` | Clear the local `.ferome/config.json` for this project |

Every command below also supports `--help`.

### `ferome login`

Opens `https://api.ferome.dev/auth/github?cli=1` in your default browser and starts a short-lived local server on `http://localhost:9898` to receive the token GitHub redirects back with. If a browser doesn't open automatically, the URL is printed so you can open it yourself. The flow times out after 2 minutes. On success, the auth token is saved to your OS's standard app-config directory (via the `conf` package) and reused by every other command — no need to log in again per project.

### `ferome init` / `ferome workflow`

Detects your project type (see [Project detection](#project-detection)) and writes the matching workflow to `.github/workflows/`:

```txt
.github/workflows/expo-ios-build.yml
.github/workflows/flutter-ios-build.yml
.github/workflows/react-native-ios-build.yml
.github/workflows/xcode-ios-build.yml
```

| Flag | Description |
| --- | --- |
| `--force` | Overwrite an existing Ferome workflow file |
| `--type <EXPO\|FLUTTER\|REACT_NATIVE\|XCODE>` | Skip auto-detection and set the project type explicitly |

Commit and push the workflow file before running `ferome build` — Ferome dispatches it as a GitHub Actions `workflow_dispatch` run in your own repo.

Expo projects also need an Expo access token saved as a GitHub Actions secret. `ferome init` prints the setup steps automatically when it writes an Expo workflow; run `ferome expo token` to see them again anytime.

### `ferome build`

Zips the current directory, uploads it, and triggers a build on a GitHub Actions macOS runner in your own repo, then polls for the result (checks every 15s, up to 30 minutes) and prints the signed `.ipa` download URL on success.

| Flag | Description |
| --- | --- |
| `--project-name <name>` | Name to use when creating/updating the Ferome project |
| `--bundle-id <id>` | Bundle identifier, e.g. `com.yourco.app` |
| `--repo <owner/repo>` | GitHub repo to run the workflow in |
| `--apple-key-id <id>` | Apple App Store Connect API key ID to sign with |
| `--scheme <scheme>` | Xcode scheme (Xcode and bare React Native/Flutter projects) |
| `--auto-submit` | Submit to App Store Connect after a successful build — **Expo projects only**; other project types build and upload the `.ipa` but don't submit |

Any flag you omit is either auto-detected (bundle ID, Xcode scheme), read from the saved project config, or prompted for interactively. If you have more than one saved Apple API key and don't pass `--apple-key-id`, you're prompted to pick one; if you have exactly one, it's used automatically.

Settings used for a successful build are remembered in `.ferome/config.json` in the project directory, so subsequent `ferome build` runs in the same project need fewer flags/prompts. Files matching `node_modules/`, `.git/`, `.ferome/`, `ios/Pods/`, `ios/.symlinks/`, `ios/Flutter/ephemeral/`, `.dart_tool/`, `android/`, `.expo/`, `dist/`, `build/`, `*.ipa`, and `*.zip` are excluded from the upload.

### `ferome status <buildId>`

Prints a single build's status, type, project, creation time, a link to the GitHub Actions run (or the workflow, if it hasn't started yet), the `.ipa` URL if finished, and the last known logs if it failed.

### `ferome builds`

Lists your 20 most recent builds with their ID, status, type, date, and project name.

### `ferome projects`

Lists your Ferome projects with their most recent build status, type, name, GitHub repo, and bundle ID.

## Apple API keys

Save an App Store Connect API key before running builds:

```sh
ferome keys add \
  --name "Production team" \
  --key-id YOUR_KEY_ID \
  --issuer-id YOUR_ISSUER_ID \
  --file ~/Downloads/AuthKey_YOUR_KEY_ID.p8
```

`--name` is optional — a label shown in `ferome keys list`. Any flag you omit is prompted for interactively.

List, rename, or remove saved keys:

```sh
ferome keys list
ferome keys rename <keyId> "Production team"
ferome keys remove <keyId>
```

## Expo token setup

Expo projects need an Expo access token saved in the GitHub repo as an Actions secret:

```txt
EXPO_TOKEN
```

Show the setup command anytime with:

```sh
ferome expo token
```

This prints a link to create the token at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens) and the `gh secret set` command to save it to the right repo.

## Project detection

`ferome init`/`ferome workflow`/`ferome build` detect the project type from the current directory:

| Type | Detected by |
| --- | --- |
| `EXPO` | `eas.json`, or `app.json`/`app.config.js`/`app.config.ts` with an `expo` field |
| `FLUTTER` | `pubspec.yaml` + an `ios/` directory containing an Xcode project |
| `REACT_NATIVE` | `package.json` depending on `react-native` + an `ios/` directory containing an Xcode project |
| `XCODE` | A `.xcodeproj` or `.xcworkspace` in the project root |

Bundle IDs are read from `app.json`/`app.config.(js\|ts)` for Expo, or from `PRODUCT_BUNDLE_IDENTIFIER` in `project.pbxproj` for Xcode/Flutter/React Native.

## Resetting local settings

Ferome remembers project settings (bundle ID, repo, scheme, Apple key, project/build IDs) in `.ferome/config.json` after the first build. Delete that local cache with:

```sh
ferome reset
```

This only clears local project settings — it doesn't affect your login, saved Apple API keys, or anything on the server.
