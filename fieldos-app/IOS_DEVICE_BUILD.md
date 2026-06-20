# Building FieldOS for a physical iPhone (free Apple ID, on a Mac)

This builds a **development client** with the on-device Gemma (MediaPipe)
module and sideloads it to your iPhone using a **free Apple ID** — no paid
Apple Developer account needed. The app is valid for **7 days**, then re-run
the build.

> iPhone 17 Pro easily clears the on-device RAM gate, so you'll see Gemma run
> locally (status → ready), unlike the Android emulator.

## On the Mac — one-time prerequisites
1. **Xcode** (from the App Store) + open it once to install components.
2. **Node 20+** and **git**.
3. Add your **free Apple ID** in Xcode → Settings → Accounts → "+".
4. On the **iPhone** (iOS 16+): Settings → Privacy & Security → **Developer Mode → On** (reboots).
5. Connect the iPhone to the Mac by USB and tap **Trust**.

## Get the code
```bash
git clone https://github.com/bisesdulal16/FieldOSpvt.git
cd FieldOSpvt
git checkout fix/sync-fields-nav-dashboard-round2
cd fieldos-app
npm install
```

## Point the app at your backend
Create `fieldos-app/.env` (on-device Gemma is primary; the backend is the
fallback tier and for tasks/collections sync):
```bash
# Use the LAN IP of the machine running the FastAPI backend, reachable from the iPhone.
EXPO_PUBLIC_API_URL=http://<BACKEND_LAN_IP>:8000/api/v1
EXPO_PUBLIC_ENABLE_MOCK_SYNC=false
```
(iPhone, Mac, and the backend machine should be on the same Wi-Fi.)

## Build + install to the iPhone
```bash
npx expo run:ios --device
```
This runs prebuild → `pod install` (downloads the MediaPipe GenAI pods — a few
minutes the first time) → builds → installs to the selected iPhone.

**First time, set free signing in Xcode:**
1. It generates `ios/FieldOSNepal.xcworkspace` — open it in Xcode.
2. Select the app target → **Signing & Capabilities** → **Team = your personal Apple ID**, keep **Automatically manage signing** on.
3. If it says the bundle id is unavailable, change `bundleIdentifier` in `app.json` to something unique (e.g. `np.fieldos.app.<yourname>`), then re-run.
4. Pick the iPhone as the run destination and press **Run** (or re-run `npx expo run:ios --device`).

**On the iPhone:** Settings → General → **VPN & Device Management** → trust your Apple ID developer certificate.

## Run it
```bash
npx expo start --dev-client
```
Open **FieldOS** on the iPhone (same Wi-Fi as the Mac). Log in `FO-208 / 1234`.

## See Gemma run on-device
Watch the Metro terminal:
```
[OnDeviceLLM] device RAM=8.0GB, gate=3.4GB, isDevice=true
[OnDeviceLLM] status → downloading   ← one-time ~1.3GB model download (Wi-Fi)
[OnDeviceLLM] status → ready
```
Then test **Voice Notes → AI cleanup**, **Voice Notes → AI summary**, and
**Dashboard → AI Assistant** — these now run **on the phone, offline**. With
the model loaded you can even turn off Wi-Fi and the AI still answers.

## Free Apple ID limits (expected)
- App expires after **7 days** → re-run `npx expo run:ios --device` to refresh.
- A few app installs / device registrations per 7 days.
- Re-trust the cert if prompted.

## If `pod install` fails on deployment target
We pin iOS to 16.0 via `expo-build-properties` in `app.json`. If a MediaPipe
pod needs higher, bump `ios.deploymentTarget` there and re-run.
