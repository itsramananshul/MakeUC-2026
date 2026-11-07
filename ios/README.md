# AFTERMAP for iPhone

Native SwiftUI participant app for the controlled MakeUC field drill. It implements the complete participant loop:

`join → checkpoint → confirm position → capture evidence → interpret → human-confirm → shared map → candidate route`

The app deliberately labels every scenario as a simulated drill and every route as a candidate. It is not an emergency or life-safety system.

## Requirements

- macOS with Xcode 16 or newer
- iOS 17 or newer for physical iPhones
- Optional: [XcodeGen](https://github.com/yonaskolb/XcodeGen) to regenerate the checked-in project
- The web server running the `/api/sessions/{code}` contract on the Mac

There are no third-party runtime dependencies and no signing credentials in Git.

## Open and run

1. Open `ios/Aftermap.xcodeproj` in Xcode.
2. Select the **Aftermap** target, then **Signing & Capabilities**.
3. Choose your Apple Development team. If Xcode reports a bundle-ID conflict, change `com.makeuc.aftermap` to a unique reverse-domain value locally. Do not commit personal team IDs or profiles.
4. Select an iPhone simulator and press Run.
5. Enter a display name, `WESTHALL`, and `http://localhost:3000` if the web server runs on the same Mac.
6. The simulator has no usable camera. Use manual checkpoint ID entry and the photo-library/text fallback.

Regenerate after editing `project.yml`:

```sh
cd ios
xcodegen generate
```

## Connect three physical iPhones

1. Put the Mac and all three iPhones on the same private Wi-Fi network. Avoid guest Wi-Fi/client isolation.
2. Make the web server listen on `0.0.0.0`, not only `localhost`, and allow the macOS firewall prompt.
3. Find the Mac's LAN address in **System Settings → Wi-Fi → Details → TCP/IP**, for example `192.168.1.42`.
4. Connect each iPhone to the Mac once by cable, unlock it, tap **Trust**, and enable **Developer Mode** if iOS requests it.
5. In Xcode, choose each phone from the run-destination menu and press Run. Automatic signing creates a development install for the selected team.
6. On every phone, enter the same URL, such as `http://192.168.1.42:3000`, and join `WESTHALL` with a different display name.
7. Accept Local Network, Camera, Microphone, and Speech Recognition permissions as each feature is exercised.
8. Keep the Mac awake and the app foregrounded during the drill. A green **LIVE • 1s SYNC** badge indicates recent snapshots; amber **STALE** means the last map is being retained while reconnecting.

If Xcode reports **No Account for Team** or **No profiles were found**, open **Xcode → Settings → Accounts**, sign in with the Apple ID that owns the development certificate, then return to **Aftermap → Signing & Capabilities** and select that team. Let Xcode manage signing. Team IDs, provisioning profiles, certificates, and account credentials must remain local and must not be committed. If a phone runs a newer iOS version than the installed Xcode supports, update Xcode before retrying the install.

QR labels may contain either a plain checkpoint ID or:

```text
aftermap:WESTHALL:<checkpointId>
```

The app validates scanned IDs against the authoritative snapshot before updating position.

## Device drill checklist

Use three distinct names (for example Observer A/B/C), then verify:

1. All devices show the server-provided session name, node labels, and version.
2. A scans checkpoint 1 and confirms an open passage.
3. B scans checkpoint 2, dictates a blocked/hazard report, reviews the editable transcript and AI proposal, then explicitly confirms it.
4. C scans an assembly/exit point and confirms it, or submits a help request.
5. Every device shows the new edge state and candidate route within roughly one poll interval.
6. Retry the same submission during a network interruption: the stable observation UUID lets the server deduplicate it.
7. Disconnect one phone, verify **STALE**, reconnect it, and confirm it converges to the latest version.
8. Submit conflicting evidence and confirm the server's `conflict` state is rendered amber.
9. Make AI unavailable or return no suggestion; verify the app clearly falls back to a manually confirmed structured report.

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
- Additional snapshot fields are ignored safely. Drone imagery is intentionally left to the command station until an aligned field-image contract is ready.

## Privacy and safety

Evidence is sent only after the participant requests interpretation or confirms a report. Avoid faces, license plates, and unrelated private information in drill photos. The prototype does not perform indoor GPS localization and does not claim a route is physically safe.
