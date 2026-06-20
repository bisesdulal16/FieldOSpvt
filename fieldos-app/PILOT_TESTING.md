# FieldOS Nepal — Mobile Pilot Testing Notes

## Physical Phone Testing

### API Configuration

The app's API URL is set in `.env`:

```
EXPO_PUBLIC_API_URL=http://192.168.1.107:8000/api/v1
```

**Critical:** The IP address `192.168.1.107` must be updated to match your laptop's current LAN IP before testing on a physical phone.

### Finding Your Laptop's LAN IP

**Windows:**
```bash
ipconfig
```
Look for "IPv4 Address" under your active network adapter.

**macOS/Linux:**
```bash
ifconfig
# or
ip addr show
```
Look for the address on `wlan0` or `en0`.

### Why Not localhost?

- `localhost` (127.0.0.1) refers to the PHONE's own loopback interface, NOT your laptop.
- Your phone and laptop are separate devices on the same network.
- The Expo dev server runs on your laptop — the phone must reach it via the laptop's LAN IP.

### Before Each Testing Session

1. Run `ipconfig` on your laptop to confirm current LAN IP.
2. Update `EXPO_PUBLIC_API_URL` in `fieldos-app/.env` with that IP.
3. Restart the Expo dev server: `npx expo start`
4. Ensure phone and laptop are on the **same WiFi network**.
5. If tunneling is needed (different networks): `npx expo start --tunnel`

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "Network request failed" on all API calls | Wrong IP in .env | Update to current laptop LAN IP |
| Works on Expo Go but not EAS build | Hardcoded URL in production build | Set `EXPO_PUBLIC_API_URL` in eas.json or environment |
| "Tunnel failed" | Firewall blocking port | Allow Node.js through Windows Defender firewall |
| GPS shows wrong location | Phone GPS vs laptop GPS | Physical phone uses its own GPS — this is correct |
