# SmartCare Adhere-ET OCR (Offline-First Android App)

Offline-first React Native (Expo) mobile module engineered by **EASE AFRICA** (`easeafrica.org.et`) to digitize single rows from Ethiopia's paper **National TB Unit Register**, compute baseline Loss to Follow-Up (LTFU) risk scores, purge raw register images immediately after verification, and automatically sync queued records to your PostgreSQL backend whenever internet connectivity becomes available.

## Architecture Highlights
1. **100% On-Device OCR (`rn-mlkit-ocr` with bundled Latin model):** Works in TB clinics with zero internet connectivity.
2. **Zero Raw Image Persistence:** Immediately deletes the temporary camera image (`FileSystem.deleteAsync`) the moment the TB focal person taps **Verify, Purge Photo & Queue Sync**.
3. **Durable Offline Outbox (`expo-sqlite` + `@react-native-community/netinfo`):** Stores verified JSON records in a local SQLite WAL queue with unique `idempotency_key` protection and automatically flushes them to `POST /api/v1/sync/enrollments` as soon as mobile data or Wi-Fi reconnects.

## Quick Setup with GitHub (`hailegiorgisy/smartcare-adhere-et-ocr`)

```bash
git init
git add .
git commit -m "feat: initial offline-first TB register OCR and SQLite auto-sync module"
git branch -M main
git remote add origin https://github.com/hailegiorgisy/smartcare-adhere-et-ocr.git
git push -u origin main
```

## Building the Installable Android APK (Expo EAS)
```bash
npm install
npx eas-cli login
npx eas-cli build -p android --profile preview
```

## Linking to Your Database Backend (`POST /api/v1/sync/enrollments`)
Set `EXPO_PUBLIC_API_URL` (e.g., `https://api.easeafrica.org.et` or your AAHB server IP) in `.env`. Each queued enrollment sends:
- Header: `X-Idempotency-Key: <hcCode>:<tbRegisterNo>:<YYYY-MM-DD>`
- Body: JSON payload matching the `patients` table (`tbRegisterNo`, `age`, `sex`, `ketena`, `tbType`, `hivStatus`, `patientPhone`, `supporterPhone`, `ltfuRiskScore`, `riskTier`, `meanOcrConfidence`, `ocrEditedByUser`).
