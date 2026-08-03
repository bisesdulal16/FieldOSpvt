# Sparrow Evidence Tracker

Status: evidence collection only. No Sparrow enablement, credentials, SMS sends, communication workers, runtime configuration changes, n8n, Redis replay, reminders, or Phase 9 work are authorized by this document.

Purpose: track authoritative Sparrow evidence required before FieldOS can implement or enable real Sparrow SMS.

## Evidence rules

- Current status is `UNKNOWN` until official Sparrow documentation, written support/account confirmation, dashboard evidence, or tested sandbox evidence is attached.
- Do not mark a capability `VERIFIED` because FieldOS has a placeholder implementation, request field, request header, parser candidate, or internal design note.
- Do not store credentials, real phone numbers, account identifiers, private URLs, or secrets in this tracker.

## Concise Sparrow support request draft

```text
Subject: Sparrow SMS API evidence needed for controlled FieldOS integration

Hello Sparrow Support,

We are preparing a controlled FieldOS SMS integration and need official documentation or written confirmation before enabling any real SMS. Please provide authoritative answers for the items below.

1. Production API endpoint and request schema
   - Production SMS submission URL/path.
   - Required/optional request fields, content type, and an example request.
   - Supported Nepal phone-number formats.

2. Authentication and token lifecycle
   - Required authentication method.
   - Token generation, rotation, revocation, expiration, scope, and audit/logging options.
   - Whether source IP allowlisting is required or available.

3. Sender ID
   - Sender ID approval process, timeline, required documents, and exact request field name.
   - Whether sender ID behavior differs by carrier or account plan.

4. Provider message ID and responses
   - Synchronous success and failure response schemas.
   - Authoritative provider message ID field.
   - Whether synchronous success means accepted for processing only or delivery confirmation.
   - Retryable vs permanent error codes/statuses.

5. Client reference, idempotency, and duplicate requests
   - Whether Sparrow supports a client reference, external ID, metadata field, or idempotency key/header.
   - Duplicate behavior for same key/reference with the same payload.
   - Duplicate behavior for same key/reference with a different payload.

6. Delivery callbacks
   - Callback registration process.
   - Callback payload schema and complete status vocabulary.
   - Callback authentication/signature method, timestamp/replay protection, and source IP options.
   - Retry policy when our callback endpoint is unavailable or returns non-2xx.
   - Event ordering guarantees and duplicate callback behavior.

7. Delivery-status lookup and reconciliation
   - Lookup API by provider message ID.
   - Lookup API by client reference/idempotency key, if supported.
   - Reporting/export APIs for sent messages and final delivery statuses.
   - Balance and transaction history APIs.

8. Rate limits and retry guidance
   - Account/API rate limits.
   - Rate-limit response schema, HTTP status, and retry-after guidance.
   - Recommended client timeout and retry behavior.

9. Pricing, Unicode/multipart billing, balance, and account limits
   - GSM and Unicode/Nepali SMS pricing.
   - Multipart/long-message behavior and billing.
   - Balance exhaustion behavior.
   - Testing credits, sandbox/test mode, daily/monthly limits, and production approval requirements.

Please attach official API documentation or dashboard screenshots where applicable, and identify any account-plan-specific differences.

Thank you.
```

## Capability evidence table

| Capability | Question | Current status | Evidence required | Evidence received | Verification date | Verified by | Implementation decision | First-real-SMS blocker |
|---|---|---|---|---|---|---|---|---|
| Production endpoint and request schema | What is the official production SMS URL/path, content type, request fields, and example request? | `UNKNOWN` | Official API doc or written support response. | None. | TBD | TBD | Adapter must match official schema before enablement. | Yes |
| Authentication method | What auth method is required for submission? | `UNKNOWN` | Official auth doc or written support response. | None. | TBD | TBD | Configure only through protected runtime secrets after auth is confirmed. | Yes |
| Token lifecycle | How are tokens generated, rotated, revoked, scoped, expired, and audited? | `UNKNOWN` | Dashboard evidence or written support response. | None. | TBD | TBD | Require rotation/revocation runbook before live test. | Yes |
| IP allowlisting | Is source IP allowlisting required or available? | `UNKNOWN` | Official account/security guidance. | None. | TBD | TBD | If available/required, owner must approve outbound source IP before test. | Yes |
| Sender ID approval | What sender ID is approved and what field carries it? | `UNKNOWN` | Sender approval evidence and API field documentation. | None. | TBD | TBD | Block real sends until approved sender evidence exists. | Yes |
| Provider message ID field | Which synchronous response field is the authoritative provider message ID? | `UNKNOWN` | Success response schema and example. | None. | TBD | TBD | Persist only authoritative provider ID; no delivery claim from submission. | Yes |
| Acceptance vs delivery | Does synchronous success mean accepted or delivered? | `UNKNOWN` | Official status semantics. | None. | TBD | TBD | Treat submission as accepted only unless Sparrow proves otherwise; delivered only via callback/reconciliation. | Yes |
| Client reference support | Can FieldOS send a client reference/external ID/metadata field? | `UNKNOWN` | Official request schema or support response. | None. | TBD | TBD | Use provider-documented field only; otherwise rely on provider ID and reconciliation. | Yes |
| Provider idempotency | Does Sparrow support idempotency key/header or duplicate suppression? | `UNKNOWN` | Official idempotency behavior documentation. | None. | TBD | TBD | If unsupported, add `provider_uncertain`/`manual_review` and prohibit automatic resend. | Yes |
| Duplicate same payload | What happens when the same key/reference and same payload are submitted twice? | `UNKNOWN` | Written duplicate behavior confirmation or sandbox result. | None. | TBD | TBD | Same-key/same-payload duplicate should map to existing provider reference if supported. | Yes |
| Duplicate conflicting payload | What happens when the same key/reference and different payload are submitted? | `UNKNOWN` | Written conflict behavior confirmation or sandbox result. | None. | TBD | TBD | Conflict must enter manual review; no blind resend. | Yes |
| Supported Nepal phone formats | Which national/international Nepal formats are accepted? | `UNKNOWN` | Official format guidance and examples. | None. | TBD | TBD | Keep strict normalization; adjust adapter only after confirmation. | Yes |
| Message length | What GSM/Unicode maximum lengths apply before multipart? | `UNKNOWN` | Official message length documentation. | None. | TBD | TBD | First test template must remain short unless multipart verified. | Yes |
| Unicode/Nepali support | Are Nepali/Unicode messages supported and with what encoding? | `UNKNOWN` | Official encoding documentation or tested sandbox response. | None. | TBD | TBD | Do not use Nepali/Unicode first template unless support and pricing are verified. | Yes |
| Multipart behavior | How are long/multipart SMS split, delivered, and billed? | `UNKNOWN` | Official multipart behavior/pricing documentation. | None. | TBD | TBD | Block long/multipart templates until verified. | Yes |
| Retryable errors | Which error codes/statuses are retryable? | `UNKNOWN` | Official error-code table. | None. | TBD | TBD | Map retryable failures only from authoritative Sparrow semantics. | Yes |
| Permanent errors | Which error codes/statuses require operator action? | `UNKNOWN` | Official error-code table. | None. | TBD | TBD | Permanent failures must not retry automatically. | Yes |
| Rate limits | What rate limits apply and how are they reported? | `UNKNOWN` | Official rate-limit documentation and response examples. | None. | TBD | TBD | Use conservative FieldOS local limits and provider backoff after confirmation. | Yes |
| Retry-after guidance | Does Sparrow return retry-after or equivalent delay guidance? | `UNKNOWN` | Official response header/body behavior. | None. | TBD | TBD | Honor documented guidance; otherwise use conservative backoff. | Yes |
| Callback registration | How is a delivery callback URL registered? | `UNKNOWN` | Dashboard evidence or written support process. | None. | TBD | TBD | Do not expose/register callback until auth model is known. | Yes |
| Callback payload schema | What fields and examples are used for delivery callbacks? | `UNKNOWN` | Official callback schema and examples. | None. | TBD | TBD | Implement Sparrow-specific parser only from authoritative schema. | Yes |
| Callback authentication | Are callbacks signed/authenticated? | `UNKNOWN` | Official signature/auth/IP guidance. | None. | TBD | TBD | If unsigned, require owner-approved compensating controls. | Yes |
| Callback replay protection | Does Sparrow include timestamp/nonce/event ID for replay protection? | `UNKNOWN` | Official callback security documentation. | None. | TBD | TBD | Keep FieldOS replay controls; adapt to provider fields. | Yes |
| Callback retry policy | What happens when FieldOS callback endpoint returns non-2xx or is down? | `UNKNOWN` | Official retry policy. | None. | TBD | TBD | If callbacks are lossy, scheduled/manual reconciliation is required. | Yes |
| Callback event ordering | Are callbacks ordered? Can older states arrive after final states? | `UNKNOWN` | Official ordering semantics. | None. | TBD | TBD | Preserve strict transition/final-state protection. | Yes |
| Duplicate callbacks | Can duplicate callbacks occur and what stable event ID identifies them? | `UNKNOWN` | Official duplicate callback guidance. | None. | TBD | TBD | Use provider event ID uniqueness; conflicts require rejection/manual review. | Yes |
| Delivery status vocabulary | What are all status values and meanings? | `UNKNOWN` | Official status vocabulary. | None. | TBD | TBD | Map statuses only after authoritative confirmation. | Yes |
| Lookup by provider ID | Can delivery status be queried by Sparrow message ID? | `UNKNOWN` | Official lookup API documentation. | None. | TBD | TBD | Use scheduled reconciliation if available; manual review if unavailable. | Yes |
| Lookup by client reference/idempotency | Can status be queried by client reference or idempotency key? | `UNKNOWN` | Official lookup API documentation. | None. | TBD | TBD | Prefer client-reference reconciliation if supported. | Yes |
| Reporting/export APIs | Are sent-message reports/export APIs available? | `UNKNOWN` | Official reporting docs/dashboard evidence. | None. | TBD | TBD | Manual/export reconciliation required if no API exists. | Yes |
| Balance API | Is account balance available through API or dashboard? | `UNKNOWN` | Official balance API/dashboard evidence. | None. | TBD | TBD | Require balance evidence before and after first test. | Yes |
| Transaction history API | Is transaction/billing history available? | `UNKNOWN` | Official billing/reporting documentation. | None. | TBD | TBD | Require manual cost evidence if API unavailable. | Yes |
| Pricing | What are GSM and Unicode/Nepali per-SMS prices? | `UNKNOWN` | Official pricing or written quote. | None. | TBD | TBD | Owner sets max test cost before live test. | Yes |
| Balance exhaustion behavior | What happens when credits/balance are insufficient? | `UNKNOWN` | Official account behavior documentation. | None. | TBD | TBD | Treat insufficient balance as operator-action permanent failure. | Yes |
| Sandbox/test mode | Is sandbox/test mode available and non-billing? | `UNKNOWN` | Official sandbox documentation or written response. | None. | TBD | TBD | If unavailable, one-message production test needs explicit owner risk acceptance. | Yes |
| Testing credits | Are testing credits available? | `UNKNOWN` | Account response or dashboard evidence. | None. | TBD | TBD | Verify credits/balance before first send. | Yes |
| Daily/monthly/account limits | What provider/account limits apply? | `UNKNOWN` | Official limits documentation. | None. | TBD | TBD | FieldOS local daily/per-recipient limit remains 1 for first test. | Yes |
| Account/KYC approval | What account approval and KYC requirements must be completed? | `UNKNOWN` | Account representative confirmation. | None. | TBD | TBD | Block provider activation until account is approved. | Yes |

## FieldOS owner decision checklist

After Sparrow replies, FieldOS owner must decide and approve:

- Approved internal test recipient.
- Approved message template and language.
- Maximum test cost and balance threshold.
- Sender ID choice and branding.
- Whether unsigned callbacks are acceptable with compensating controls.
- Whether any rollout can proceed without provider-side idempotency.
- Whether any rollout can proceed without reconciliation/lookup support.
- Whether sandbox absence is acceptable for a one-message production test.
- Written authorization for the one-message test scope, timing, and stop conditions.

## First evidence update procedure

When evidence is received:

1. Save official documentation, support response, or dashboard evidence outside git if it contains account identifiers or secrets.
2. Add only sanitized summaries and evidence references to this tracker.
3. Update `Evidence received`, `Verification date`, `Verified by`, and `Implementation decision`.
4. Keep status `UNKNOWN` until the evidence is authoritative and reviewed.
5. Do not configure credentials or enable provider features as part of evidence tracking.
