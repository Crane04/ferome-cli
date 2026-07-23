import chalk from "chalk";
import fs from "fs";
import path from "path";
import { detectProjectType, ProjectType, readProjectConfig } from "../project.js";

interface WorkflowOptions {
  force?: boolean;
  type?: ProjectType;
}

const WORKFLOW_FILES: Record<Exclude<ProjectType, "UNKNOWN">, string> = {
  EXPO: "expo-ios-build.yml",
  XCODE: "xcode-ios-build.yml",
  FLUTTER: "flutter-ios-build.yml",
  REACT_NATIVE: "react-native-ios-build.yml",
  MAUI: "maui-ios-build.yml",
};

export function workflowCommand(opts: WorkflowOptions): void {
  const cwd = process.cwd();
  const type = resolveProjectType(cwd, opts.type);

  if (type === "UNKNOWN") {
    console.error(chalk.red("Could not detect project type. Run this from an Expo, Flutter, React Native, .NET MAUI, or Xcode project, or pass --type EXPO/FLUTTER/REACT_NATIVE/MAUI/XCODE."));
    process.exit(1);
  }

  const workflowsDir = path.join(cwd, ".github", "workflows");
  const filename = WORKFLOW_FILES[type];
  const workflowPath = path.join(workflowsDir, filename);

  if (fs.existsSync(workflowPath) && !opts.force) {
    console.error(chalk.red(`Workflow already exists: ${path.relative(cwd, workflowPath)}`));
    console.log(chalk.dim("Run with --force to overwrite it."));
    process.exit(1);
  }

  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.writeFileSync(workflowPath, workflowTemplate(type), "utf8");

  console.log(chalk.green(`Created ${path.relative(cwd, workflowPath)}`));
  if (type === "EXPO") {
    printExpoTokenSetup(cwd);
  }
  console.log(chalk.dim("Commit and push this workflow file before running ferome build."));
}

function resolveProjectType(dir: string, optionType?: ProjectType): ProjectType {
  if (optionType && optionType !== "UNKNOWN") return optionType;
  return detectProjectType(dir);
}

function workflowTemplate(type: Exclude<ProjectType, "UNKNOWN">): string {
  if (type === "EXPO") return expoWorkflow;
  if (type === "FLUTTER") return flutterWorkflow;
  if (type === "REACT_NATIVE") return reactNativeWorkflow;
  if (type === "MAUI") return mauiWorkflow;
  return xcodeWorkflow;
}

function printExpoTokenSetup(dir: string): void {
  const projectConfig = readProjectConfig(dir);
  const repo = projectConfig.githubRepo ?? "<owner/repo>";

  console.log("");
  console.log(chalk.bold("Expo token setup"));
  console.log("Create an Expo access token:");
  console.log(chalk.cyan("https://expo.dev/settings/access-tokens"));
  console.log("");
  console.log("Then save it to this GitHub repo:");
  console.log(chalk.cyan(`gh secret set EXPO_TOKEN -R ${repo}`));
  console.log(chalk.dim("Paste the Expo token when the GitHub CLI prompts for the secret value."));
  console.log("");
}

const commonInputs = `      project_url:
        required: true
        type: string
      apple_api_key_id:
        required: true
        type: string
      apple_issuer_id:
        required: true
        type: string
      apple_api_key_content:
        required: true
        type: string
      app_identifier:
        required: true
        type: string
      scheme:
        required: false
        type: string
      build_id:
        required: true
        type: string
      callback_url:
        required: true
        type: string
      upload_url:
        required: true
        type: string
      auto_submit:
        required: false
        type: boolean
        default: false`;

// Fetches the Distribution Certificate + Provisioning Profile Ferome auto-provisions
// via Apple's App Store Connect API, and imports them into a temporary Keychain so
// xcodebuild can code-sign locally. Used by the Xcode/Flutter/React Native workflows
// (Expo consumes the same endpoint differently, via credentials.json for EAS).
const fetchAndInstallCredentialsStep = `      - name: Fetch and install iOS signing credentials
        run: |
          UPLOAD_URL="\${{ inputs.upload_url }}"
          BASE_URL=$(echo "$UPLOAD_URL" | sed -E 's#(https?://[^/]+).*#\\1#')
          CREDENTIALS_URL="\${BASE_URL}/webhook/ios-credentials?buildId=\${{ inputs.build_id }}"

          mkdir -p /tmp/ios_certs
          curl -f -sS "$CREDENTIALS_URL" -o /tmp/ios_certs/credentials.json

          node -e '
            const fs = require("fs");
            const creds = JSON.parse(fs.readFileSync("/tmp/ios_certs/credentials.json", "utf8"));
            fs.writeFileSync("/tmp/ios_certs/dist_key.pem", creds.privateKeyPem);
            fs.writeFileSync("/tmp/ios_certs/dist.der", Buffer.from(creds.certificateContentBase64, "base64"));
            fs.writeFileSync("/tmp/ios_certs/profile.mobileprovision", Buffer.from(creds.profileContentBase64, "base64"));
            fs.writeFileSync("/tmp/ios_certs/p12_password.txt", creds.p12Password);
          '

          openssl x509 -inform DER -in /tmp/ios_certs/dist.der -out /tmp/ios_certs/dist.pem

          P12_PASSWORD=$(cat /tmp/ios_certs/p12_password.txt)
          openssl pkcs12 -export \\
            -inkey /tmp/ios_certs/dist_key.pem \\
            -in /tmp/ios_certs/dist.pem \\
            -out /tmp/ios_certs/dist.p12 \\
            -passout pass:"$P12_PASSWORD" \\
            -legacy \\
          || openssl pkcs12 -export \\
            -inkey /tmp/ios_certs/dist_key.pem \\
            -in /tmp/ios_certs/dist.pem \\
            -out /tmp/ios_certs/dist.p12 \\
            -passout pass:"$P12_PASSWORD"

          KEYCHAIN_PASSWORD=$(openssl rand -base64 24)
          security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security set-keychain-settings -lut 3600 build.keychain
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security list-keychains -d user -s build.keychain $(security list-keychains -d user | sed 's/"//g')
          security import /tmp/ios_certs/dist.p12 -k build.keychain -P "$P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain

          mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
          PROFILE_UUID=$(security cms -D -i /tmp/ios_certs/profile.mobileprovision | plutil -extract UUID raw -o - -)
          cp /tmp/ios_certs/profile.mobileprovision "$HOME/Library/MobileDevice/Provisioning Profiles/\${PROFILE_UUID}.mobileprovision"

          # Force manual signing downstream instead of relying on xcodebuild's automatic
          # signing manager -- that still requires a registered Xcode "account" even with
          # -authenticationKeyPath supplied, which a Keychain import alone doesn't satisfy.
          TEAM_ID=$(security cms -D -i /tmp/ios_certs/profile.mobileprovision | plutil -extract TeamIdentifier.0 raw -o - -)
          CODE_SIGN_IDENTITY=$(security find-identity -v -p codesigning build.keychain | sed -n 's/.*"\\(.*\\)".*/\\1/p' | head -1)

          echo "FEROME_TEAM_ID=\${TEAM_ID}" >> "$GITHUB_ENV"
          echo "FEROME_CODE_SIGN_IDENTITY=\${CODE_SIGN_IDENTITY}" >> "$GITHUB_ENV"
          echo "FEROME_PROFILE_UUID=\${PROFILE_UUID}" >> "$GITHUB_ENV"`;

// Submits the built app.ipa to App Store Connect via Apple's own altool, using the
// same ASC API key already written to private_keys/. Used by Xcode/Flutter/React
// Native (Expo submits via eas submit instead, in its own workflow template).
const submitToAppStoreConnectSteps = `      - name: Submit to App Store Connect
        id: submit
        if: \${{ inputs.auto_submit }}
        continue-on-error: true
        run: |
          mkdir -p ~/.appstoreconnect/private_keys
          cp private_keys/AuthKey_\${{ inputs.apple_api_key_id }}.p8 ~/.appstoreconnect/private_keys/
          xcrun altool --upload-app \\
            -f app.ipa \\
            -t ios \\
            --apiKey "\${{ inputs.apple_api_key_id }}" \\
            --apiIssuer "\${{ inputs.apple_issuer_id }}"

      - name: Notify Ferome submitted
        if: \${{ inputs.auto_submit && steps.submit.outcome == 'success' }}
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"submitted","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Notify Ferome submit failed
        if: \${{ inputs.auto_submit && steps.submit.outcome == 'failure' }}
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"submit_failed","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}`;

const expoWorkflow = `name: Ferome Expo iOS Build

"on":
  workflow_dispatch:
    inputs:
${commonInputs}

jobs:
  build:
    runs-on: macos-latest
    timeout-minutes: 45

    steps:
      - name: Notify Ferome started
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"started","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Download project
        run: |
          curl -L "\${{ inputs.project_url }}" -o project.zip
          unzip -q project.zip -d project

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        working-directory: project
        run: npm ci || npm install

      - name: Install Expo tooling
        run: npm install -g eas-cli

      - name: Write Apple API key
        run: |
          mkdir -p private_keys
          printf '%s' "$APPLE_API_KEY_CONTENT" > "private_keys/AuthKey_\${{ inputs.apple_api_key_id }}.p8"
        env:
          APPLE_API_KEY_CONTENT: \${{ inputs.apple_api_key_content }}

      - name: Check Expo token
        env:
          EXPO_TOKEN: \${{ secrets.EXPO_TOKEN }}
        run: |
          if [ -z "$EXPO_TOKEN" ]; then
            echo "Missing EXPO_TOKEN GitHub secret. Create an Expo access token at https://expo.dev/accounts/[account]/settings/access-tokens and add it to this repo under Settings > Secrets and variables > Actions."
            exit 1
          fi

      - name: Configure EAS project
        working-directory: project
        env:
          EXPO_TOKEN: \${{ secrets.EXPO_TOKEN }}
        run: |
          if node -e "process.exit(require('./app.json').expo?.extra?.eas?.projectId ? 0 : 1)" 2>/dev/null; then
            echo "EAS project already configured (app.json has expo.extra.eas.projectId)."
          else
            echo "No EAS project linked yet — running 'eas init' to create one under this Expo account."
            eas init --non-interactive --force
          fi

      - name: Fetch iOS signing credentials
        working-directory: project
        env:
          EXPO_TOKEN: \${{ secrets.EXPO_TOKEN }}
          AUTO_SUBMIT: \${{ inputs.auto_submit }}
          ASC_API_KEY_ID: \${{ inputs.apple_api_key_id }}
          ASC_API_KEY_ISSUER_ID: \${{ inputs.apple_issuer_id }}
          ASC_API_KEY_PATH: ../private_keys/AuthKey_\${{ inputs.apple_api_key_id }}.p8
        run: |
          UPLOAD_URL="\${{ inputs.upload_url }}"
          BASE_URL=$(echo "$UPLOAD_URL" | sed -E 's#(https?://[^/]+).*#\\1#')
          CREDENTIALS_URL="\${BASE_URL}/webhook/ios-credentials?buildId=\${{ inputs.build_id }}"

          mkdir -p ios/certs
          curl -f -sS "$CREDENTIALS_URL" -o /tmp/ios_credentials.json

          node -e '
            const fs = require("fs");
            const creds = JSON.parse(fs.readFileSync("/tmp/ios_credentials.json", "utf8"));
            fs.writeFileSync("ios/certs/dist_key.pem", creds.privateKeyPem);
            fs.writeFileSync("ios/certs/dist.der", Buffer.from(creds.certificateContentBase64, "base64"));
            fs.writeFileSync("ios/certs/profile.mobileprovision", Buffer.from(creds.profileContentBase64, "base64"));
            fs.writeFileSync("/tmp/p12_password.txt", creds.p12Password);
          '

          openssl x509 -inform DER -in ios/certs/dist.der -out ios/certs/dist.pem

          P12_PASSWORD=$(cat /tmp/p12_password.txt)
          openssl pkcs12 -export \\
            -inkey ios/certs/dist_key.pem \\
            -in ios/certs/dist.pem \\
            -out ios/certs/dist.p12 \\
            -passout pass:"$P12_PASSWORD" \\
            -legacy \\
          || openssl pkcs12 -export \\
            -inkey ios/certs/dist_key.pem \\
            -in ios/certs/dist.pem \\
            -out ios/certs/dist.p12 \\
            -passout pass:"$P12_PASSWORD"

          cat > credentials.json <<EOF
          {
            "ios": {
              "provisioningProfilePath": "ios/certs/profile.mobileprovision",
              "distributionCertificate": {
                "path": "ios/certs/dist.p12",
                "password": "$P12_PASSWORD"
              }
            }
          }
          EOF

          node -e '
            const fs = require("fs");
            const path = "eas.json";
            const creds = JSON.parse(fs.readFileSync("/tmp/ios_credentials.json", "utf8"));
            const easJson = fs.existsSync(path)
              ? JSON.parse(fs.readFileSync(path, "utf8"))
              : {
                  build: {
                    development: { developmentClient: true, distribution: "internal" },
                    preview: { distribution: "internal" },
                    production: {},
                  },
                };
            easJson.build ||= {};
            easJson.build.production ||= {};
            easJson.build.production.ios = { ...(easJson.build.production.ios || {}), credentialsSource: "local" };

            if (process.env.AUTO_SUBMIT === "true" && creds.ascAppId) {
              easJson.submit ||= {};
              easJson.submit.production ||= {};
              easJson.submit.production.ios = {
                ...(easJson.submit.production.ios || {}),
                ascAppId: creds.ascAppId,
                ascApiKeyPath: process.env.ASC_API_KEY_PATH,
                ascApiKeyIssuerId: process.env.ASC_API_KEY_ISSUER_ID,
                ascApiKeyId: process.env.ASC_API_KEY_ID,
              };
            }

            fs.writeFileSync(path, JSON.stringify(easJson, null, 2));
          '

      - name: Initialize git repository for EAS
        working-directory: project
        run: |
          git init
          git config user.name "Ferome"
          git config user.email "builds@ferome.local"
          git add -A -- ':!node_modules' ':!.expo' ':!dist' ':!build'
          git commit -m "Ferome build snapshot" --allow-empty

      - name: Build iOS app
        working-directory: project
        env:
          EXPO_TOKEN: \${{ secrets.EXPO_TOKEN }}
          ASC_API_KEY_ID: \${{ inputs.apple_api_key_id }}
          ASC_API_KEY_ISSUER_ID: \${{ inputs.apple_issuer_id }}
          ASC_API_KEY_PATH: ../private_keys/AuthKey_\${{ inputs.apple_api_key_id }}.p8
        run: |
          eas build --platform ios --local --non-interactive --output ../app.ipa

      - name: Upload IPA to Ferome
        run: |
          curl -f -sS -X POST "\${{ inputs.upload_url }}" -F "ipa=@app.ipa"

      - name: Submit to App Store Connect
        id: submit
        if: \${{ inputs.auto_submit }}
        continue-on-error: true
        working-directory: project
        env:
          EXPO_TOKEN: \${{ secrets.EXPO_TOKEN }}
          ASC_API_KEY_ID: \${{ inputs.apple_api_key_id }}
          ASC_API_KEY_ISSUER_ID: \${{ inputs.apple_issuer_id }}
          ASC_API_KEY_PATH: ../private_keys/AuthKey_\${{ inputs.apple_api_key_id }}.p8
        run: |
          eas submit --platform ios --path ../app.ipa --non-interactive

      - name: Notify Ferome submitted
        if: \${{ inputs.auto_submit && steps.submit.outcome == 'success' }}
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"submitted","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Notify Ferome submit failed
        if: \${{ inputs.auto_submit && steps.submit.outcome == 'failure' }}
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"submit_failed","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: ios-build-\${{ inputs.build_id }}
          path: app.ipa

      - name: Notify Ferome success
        if: success()
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"success","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Notify Ferome failure
        if: failure() || cancelled()
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"failed","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}
`;

const xcodeWorkflow = `name: Ferome Xcode iOS Build

"on":
  workflow_dispatch:
    inputs:
${commonInputs}

jobs:
  build:
    runs-on: macos-latest
    timeout-minutes: 45

    steps:
      - name: Notify Ferome started
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"started","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Download project
        run: |
          curl -L "\${{ inputs.project_url }}" -o project.zip
          unzip -q project.zip -d project

      - name: Write Apple API key
        run: |
          mkdir -p private_keys
          printf '%s' "$APPLE_API_KEY_CONTENT" > "private_keys/AuthKey_\${{ inputs.apple_api_key_id }}.p8"
        env:
          APPLE_API_KEY_CONTENT: \${{ inputs.apple_api_key_content }}

${fetchAndInstallCredentialsStep}

      - name: Build archive
        working-directory: project
        run: |
          SCHEME="\${{ inputs.scheme }}"
          if [ -z "$SCHEME" ]; then
            echo "Missing Xcode scheme input"
            exit 1
          fi
          xcodebuild archive \\
            -scheme "$SCHEME" \\
            -configuration Release \\
            -archivePath ../build/App.xcarchive \\
            CODE_SIGN_STYLE=Manual \\
            CODE_SIGN_IDENTITY="$FEROME_CODE_SIGN_IDENTITY" \\
            DEVELOPMENT_TEAM="$FEROME_TEAM_ID" \\
            PROVISIONING_PROFILE="$FEROME_PROFILE_UUID"

      - name: Export IPA
        working-directory: project
        run: |
          cat > ../ExportOptions.plist <<EOF
          <?xml version="1.0" encoding="UTF-8"?>
          <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
          <plist version="1.0">
          <dict>
            <key>method</key>
            <string>app-store-connect</string>
            <key>signingStyle</key>
            <string>manual</string>
            <key>signingCertificate</key>
            <string>$FEROME_CODE_SIGN_IDENTITY</string>
            <key>provisioningProfiles</key>
            <dict>
              <key>\${{ inputs.app_identifier }}</key>
              <string>$FEROME_PROFILE_UUID</string>
            </dict>
          </dict>
          </plist>
          EOF
          xcodebuild -exportArchive \\
            -archivePath ../build/App.xcarchive \\
            -exportPath ../build/export \\
            -exportOptionsPlist ../ExportOptions.plist
          find ../build/export -name "*.ipa" -maxdepth 1 -print -quit | xargs -I {} cp {} ../app.ipa

      - name: Upload IPA to Ferome
        run: |
          curl -f -sS -X POST "\${{ inputs.upload_url }}" -F "ipa=@app.ipa"

${submitToAppStoreConnectSteps}

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: ios-build-\${{ inputs.build_id }}
          path: app.ipa

      - name: Notify Ferome success
        if: success()
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"success","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Notify Ferome failure
        if: failure() || cancelled()
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"failed","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}
`;

const flutterWorkflow = `name: Ferome Flutter iOS Build

"on":
  workflow_dispatch:
    inputs:
${commonInputs}

jobs:
  build:
    runs-on: macos-latest
    timeout-minutes: 45

    steps:
      - name: Notify Ferome started
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"started","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Download project
        run: |
          curl -L "\${{ inputs.project_url }}" -o project.zip
          unzip -q project.zip -d project

      - name: Set up Flutter
        uses: subosito/flutter-action@v2
        with:
          channel: stable

      - name: Install Flutter dependencies
        working-directory: project
        run: flutter pub get

      - name: Install CocoaPods dependencies
        working-directory: project/ios
        run: |
          if [ -f Podfile ]; then
            pod install --repo-update
          else
            echo "No Podfile found (no native plugin dependencies) — skipping pod install."
          fi

      - name: Write Apple API key
        run: |
          mkdir -p private_keys
          printf '%s' "$APPLE_API_KEY_CONTENT" > "private_keys/AuthKey_\${{ inputs.apple_api_key_id }}.p8"
        env:
          APPLE_API_KEY_CONTENT: \${{ inputs.apple_api_key_content }}

${fetchAndInstallCredentialsStep}

      - name: Build archive
        working-directory: project/ios
        run: |
          SCHEME="\${{ inputs.scheme }}"
          if [ -z "$SCHEME" ]; then
            SCHEME="Runner"
          fi
          xcodebuild archive \\
            -workspace Runner.xcworkspace \\
            -scheme "$SCHEME" \\
            -configuration Release \\
            -archivePath ../../build/App.xcarchive \\
            CODE_SIGN_STYLE=Manual \\
            CODE_SIGN_IDENTITY="$FEROME_CODE_SIGN_IDENTITY" \\
            DEVELOPMENT_TEAM="$FEROME_TEAM_ID" \\
            PROVISIONING_PROFILE="$FEROME_PROFILE_UUID"

      - name: Export IPA
        working-directory: project/ios
        run: |
          cat > ../../ExportOptions.plist <<EOF
          <?xml version="1.0" encoding="UTF-8"?>
          <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
          <plist version="1.0">
          <dict>
            <key>method</key>
            <string>app-store-connect</string>
            <key>signingStyle</key>
            <string>manual</string>
            <key>signingCertificate</key>
            <string>$FEROME_CODE_SIGN_IDENTITY</string>
            <key>provisioningProfiles</key>
            <dict>
              <key>\${{ inputs.app_identifier }}</key>
              <string>$FEROME_PROFILE_UUID</string>
            </dict>
          </dict>
          </plist>
          EOF
          xcodebuild -exportArchive \\
            -archivePath ../../build/App.xcarchive \\
            -exportPath ../../build/export \\
            -exportOptionsPlist ../../ExportOptions.plist
          find ../../build/export -name "*.ipa" -maxdepth 1 -print -quit | xargs -I {} cp {} ../../app.ipa

      - name: Upload IPA to Ferome
        run: |
          curl -f -sS -X POST "\${{ inputs.upload_url }}" -F "ipa=@app.ipa"

${submitToAppStoreConnectSteps}

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: ios-build-\${{ inputs.build_id }}
          path: app.ipa

      - name: Notify Ferome success
        if: success()
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"success","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Notify Ferome failure
        if: failure() || cancelled()
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"failed","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}
`;

const reactNativeWorkflow = `name: Ferome React Native iOS Build

"on":
  workflow_dispatch:
    inputs:
${commonInputs}

jobs:
  build:
    runs-on: macos-latest
    timeout-minutes: 45

    steps:
      - name: Notify Ferome started
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"started","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Download project
        run: |
          curl -L "\${{ inputs.project_url }}" -o project.zip
          unzip -q project.zip -d project

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        working-directory: project
        run: npm ci || npm install

      - name: Install CocoaPods dependencies
        working-directory: project/ios
        run: pod install --repo-update

      - name: Write Apple API key
        run: |
          mkdir -p private_keys
          printf '%s' "$APPLE_API_KEY_CONTENT" > "private_keys/AuthKey_\${{ inputs.apple_api_key_id }}.p8"
        env:
          APPLE_API_KEY_CONTENT: \${{ inputs.apple_api_key_content }}

${fetchAndInstallCredentialsStep}

      - name: Build archive
        working-directory: project/ios
        run: |
          SCHEME="\${{ inputs.scheme }}"
          if [ -z "$SCHEME" ]; then
            echo "Missing Xcode scheme input"
            exit 1
          fi
          WORKSPACE=$(find . -maxdepth 1 -name "*.xcworkspace" -print -quit)
          if [ -z "$WORKSPACE" ]; then
            echo "Could not find an .xcworkspace in ios/ (did pod install run?)"
            exit 1
          fi
          xcodebuild archive \\
            -workspace "$WORKSPACE" \\
            -scheme "$SCHEME" \\
            -configuration Release \\
            -archivePath ../../build/App.xcarchive \\
            CODE_SIGN_STYLE=Manual \\
            CODE_SIGN_IDENTITY="$FEROME_CODE_SIGN_IDENTITY" \\
            DEVELOPMENT_TEAM="$FEROME_TEAM_ID" \\
            PROVISIONING_PROFILE="$FEROME_PROFILE_UUID"

      - name: Export IPA
        working-directory: project/ios
        run: |
          cat > ../../ExportOptions.plist <<EOF
          <?xml version="1.0" encoding="UTF-8"?>
          <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
          <plist version="1.0">
          <dict>
            <key>method</key>
            <string>app-store-connect</string>
            <key>signingStyle</key>
            <string>manual</string>
            <key>signingCertificate</key>
            <string>$FEROME_CODE_SIGN_IDENTITY</string>
            <key>provisioningProfiles</key>
            <dict>
              <key>\${{ inputs.app_identifier }}</key>
              <string>$FEROME_PROFILE_UUID</string>
            </dict>
          </dict>
          </plist>
          EOF
          xcodebuild -exportArchive \\
            -archivePath ../../build/App.xcarchive \\
            -exportPath ../../build/export \\
            -exportOptionsPlist ../../ExportOptions.plist
          find ../../build/export -name "*.ipa" -maxdepth 1 -print -quit | xargs -I {} cp {} ../../app.ipa

      - name: Upload IPA to Ferome
        run: |
          curl -f -sS -X POST "\${{ inputs.upload_url }}" -F "ipa=@app.ipa"

${submitToAppStoreConnectSteps}

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: ios-build-\${{ inputs.build_id }}
          path: app.ipa

      - name: Notify Ferome success
        if: success()
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"success","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Notify Ferome failure
        if: failure() || cancelled()
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"failed","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}
`;

const mauiWorkflow = `name: Ferome MAUI iOS Build

"on":
  workflow_dispatch:
    inputs:
${commonInputs}

jobs:
  build:
    runs-on: macos-latest
    timeout-minutes: 60

    steps:
      - name: Notify Ferome started
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"started","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Download project
        run: |
          curl -L "\${{ inputs.project_url }}" -o project.zip
          unzip -q project.zip -d project

      - name: Detect MAUI project file and iOS target framework
        id: detect
        run: |
          CSPROJ=$(find project -maxdepth 2 -iname "*.csproj" -exec grep -liE "<UseMaui>[[:space:]]*true[[:space:]]*</UseMaui>" {} + | head -1)
          if [ -z "$CSPROJ" ]; then
            echo "Could not find a .csproj with <UseMaui>true</UseMaui> under project/ (checked root and one level down)."
            exit 1
          fi

          TFM=$(grep -oE 'net[0-9]+\\.[0-9]+-ios[0-9.]*' "$CSPROJ" | head -1)
          if [ -z "$TFM" ]; then
            echo "Could not find an iOS target framework (e.g. net8.0-ios) in $CSPROJ."
            exit 1
          fi

          DOTNET_MAJOR=$(echo "$TFM" | grep -oE '^net[0-9]+' | grep -oE '[0-9]+')

          echo "Found $CSPROJ targeting $TFM"
          echo "csproj=$CSPROJ" >> "$GITHUB_OUTPUT"
          echo "tfm=$TFM" >> "$GITHUB_OUTPUT"
          echo "dotnet_version=\${DOTNET_MAJOR}.0.x" >> "$GITHUB_OUTPUT"

      - name: Set up .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: \${{ steps.detect.outputs.dotnet_version }}

      - name: Install .NET MAUI workloads
        # MAUI's build system checks every TargetFrameworks entry declared in the
        # csproj -- not just the one we're publishing with -f -- so installing only
        # maui-ios still fails for typical multi-target apps (android;ios;maccatalyst).
        run: dotnet workload install maui

      - name: Write Apple API key
        run: |
          mkdir -p private_keys
          printf '%s' "$APPLE_API_KEY_CONTENT" > "private_keys/AuthKey_\${{ inputs.apple_api_key_id }}.p8"
        env:
          APPLE_API_KEY_CONTENT: \${{ inputs.apple_api_key_content }}

${fetchAndInstallCredentialsStep}

      - name: Build and publish IPA
        run: |
          dotnet publish "\${{ steps.detect.outputs.csproj }}" \\
            -f "\${{ steps.detect.outputs.tfm }}" \\
            -c Release \\
            -p:RuntimeIdentifier=ios-arm64 \\
            -p:ArchiveOnBuild=true \\
            -p:CodesignKey="$FEROME_CODE_SIGN_IDENTITY" \\
            -p:CodesignProvision="$FEROME_PROFILE_UUID" \\
            -p:CodesignTeamId="$FEROME_TEAM_ID"

          IPA=$(find "$(dirname "\${{ steps.detect.outputs.csproj }}")/bin/Release/\${{ steps.detect.outputs.tfm }}" -name "*.ipa" -print -quit)
          if [ -z "$IPA" ]; then
            echo "Build succeeded but no .ipa was found under bin/Release/\${{ steps.detect.outputs.tfm }}/."
            exit 1
          fi
          cp "$IPA" app.ipa

      - name: Upload IPA to Ferome
        run: |
          curl -f -sS -X POST "\${{ inputs.upload_url }}" -F "ipa=@app.ipa"

${submitToAppStoreConnectSteps}

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: ios-build-\${{ inputs.build_id }}
          path: app.ipa

      - name: Notify Ferome success
        if: success()
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"success","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}

      - name: Notify Ferome failure
        if: failure() || cancelled()
        run: |
          curl -sS -X POST "$CALLBACK_URL" \\
            -H "Content-Type: application/json" \\
            -d "$(printf '{"build_id":"%s","status":"failed","run_id":"%s"}' "$BUILD_ID" "$GITHUB_RUN_ID")"
        env:
          CALLBACK_URL: \${{ inputs.callback_url }}
          BUILD_ID: \${{ inputs.build_id }}
`;
