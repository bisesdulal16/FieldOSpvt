# GSM SMS and payment-reminder IVR readiness

Status: documentation-only readiness review. No SMS was sent, no call was placed, no provider credentials were added, no workers were started, and no live deployment or live PostgreSQL migration was performed.

## Detection date and host

- Host: `proxmox`
- OS: Debian GNU/Linux 12 (bookworm)
- Kernel: `6.8.12-20-pve`
- Hardware: HP Pavilion Gaming Laptop 15-dk0xxx

Sensitive identifiers are intentionally excluded from this document: IMSI, ICCID, SIM phone number, SIM PIN, modem serial numbers, raw SMS content, call content, and credentials.

## Detected hardware

Read-only inspection found the following USB devices:

| Device class | Vendor/product | Detected device |
|---|---|---|
| External storage | `8564:7000` | Transcend StoreJet 25H3 |
| Camera | `0408:5300` | HP Wide Vision HD Camera |
| Bluetooth | `0bda:b00b` | Realtek Bluetooth 4.2 Adapter |
| USB root hub | `1d6b:0002`, `1d6b:0003` | Linux xHCI host controllers |

No GSM modem, QMI modem, MBIM modem, serial modem, SIP-to-GSM gateway, or USB audio modem interface was detected on this host.

## Host software availability

| Component | Status |
|---|---|
| `lsusb` | present |
| `usb-devices` | present |
| ModemManager / `mmcli` | missing |
| QMI tooling / `qmicli` | missing |
| MBIM tooling / `mbimcli` | missing |
| Gammu / `gammu` | missing |
| `gammu-smsd` | missing |
| Asterisk | missing |
| ALSA capture listing / `arecord` | missing |
| PulseAudio/PipeWire client / `pactl` | present |

No ModemManager, Gammu, or Asterisk service was available for modem/gateway inspection.

## Interface inspection

| Interface type | Result |
|---|---|
| `/dev/ttyUSB*` | none detected |
| `/dev/ttyACM*` | none detected |
| `/dev/cdc-wdm*` | none detected |
| `wwan*` network interfaces | none detected |
| ALSA sound cards | host audio exists, but no GSM modem audio path detected |

## SIM and network status

No SIM could be inspected because no GSM modem or gateway was detected.

| Capability | Status |
|---|---|
| SIM presence | unknown / no modem detected |
| SIM lock state | unknown / no modem detected |
| network registration | unknown / no modem detected |
| carrier/operator | unknown / no modem detected |
| signal quality | unknown / no modem detected |
| incoming SMS support | unknown / no modem detected |
| delivery-report support | unknown / no modem detected |
| voice-call support | unknown / no modem detected |
| DTMF support | unknown / no modem detected |
| simultaneous voice/SMS limits | unknown / no modem detected |

## Selected architecture recommendation

Recommended pilot transport: **private SIP-to-GSM gateway with Asterisk**.

Reasoning:

1. No GSM modem is currently attached to this host.
2. SMS capability does not prove voice capability; many USB LTE modems expose data/SMS but not stable voice/audio.
3. A SIP-to-GSM gateway gives cleaner voice-call control, DTMF events, call state, hangup causes, and operational isolation.
4. Asterisk can act as the private call-control boundary and emit structured events to a FieldOS GSM agent without exposing customer data to the modem layer.

Preference order remains:

1. private SIP-to-GSM gateway with Asterisk
2. voice-capable USB GSM modem with stable audio support
3. separate SMS modem and voice gateway
4. Android phone bridge only for temporary lab testing

## Transport options evaluated

| Option | Readiness | Notes |
|---|---|---|
| USB voice-capable GSM modem | not ready | no modem detected; voice/audio/DTMF support unverified |
| SIP-to-GSM gateway | recommended | best pilot path once hardware is purchased/configured |
| SMS-only modem plus separate voice gateway | acceptable fallback | separates SMS from IVR if single hardware cannot do both reliably |
| Android phone bridge | lab-only | useful for temporary experiments, weak durability/observability |

## Recommended FieldOS architecture

```text
FieldOS
→ communication policy
→ approved SMS template or IVR script
→ durable quota reservation
→ provider_call_started
→ private GSM agent
→ modem or GSM gateway
```

Provider classifications:

| Provider | Classification | Status |
|---|---|---|
| `LogSmsProvider` | non-delivery | current safe test/default path |
| `GsmModemSmsProvider` | `real_sms` | future; hardware not ready |
| `GsmVoiceIvrProvider` | `real_voice` | future; hardware not ready |
| `SparrowSmsProvider` | `real_sms` | later; readiness-unverified |

The GSM agent should be a private internal service, not public-facing. It should receive signed or authenticated internal commands only after FieldOS has already passed consent, quiet-hours, template/script approval, quota, suppression, and idempotency gates.

## Agent design

Minimum future components:

1. FieldOS provider interface adapter.
2. Durable provider call/outbox row marked `provider_call_started` before any modem/gateway invocation.
3. Private GSM agent queue/API with strict internal allowlist.
4. Modem/gateway driver:
   - SMS path: Gammu/ModemManager/QMI/MBIM/SMPP-like gateway depending on hardware.
   - Voice path: Asterisk AMI/ARI with SIP-to-GSM gateway preferred.
5. Structured result collector:
   - `answered`
   - `busy`
   - `no_answer`
   - `failed`
   - `provider_uncertain`
   - `dtmf_received`
   - `opted_out`
6. Durable idempotency key at both FieldOS and GSM-agent boundary.
7. Emergency stop checked before each send/call.

## Generic reminder privacy boundary

No on-call identity challenge is required for the generic internal pilot reminder, but the call must not disclose:

- customer name
- loan or account number
- amount due
- balance
- overdue duration
- transaction history
- sensitive financial status

Approved generic message:

> Namaste.
> This is an automated payment reminder from [Institution]. A scheduled payment is due.
>
> Press 1 if you have already paid.
> Press 2 if you expect to pay today.
> Press 3 if you need more time.
> Press 4 to request a callback from your field officer.
> Press 9 to stop automated reminders.

## IVR DTMF workflow

| Key | Structured outcome | Workflow |
|---|---|---|
| `1` | `already_paid` | pause duplicate reminders; create payment-verification task; notify assigned officer |
| `2` | `promise_to_pay_today` | record promise-to-pay; schedule approved follow-up; notify assigned officer |
| `3` | `needs_more_time` | pause immediate repeat calls; create assistance task |
| `4` | `callback_requested` | create callback task; assign officer; set response deadline |
| `9` | `opted_out` | create persistent voice suppression; stop automated voice reminders; do not send SMS fallback unless channel-consent policy explicitly permits it |
| no response | `no_dtmf` | bounded repeat prompt, then end call; optionally allow one approved generic SMS fallback later |

## SMS fallback design

SMS fallback should stay disabled until call-state handling is verified.

Future allowed fallback behavior:

1. One approved generic SMS fallback per recipient per day.
2. Only after automated-call consent and SMS channel-consent policy pass.
3. Never after `9` opt-out unless explicit channel-consent policy permits SMS independently.
4. Do not send fallback after provider uncertainty without manual review.
5. Use immutable approved SMS template version.
6. Record durable quota reservation before provider invocation.

## Safety requirements for implementation

Future implementation must enforce:

- automated-call consent
- voice suppression
- quiet hours
- approved immutable script version
- recipient allowlist
- one call per recipient per day for pilot
- one SMS fallback per recipient per day
- maximum call duration
- emergency stop
- no automatic redial after provider uncertainty
- durable idempotency at GSM agent
- `provider_call_started` before modem/gateway invocation
- `provider_uncertain` after unresolved call initiation
- no call recording
- structured outcomes only

## Pilot limits

Initial pilot limits:

- one branch
- one GSM device or gateway
- one SIM
- one to five internal recipients
- one Nepali script
- one English script
- no customer payment amount disclosure
- no bulk calls
- manual approval before first canary
- manual review after every call
- SMS fallback disabled until call-state handling is verified
- no customer-facing pilot activity until separate approval

## Hardware requirements

Preferred purchase/configuration path:

1. Private SIP-to-GSM gateway with:
   - one SIM slot for pilot
   - SIP registration to local Asterisk
   - DTMF RFC2833/telephone-event support
   - call detail records / hangup cause visibility
   - SMS API or SMS-over-AT support if SMS is expected from same gateway
2. Asterisk host or container in isolated network.
3. Internal FieldOS GSM agent with AMI/ARI credentials stored outside repo.
4. Dedicated test SIM with known carrier coverage at deployment site.
5. Separate USB SMS modem only if gateway SMS support is weak.

USB modem fallback requirements:

- explicit voice-call support, not just SMS/data
- stable Linux audio path or AT voice commands
- DTMF send/receive support verified
- ModemManager/Gammu compatibility verified
- known simultaneous voice/SMS behavior

## Readiness blockers

Current blockers before implementation/canary:

1. No GSM modem or SIP-to-GSM gateway detected.
2. ModemManager, Gammu, QMI/MBIM tooling, and Asterisk are not installed on this host.
3. SIM presence, lock state, registration, carrier, signal, SMS, voice, delivery reports, audio path, and DTMF are unverified.
4. Hardware choice not finalized.
5. No approved Nepali/English audio assets generated or reviewed.
6. No private GSM agent credentials/config exists yet.
7. No pilot allowlist selected.

## Security boundary

- No SIM identifiers, phone numbers, serial numbers, raw messages, call content, or credentials belong in logs, docs, PRs, or chat reports.
- GSM agent must be private and deny all public ingress.
- Provider credentials must live in root-only runtime secret storage, never in git.
- Call/SMS records should store structured outcomes and non-sensitive metadata only.
- No call recording for the pilot.
- Emergency stop must gate every provider invocation.

## Sparrow transition path

Sparrow remains a later `real_sms` provider and is readiness-unverified in this GSM/IVR review.

Transition path:

1. Keep `LogSmsProvider` for non-delivery tests.
2. Add GSM SMS/voice behind readiness gates for internal pilot.
3. Verify consent, suppression, quiet hours, quota, idempotency, and structured outcome handling.
4. Add Sparrow credentials only after separate approval.
5. Run Sparrow through the same policy and quota layers as GSM SMS.
6. Never bypass suppression or emergency stop for provider-specific paths.

## Implementation plan

Proposed next branch:

```text
feat/gsm-sms-ivr-readiness
```

Proposed first implementation commit after hardware is confirmed:

```text
feat(communications): add gated GSM SMS and IVR provider scaffolding
```

Recommended implementation phases:

1. Hardware acquisition/configuration and read-only detection repeat.
2. Private Asterisk/SIP-to-GSM or modem driver proof with non-customer internal recipient only.
3. GSM agent skeleton with no provider invocation by default.
4. FieldOS provider interface adapters behind disabled feature flags.
5. DTMF structured outcome ingestion tests.
6. One internal canary after explicit manual approval.
7. Manual review and expansion only after stable call-state handling.

## Owner decisions required

- Select hardware: SIP-to-GSM gateway preferred.
- Select carrier/SIM for pilot.
- Decide host placement: Proxmox VM/container versus separate appliance.
- Approve Nepali and English scripts/audio assets.
- Approve internal recipient allowlist.
- Approve whether SMS fallback is allowed after no-response calls.
- Approve first canary separately.
