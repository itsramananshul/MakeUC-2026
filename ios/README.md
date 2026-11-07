# AFTERMAP for iPhone

Native SwiftUI participant app for the controlled MakeUC field drill. It implements the complete participant loop:

`join → checkpoint → confirm position → capture evidence → interpret → human-confirm → shared map → candidate route`

The app deliberately labels every scenario as a simulated drill and every route as a candidate. It is not an emergency or life-safety system.

## Requirements

- macOS with Xcode 16 or newer
- iOS 17 or newer for physical iPhones
- Optional: [XcodeGen](https://github.com/yonaskolb/XcodeGen) to regenerate the checked-in project
- The [live AFTERMAP server](https://aftermap-makeuc.vercel.app), or a local server running the `/api/sessions/{code}` contract

There are no third-party runtime dependencies and no signing credentials in Git.

## Open and run

1. Open `ios/Aftermap.xcodeproj` in Xcode.
2. Select the **Aftermap** target, then **Signing & Capabilities**.
3. Choose your Apple Development team. If Xcode reports a bundle-ID conflict, change `com.makeuc.aftermap` to a unique reverse-domain value locally. Do not commit personal team IDs or profiles.
4. Select an iPhone simulator and press Run.
5. Enter a display name and code `WESTHALL`. Set Server URL to `https://aftermap-makeuc.vercel.app` for the live drill or `http://localhost:3000` for a server running on the same Mac.
6. The simulator has no usable camera. Use manual checkpoint ID entry and the photo-library/text fallback.

Regenerate after editing `project.yml`:

```sh
cd ios
xcodegen generate
```

## Connect three physical iPhones

1. Open the project in Xcode and select the development team as above.
2. Connect each iPhone by cable. Unlock it, tap **Trust**, and enable **Developer Mode** if iOS requests it.
3. Choose each phone in the Xcode run-destination menu and press Run. Automatic signing creates a development install for the selected team.
4. On all three phones, set Server URL to `https://aftermap-makeuc.vercel.app`. Use code `WESTHALL` and a different display name on each phone.
5. Open [the same Vercel site](https://aftermap-makeuc.vercel.app) on the laptop. The phones and laptop can use different networks with internet access.
6. Accept Camera, Microphone, and Speech Recognition permissions as you use those features. Keep the app foregrounded. **LIVE** means the phone has a recent snapshot, and **STALE** means it is showing the last snapshot while reconnecting.

The live site forwards reports to the shared Node server. Keep that server and its tunnel online. To run the whole rehearsal on a private Wi-Fi network instead, start the web server on the Mac, use the Mac's LAN address on the phones, and grant Local Network access.

If Xcode reports **No Account for Team** or **No profiles were found**, open **Xcode → Settings → Accounts**, sign in with the Apple ID that owns the development certificate, then return to **Aftermap → Signing & Capabilities** and select that team. Let Xcode manage signing. Team IDs, provisioning profiles, certificates, and account credentials must remain local and must not be committed. If a phone runs a newer iOS version than the installed Xcode supports, update Xcode before retrying the install.

QR labels may contain either a plain checkpoint ID or:

```text
aftermap:WESTHALL:<checkpointId>
```

The app validates scanned IDs against the authoritative snapshot before updating position.

## Device drill checklist

Use three distinct names (for example Observer A/B/C), then verify:

1. Confirm all three phones and the laptop show **Mexico Beach**.
2. Phone A scans `ATRIUM` (Coastal junction) and confirms that the passage to `CENTRAL` (Harbor junction) is **Open**.
3. Phone B scans `EXIT` (East assembly) and confirms it as an **Assembly point**. Check that the first candidate route appears on the laptop and all phones.
4. Phone C scans `EAST-S` (Service junction) and confirms a new **Open** passage to `EAST` (East crossing). Check that the missing link appears.
5. Phone A reports the `ATRIUM` to `CENTRAL` passage as **Blocked**. Check that the old route becomes dashed and the new route uses the link Phone C reported. Select the closure on the laptop to see who reported it and when.
6. During rehearsal, disconnect one phone and check for **STALE**. Reconnect it and confirm it returns to the latest map. Retry a report after a lost response to check that it appears only once.

Do not fabricate timing results. Record actual observation-to-map and route-revision times during the tabletop run.

## Build and tests

```sh
cd ios
xcodegen generate
xcodebuild -project Aftermap.xcodeproj -scheme Aftermap \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  CODE_SIGNING_ALLOWED=NO test
```

For a signing-independent physical-device compile check:

```sh
xcodebuild -project Aftermap.xcodeproj -scheme Aftermap \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

## API behavior

- Session codes are uppercased client-side; the server contract remains case-insensitive.
- The returned observer ID is persisted per device.
- Foreground clients poll the authoritative snapshot about once per second and retain the last snapshot when stale.
- Backend `{ "error": "..." }` messages are shown to the participant.
- Image evidence is resized and JPEG-compressed below 1 MB before base64 encoding.
- `/interpret` suggestions never commit automatically. `/observations` always sends `confirmed: true` after an explicit human action.
- Each report draft receives one client-generated UUID that is reused until the submission succeeds.
- Optional snapshot imagery URLs may be absolute or relative to the configured server. An aligned image is drawn beneath the graph in the shared 1000×720 frame; absent, unreachable, or unaligned imagery falls back to the historical Mexico Beach aerial without hiding the graph.

## Privacy and safety

Evidence is sent only after the participant requests interpretation or confirms a report. Avoid faces, license plates, and unrelated private information in drill photos. The prototype does not perform indoor GPS localization and does not claim a route is physically safe.
