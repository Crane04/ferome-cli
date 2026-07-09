# ferome

iOS builds for Windows developers. No Mac required.

## Local API server

The CLI defaults to the production API. For local development, either set the
server URL once:

```sh
ferome server set http://localhost:3000
```

Or override it per command:

```sh
FEROME_SERVER_URL=http://localhost:3000 ferome projects
```

Check the active server with:

```sh
ferome server show
```

## Apple API keys

Save an App Store Connect API key before running builds:

```sh
ferome keys add \
  --key-id YOUR_KEY_ID \
  --issuer-id YOUR_ISSUER_ID \
  --file ~/Downloads/AuthKey_YOUR_KEY_ID.p8
```

List, rename, or remove saved keys:

```sh
ferome keys list
ferome keys rename <keyId> "Production team"
ferome keys remove <keyId>
```

## GitHub Actions workflow

Set up an Expo, Flutter, React Native, or Xcode project for Ferome builds:

```sh
ferome init
```

This creates one of:

```txt
.github/workflows/expo-ios-build.yml
.github/workflows/flutter-ios-build.yml
.github/workflows/react-native-ios-build.yml
.github/workflows/xcode-ios-build.yml
```

Commit and push the workflow file before running:

```sh
ferome build
```

Ferome uploads the generated `app.ipa` back to the dashboard for download.
To submit after a successful Expo build, run:

```sh
ferome build --auto-submit
```

Expo projects also need an Expo access token saved in the GitHub repo as an
Actions secret:

```txt
EXPO_TOKEN
```

Show the setup command anytime with:

```sh
ferome expo token
```

Ferome remembers project settings in `.ferome/config.json` after the first
build. Reset them with:

```sh
ferome reset
```
