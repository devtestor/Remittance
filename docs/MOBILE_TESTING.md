# Mobile Testing From Kali

Use Expo Go on an Android phone for live testing. This avoids local Xcode and Android Studio.

## Start Services

Start Postgres:

```bash
npm run dev:db
```

Start the API:

```bash
npm run dev:api
```

Start Expo:

```bash
npm run start -w @glr/mobile -- --host lan
```

## Phone Setup

Install Expo Go on the Android phone, then scan the Expo QR code or open the LAN URL shown by Expo.

The phone must be on the same Wi-Fi/LAN as this Kali machine.

## API URL

Inside the mobile app, set the API base URL to this machine's LAN IP, not `localhost`.

Example:

```text
http://192.168.1.70:4000
```

`localhost` works for browser testing on Kali, but on a phone it points to the phone itself.
