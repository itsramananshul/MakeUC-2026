# AFTERMAP for iPhone

Native SwiftUI and MapLibre client for the worldwide AFTERMAP incident map. The app opens directly to an interactive world map—there is no session code or drill join step.

## Product flow

- Search for a place through the shared backend and move the map to the result.
- Browse active incident bounds and coordinate-aligned aerial surveys while retaining the vector basemap around them.
- Inspect incident roads by evidence state: unknown, open, blocked, hazard, or conflict.
- Submit confirmed, road-specific field evidence with a display name and operator-provided report key.
- Choose start and destination points directly on the map and request an evidence-aware walking route.
- Show `partial` and `unavailable` results explicitly. The client never substitutes an unchecked route through a known incident.
- Continue to operate when there are zero incidents. If the server is unavailable, the app labels cached data as stale instead of presenting an unverified empty state.

AFTERMAP is decision support. A complete route reflects the current shared evidence model; it is not a guarantee of real-world safety.

## Requirements

- macOS with Xcode 16.4 or newer
- XcodeGen (`brew install xcodegen`)
- iOS 17 or newer
- Network access for the MapLibre demo vector style and the configured AFTERMAP server

MapLibre Native is pinned to `7.0.0` through Swift Package Manager. `Package.resolved` records the exact revision.

## Generate, build, and test

```bash
cd ios
xcodegen generate
xcodebuild -resolvePackageDependencies -project Aftermap.xcodeproj -scheme Aftermap
xcodebuild -project Aftermap.xcodeproj -scheme Aftermap \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  CODE_SIGNING_ALLOWED=NO test
```

To verify the device architecture without signing:

```bash
xcodebuild -project Aftermap.xcodeproj -scheme Aftermap \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

## Server configuration

The default server is `https://aftermap-makeuc.vercel.app`. Open **Settings** in the search bar to change it. The app expects:

- `GET /api/incidents`
- `GET /api/incidents/{id}`
- `GET /api/places?q={query}`
- `POST /api/routes`
- `POST /api/incidents/{id}/route`
- `POST /api/incidents/{id}/reports` with `Authorization: Bearer {report-key}`

Route requests contain `origin` and `destination` latitude/longitude objects. Route responses contain `status` (`complete`, `partial`, or `unavailable`), coordinates, distance, and a human-readable reason.

Incident imagery supplies a URL and geographic west/south/east/north bounds. The iOS client renders it with `MLNImageSource`, so the raster stays aligned with map coordinates at every zoom level.

The report key is kept in memory only. The display name and server URL are stored in app preferences.

## Physical iPhone setup

1. Open `Aftermap.xcodeproj` in Xcode.
2. Open **Xcode → Settings → Accounts** and sign in with the Apple ID that owns the development team.
3. Select the `Aftermap` target, open **Signing & Capabilities**, enable automatic signing, and select that team.
4. Connect and unlock the iPhone, trust the Mac, enable Developer Mode if requested, then select the phone as the run destination.
5. Build and run. Repeat for each test device.

If Xcode reports **No Account for Team** or **No profiles for `com.makeuc.aftermap`**, signing is not configured on that Mac even if a development certificate exists in Keychain. Sign in to the matching team and let Xcode create the provisioning profile.

## Verification checklist

1. Confirm the app opens directly to the world map and supports pan, pinch, rotate, and place search.
2. Verify zero incidents displays as a valid live state, while an unreachable server displays a stale warning.
3. Select an incident and confirm its aerial survey remains geographically aligned while zooming.
4. Tap a road, submit a confirmed report, and verify the refreshed road state and report count.
5. Choose endpoints outside an incident and request a normal route.
6. Choose a route that intersects an incident and verify the incident-aware endpoint is used.
7. Confirm partial and unavailable routes remain visibly labeled and are never replaced with a silent fallback.
