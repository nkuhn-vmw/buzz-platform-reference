# Native desktop identity integration

This reference patch adds native NIP-FA sign-in and short lived NIP-FI assertions to the pinned Buzz desktop source. Identity assertions are requested for the configured relay origin and are sent only to that exact origin. Relay, media, and voice requests keep their existing relay authorization and add the federation assertion only for the configured relay. Identity sessions stay in the operating system credential store; keychain item names include the configured desktop profile so separate installations do not read or clear one another's sessions. Keychain I/O remains bounded.

## Build an isolated macOS app

1. Create the operator deployment config using `docs/deployment.md` and validate it with `node scripts/preflight.mjs`.
2. Run `scripts/build-desktop.sh`. It checks out the pinned upstream commit in a temporary directory, verifies the patch applies cleanly, injects the validated identity and relay origins, and overrides the app name and bundle identifier from the deployment config.
3. The app, which is not developer signed or notarized, and `BUILD-INFO.txt` are written under `artifacts/desktop/<profile>/`. The linker may leave ad-hoc signatures, but the build does not apply a developer signature or notarize the app. Sign and notarize it through your organization's normal macOS release process before distributing it.

The builder requires macOS, Git, Node.js, pnpm, Rust, Xcode command line tools, and network access for the upstream source and JavaScript dependencies. It builds the upstream desktop sidecars from the same pinned checkout before packaging. Set `BUZZ_UPSTREAM_SOURCE` to a clean checkout at the pinned revision to use a local source mirror. Set `BUZZ_CARGO_TARGET_DIR` to a Rust cache directory if desired. The script refuses an existing output path and leaves source checkouts unchanged.

The compiled Rust client has safe `example.invalid` origin defaults for development. The packaging script requires real validated HTTPS identity and relay origins and the matching WSS relay URL, so a production app cannot be built with those defaults.

## First launch

Launch the app and open **Settings → Profile → Platform sign-in**. Complete the configured SSO flow using the account already enrolled for the desktop identity. The app binds that identity to the active Buzz key; a different SSO account will be refused by the identity service. After sign-in, connect to the configured relay. The desktop stores the session in the OS credential store under the deployment profile. Signing out revokes the grant and removes only that profile's stored session.

A macOS keychain approval prompt can appear the first time the app reads or writes the session. Allow access for this app. If the keychain is locked or its response takes longer than the bounded wait, unlock it and retry sign-in.
