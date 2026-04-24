# Sheets Sync — Setup & Operations

## What it does

`GET /api/campaigns/sheets-sync?campaign=<campaign-id>` polls a Google Sheet for
undialed leads, writes a **Dialing…** sentinel to prevent double-dispatch, and
fires a LiveKit agent call for each row. After the call the webhook writes the
final disposition back to the same row (columns D–H). Column A–C are never
modified.

---

## Env vars required

| Variable | Description |
|---|---|
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` | Full service-account key JSON, single-line |
| `GOOGLE_SHEETS_DEFAULT_SHEET_ID` | Fallback sheet ID if not set per-campaign |
| `SHEETS_SYNC_CRON_SECRET` | Bearer token the cron job must send |
| `DASHBOARD_URL` | Base URL of the dashboard (e.g. `https://cxll.yourco.com`) |

The Google Sheet must be shared with the service account's **client_email** as Editor.

---

## Authentication

Send the secret in **either** header:

```
x-sync-secret: <SHEETS_SYNC_CRON_SECRET>
# or
Authorization: Bearer <SHEETS_SYNC_CRON_SECRET>
```

If `SHEETS_SYNC_CRON_SECRET` is not set the endpoint accepts all requests
(useful during local development).

---

## EKS CronJob (recommended)

```yaml
# k8s/sheets-sync-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sheets-sync-primary-verification
  namespace: voice-agent
spec:
  schedule: "*/5 3-15 * * *"   # every 5 min, 09:05–21:00 IST (03:35–15:30 UTC)
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: sync
              image: curlimages/curl:latest
              command:
                - curl
                - -sf
                - -H
                - "x-sync-secret: $(SHEETS_SYNC_CRON_SECRET)"
                - "$(DASHBOARD_URL)/api/campaigns/sheets-sync?campaign=primary-number-verification"
              env:
                - name: SHEETS_SYNC_CRON_SECRET
                  valueFrom:
                    secretKeyRef:
                      name: voice-agent-secrets
                      key: SHEETS_SYNC_CRON_SECRET
                - name: DASHBOARD_URL
                  valueFrom:
                    configMapKeyRef:
                      name: voice-agent-config
                      key: DASHBOARD_URL
```

---

## Vercel Cron (if deployed on Vercel)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/campaigns/sheets-sync?campaign=primary-number-verification",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when you
set `SHEETS_SYNC_CRON_SECRET` as a project env var.

**Note:** Vercel Cron fires on UTC schedule. The endpoint enforces the IST DND
window (21:00–09:00) internally, so the cron can run every 5 minutes around the
clock without sending calls during quiet hours.

---

## Sheet column schema

| Col | Field | R/W | Notes |
|---|---|---|---|
| A | URN | **Read** | Idempotency key — unique per borrower |
| B | User Name | **Read** | Full name as per Kissht records |
| C | Secondary Mobile | **Read** | 10-digit or E.164 |
| D | Disposition | **Write** | Dialing… → Verified / Not Verified / Callback Requested / Missed Call |
| E | Attempt Count | **Write** | Integer 1–4 |
| F | Last Call Timestamp (IST) | **Write** | ISO 8601 with +05:30 |
| G | LiveKit Call SID (room name) | **Write** | For recording lookup |
| H | Notes | **Write** | Callback time, denial reason, etc. |

---

## Retry ladder

Retries fire automatically via BullMQ delayed jobs when `disposition = Missed Call`.

| Attempt | Trigger | Delay |
|---|---|---|
| 1 | Initial sheet poll | — |
| 2 | Missed Call from attempt 1 | +2 h |
| 3 | Missed Call from attempt 2 | +6 h |
| 4 | Missed Call from attempt 3 | +16 h |
| — | Missed Call from attempt 4 | Final — no further retry |

All retries respect the DND window (21:00–09:00 IST). A scheduled retry that
falls inside DND is automatically pushed to 09:05 IST the next morning.
