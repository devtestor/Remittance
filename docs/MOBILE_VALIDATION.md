# Velo Mobile Validation

## Start

Use the API address that matches the target device:

```shell
# Web or iOS simulator
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000 npm run web -w @glr/mobile

# Android emulator
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4000 npm run start -w @glr/mobile

# Physical Android device on the same LAN
EXPO_PUBLIC_API_BASE_URL=http://YOUR_LAN_IP:4000 npm run start -w @glr/mobile
```

The API must be reachable from the device. For a physical phone, bind or tunnel the API through an address reachable on the local network and allow the API port through the firewall.

## Smoke flow

- Launch the Velo onboarding screen.
- Request and verify the development OTP.
- Confirm the wallet dashboard loads after session restore.
- Submit manual KYC and confirm the status card updates.
- Add a Rwanda mobile-money beneficiary.
- Request a quote and verify fee, exchange rate, and destination amount.
- Confirm the transfer and verify the status timeline.
- Open history and verify the transfer remains visible after refresh.
- Sign out, relaunch, and confirm the session is cleared.

## Hosted KYC

Smile sandbox testing requires the public callback, policy URL, logo URL, and partner ID variables from `docs/PROJECT_START.md`. Keep `EXPO_PUBLIC_SMILE_ENVIRONMENT=sandbox` until provider approval is complete.
