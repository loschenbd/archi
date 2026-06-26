// Resolve Apple notarization credentials for both notarization hooks
// (afterSign → .app, afterAllArtifactBuild → .dmg).
//
// Precedence:
//   1. Explicit env vars APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//      — used by CI (GitHub Actions secrets; see desktop-release.yml).
//   2. A local `notarytool` keychain profile (created once via
//      `xcrun notarytool store-credentials <profile> --apple-id ... --team-id ...`).
//      Default profile name: "archi-notarize" (override with NOTARY_KEYCHAIN_PROFILE).
//      This keeps the app-specific password out of the environment / shell
//      history for laptop releases.
//
// electron-builder 24.x cannot pass a keychain profile to its built-in
// mac.notarize, which is why we notarize the .app ourselves in afterSign via
// @electron/notarize (which DOES support keychainProfile).
module.exports = function notaryCredentials() {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    return {
      kind: "apple-id",
      appleId: APPLE_ID,
      appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
      teamId: APPLE_TEAM_ID,
    };
  }
  return {
    kind: "keychain-profile",
    keychainProfile: process.env.NOTARY_KEYCHAIN_PROFILE || "archi-notarize",
  };
};
