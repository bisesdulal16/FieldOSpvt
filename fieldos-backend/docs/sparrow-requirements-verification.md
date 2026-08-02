# Sparrow Requirements Verification Plan

Status: planning only. No provider enablement, credentials, worker start, runtime configuration change, n8n connection, Redis replay, reminder activation, Phase 9 work, or SMS send is authorized by this document.

Purpose: determine exactly what authoritative Sparrow information and account access are required before FieldOS implements or enables any real Sparrow SMS provider path.

## Non-goals and hard holds

Do not:

- enable Sparrow in FieldOS;
- add provider credentials to git;
- send any SMS;
- start communication workers;
- change production runtime configuration;
- connect n8n;
- enable Redis replay;
- activate reminders;
- begin Phase 9.

## Evidence standards

Classify Sparrow capabilities using only these labels:

| Status | Meaning |
|---|---|
| `VERIFIED` | Supported by official Sparrow documentation, written Sparrow support/account response, Sparrow dashboard evidence, or tested sandbox response. |
| `UNVERIFIED` | Implied by FieldOS code, existing internal notes, or expected provider behavior, but not confirmed by authoritative Sparrow evidence. |
| `NOT SUPPORTED` | Explicitly rejected by Sparrow authoritative material or proven absent in a documented/tested Sparrow environment. |
| `UNKNOWN` | No usable evidence available. |

Rules:

- Do not treat an existing FieldOS code header, request field, parser candidate, or test fixture as proof Sparrow supports it.
- Do not mark idempotency, callbacks, reconciliation, or rate limits `VERIFIED` without authoritative Sparrow evidence.
- For first real SMS, prefer `UNKNOWN` over optimistic assumptions.

## Repository Sparrow evidence found

### Verified repository documentation

These items are verified only as FieldOS repository behavior or FieldOS documented intent, not as Sparrow provider capabilities:

- `app/services/communication_providers.py` contains `SparrowSmsProvider` behind the communication provider abstraction.
- `SparrowSmsProvider` currently sends an HTTP POST to `SMS_SPARROW_URL` with form body fields `token`, `from`, `to`, and `text`.
- `SparrowSmsProvider` sends a FieldOS-defined `X-FieldOS-Idempotency-Key` header.
- Default config sets `SMS_PROVIDER=log` and `SMS_SPARROW_URL=https://api.sparrowsms.com/v2/sms/`.
- `SMS_API_TOKEN`, `SMS_SENDER`, and `SMS_SPARROW_URL` are required before `SparrowSmsProvider` attempts dispatch.
- Nepal phone normalization currently accepts national `98XXXXXXXX` / `97XXXXXXXX` and `+977` / `977` variants for those prefixes.
- `client-communication-phase3-sparrow.md` states HTTP success means provider acceptance only, not delivery.
- `real-sms-provider-readiness.md` states provider-side idempotency, callback schema/authentication, rate limits, pricing, and reconciliation require external verification.
- `app/routers/communication_callbacks.py` exposes `/client-communication/callbacks/sparrow` for authenticated callbacks using the FieldOS callback framework.
- `app/services/communication_callbacks.py` implements FieldOS-defined HMAC callback verification, timestamp tolerance, replay checks, provider-event uniqueness, duplicate/conflicting callback behavior, and status normalization.
- `fieldos-backend/docs/sparrow-account-onboarding-checklist.md` exists locally and records the test as waiting for provider credentials.

### Inferred implementation behavior

These are implementation assumptions or FieldOS behaviors that still need Sparrow confirmation before real provider use:

- Sparrow accepts the configured base URL and path.
- Sparrow expects token authentication through a `token` form field.
- Sparrow expects sender ID through a `from` form field.
- Sparrow expects recipient through a `to` form field.
- Sparrow expects message text through a `text` form field.
- Sparrow accepts national Nepal mobile numbers without country code after FieldOS normalization.
- A 2xx JSON object means accepted-for-processing.
- Response keys such as `message_id`, `messageId`, `id`, `reference`, `ref`, `response_code`, or `count` might identify provider references.
- HTTP `408`, `409`, `429`, and `5xx` are retryable; `400`, `401`, `403`, `404`, `422`, and malformed 2xx responses are operator/permanent failures.
- `Retry-After` is meaningful for Sparrow rate limits or temporary conflicts.
- Status fields such as `status`, `delivery_status`, or `state` may appear in Sparrow callbacks.
- Callback reference fields such as `message_id`, `provider_reference`, `ref`, or `sms_id` may appear in Sparrow callbacks.
- Callback event fields such as `event_id`, `callback_id`, or `dlr_id` may appear in Sparrow callbacks.

### Placeholders

- `SMS_API_TOKEN=` is intentionally empty in documented safe defaults.
- `SMS_SENDER=<approved sender ID>` is a placeholder until account approval.
- `SMS_CALLBACK_SECRET=` is a FieldOS-side secret placeholder, not proof Sparrow can sign callbacks.
- `SMS_ALLOWED_RECIPIENTS`, daily send limits, cost limits, emergency stop, provider allowlist, approved template controls, and reconciliation flags are proposed future controls in readiness docs, not fully implemented provider capabilities.
- The onboarding checklist contains procedural placeholders: register account, KYC, credits, sender ID, token generation, IP allowlisting check, callback support check, runtime credential loading, and one-shot approval.

### Unverified assumptions

- Production API base URL, request format, and exact field names.
- Sandbox/test API availability.
- Authentication mechanism and token rotation process.
- IP allowlisting requirements.
- Provider-side idempotency support for client-supplied keys or headers.
- Duplicate request behavior for same and conflicting payloads.
- Maximum message length, Unicode/Nepali support, and multipart behavior/pricing.
- Exact synchronous success/error response schema and provider message ID field.
- Rate-limit semantics and retry guidance.
- Delivery callback registration, payload schema, status vocabulary, authentication, retry behavior, duplicate behavior, and event ordering.
- Reconciliation, lookup, reporting/export, delivery-status query, balance, and transaction history APIs.
- Commercial pricing, credits, sender ID approval, daily/monthly limits, and account approval requirements.

## Authoritative request for Sparrow support/account representatives

Send this as a concise request to Sparrow support or the account representative. Do not include FieldOS secrets, real recipient phone numbers, client identifiers, or production account identifiers in the request.

```text
Subject: FieldOS Sparrow SMS API requirements for safe one-message production test

We are preparing a controlled FieldOS SMS integration and need authoritative Sparrow account/API details before enabling any real send. Please provide official documentation or written answers for the items below.

API access
1. What is the production SMS submission base URL and path?
2. Is a sandbox/test API available? If yes, what base URL, credentials, test-number policy, and non-billing behavior apply?
3. What authentication method is required for SMS submission? Body token, header bearer token, basic auth, or another method?
4. How are API tokens generated, rotated, revoked, and scoped?
5. Is source IP allowlisting required or available? If yes, where is it configured?
6. What client-side request timeout and retry guidance do you recommend?

Submission
7. What SMS request fields are required and optional? Please include exact field names, content type, and examples.
8. What field carries the approved sender ID?
9. Is there a client reference, external ID, metadata, or idempotency field/header we can supply?
10. If idempotency or client reference is supported, what happens for the same key with the same payload?
11. What happens for the same key with a different payload?
12. What is the maximum message length for GSM and Unicode messages?
13. Are Nepali/Unicode messages supported? Which encoding is used?
14. How are multipart/long SMS messages handled and billed?
15. What phone-number formats are accepted for Nepal recipients? National 98/97XXXXXXXX, 977 prefix, +977 prefix, or others?

Responses
16. What is the synchronous SMS submission response schema for success and failure?
17. Which response field is the authoritative Sparrow message ID?
18. Does synchronous success mean accepted for processing only, or delivered?
19. What error codes/statuses are retryable versus permanent/operator-action?
20. What is the rate-limit response behavior, including HTTP status, body fields, and retry-after guidance?

Delivery callbacks
21. How do we register a delivery callback URL?
22. What is the callback payload schema? Please include success, failed, expired, rejected, and unknown examples.
23. Does Sparrow sign callbacks or provide authentication? If yes, what exact signature algorithm, headers, canonical input, and timestamp/replay protection are used?
24. If no signature exists, can callbacks be protected by secret URL, source IP allowlist, static token, mTLS, or another control?
25. What is Sparrow's retry policy when the FieldOS callback endpoint is unavailable or returns non-2xx?
26. Are delivery events ordered? Can delivered arrive before accepted/submitted? Can final states be followed by earlier states?
27. Can duplicate callbacks occur? If yes, what stable event ID should we use for idempotency?
28. What is the complete delivery status vocabulary and meaning?

Reconciliation
29. Is there a message lookup API by Sparrow provider message ID?
30. Is there a lookup API by client reference or idempotency key?
31. Are reporting/export APIs available for sent messages and delivery states?
32. Is there a delivery-status query endpoint? What are its fields, limits, and rate limits?
33. Are balance and transaction history APIs available?

Commercial/account
34. What is the price per SMS for GSM and Unicode/Nepali messages?
35. How is multipart SMS priced?
36. What happens when account balance is low or exhausted?
37. What is the sender ID approval process and expected timeline?
38. Are testing credits available?
39. What daily/monthly/account limits apply by default?
40. What business/KYC/account approval requirements must be completed before production SMS?

Please attach official API documentation, dashboard screenshots where relevant, and confirm whether any answers vary by account plan or sender ID approval state.
```

## Local onboarding checklist review

File reviewed: `fieldos-backend/docs/sparrow-account-onboarding-checklist.md`.

### Completed items in repository evidence

- The checklist exists locally.
- It correctly records `Status: waiting_for_provider_credentials`.
- It states worker dispatch is disabled, runtime provider remains `log`, and live SMS sent is `no`.
- It explicitly forbids storing full recipient numbers, tokens, and provider secrets in the document.
- It requires protected runtime configuration and explicit approval before resuming a one-shot test.

### Missing items

- No evidence that Sparrow account registration is complete.
- No evidence that business KYC is complete.
- No evidence of credits or test credits.
- No approved sender ID evidence.
- No generated API token evidence.
- No confirmed API access evidence.
- No confirmed NTC/Ncell sender functionality.
- No confirmed IP allowlisting answer.
- No confirmed delivery-report/callback support.
- No confirmed callback registration/authentication details.
- No confirmed sandbox/test mode.
- No confirmed pricing, rate limits, balance behavior, or account limits.
- No confirmed reconciliation/lookup/reporting APIs.
- No one-message test recipient/template approval record.

### Stale or weak assumptions

- The checklist says “Generate API token” but does not ask whether the token has scopes, expiration, rotation, revocation, or dashboard audit history.
- The checklist says “Confirm delivery-report/callback support” but does not require callback authentication, retry policy, event ordering, duplicate behavior, or status vocabulary.
- The checklist says “Confirm API access” but does not require authoritative request/response schema, error-code mapping, idempotency support, rate-limit behavior, or reconciliation APIs.
- The checklist says “Confirm sender works for NTC and Ncell” but does not require phone-number format, Unicode/Nepali behavior, multipart behavior, or carrier-specific constraints.

### Information that must come from Sparrow

- API URLs, authentication, field names, response schemas, error codes, rate limits, callbacks, reconciliation, lookup/reporting, pricing, credits, sender ID, limits, and account approval requirements.

### Information requiring FieldOS owner approval

- Whether to create/use a Sparrow account under the institution, FieldOS, or another entity.
- Approved sender ID text and branding.
- Approved internal test recipient.
- Approved one-message template and language.
- Acceptable test budget and daily cost/send limits.
- Approved production source IP(s) for allowlisting if required.
- Whether rollout can proceed without sandbox support.
- Whether unsigned callbacks are acceptable with compensating controls.
- Whether to block all real sends if provider idempotency or reconciliation is unavailable.

## Provider capability matrix

| Capability | Current FieldOS assumption | Evidence source | Verification status | Risk if unsupported | Required FieldOS fallback | Blocking for first real SMS |
|---|---|---|---|---|---|---|
| Idempotency | Send stable `X-FieldOS-Idempotency-Key`; provider may dedupe where supported. | Code and Phase 3 docs. | `UNVERIFIED` | Crash/retry can duplicate a real SMS. | Add `provider_uncertain`/manual review; no automatic retry after uncertain provider call; reconcile before resend. | Yes |
| Client reference | Provider may return or accept `reference`/`ref`/similar field. | `_safe_response_reference()` candidates and docs. | `UNVERIFIED` | Hard to match provider records to FieldOS outbox. | Persist provider ID only when authoritative; otherwise require manual reconciliation by time/template/account report. | Yes |
| Callback authentication | FieldOS expects `X-FieldOS-Signature` and timestamp HMAC. | FieldOS callback implementation/tests. | `UNVERIFIED` for Sparrow | Spoofed callbacks could mutate delivery state. | Implement Sparrow-specific auth if available; otherwise secret path, IP allowlist, reference validation, rate limiting, strict transitions, reconciliation. | Yes |
| Callback retries | Provider retries failed callback deliveries. | No Sparrow evidence. | `UNKNOWN` | Lost callbacks cause stuck provider-accepted messages. | Scheduled reconciliation; manual review for missing callbacks beyond SLA. | No for one send if immediate reconciliation/lookup exists; otherwise Yes |
| Delivery status lookup | Query final status by provider ID/client reference. | Readiness docs list as needed. | `UNKNOWN` | Cannot prove delivery/failure when callbacks fail or provider result uncertain. | Manual dashboard/export reconciliation; strict rollout limit. | Yes |
| Message reconciliation | Reporting/export APIs can reconcile sent messages. | Readiness docs list as needed. | `UNKNOWN` | Cannot safely resolve uncertain sends. | Manual review; do not automatically resend uncertain messages. | Yes |
| Rate limits | `429` and `Retry-After` may apply. | Code response mapping. | `UNVERIFIED` | Retry storms, account throttling, delayed sends. | Conservative local daily/per-recipient limits; backoff; emergency stop. | Yes |
| Sender ID | `SMS_SENDER` maps to Sparrow approved sender/from identity. | Config and docs. | `UNVERIFIED` | Rejections, wrong branding, compliance failure. | Keep `SMS_PROVIDER=log`; block real send until approved sender evidence exists. | Yes |
| Sandbox/test mode | A Sparrow sandbox/test mode may exist. | Readiness docs list as gate. | `UNKNOWN` | First validation may bill/send real SMS. | If no sandbox, require one approved internal recipient, daily send limit 1, cost approval, explicit written approval. | No if owner approves controlled live test; otherwise Yes |
| Unicode pricing | Nepali/Unicode supported and priced predictably. | No Sparrow evidence. | `UNKNOWN` | Unexpected cost or garbled Nepali text. | First template should be provider-confirmed encoding; cost cap; use simplest approved text until Unicode verified. | Yes if first template uses Unicode/Nepali; No for ASCII-only approved internal test if pricing known |
| Duplicate-request behavior | Same key/payload may be deduped; same key/different payload may conflict. | FieldOS desired behavior only. | `UNVERIFIED` | Duplicate SMS or ambiguous provider state. | Stable request hash; conflict -> manual review; no blind retry. | Yes |
| Production API base URL | Default `https://api.sparrowsms.com/v2/sms/`. | Config and docs, not external proof. | `UNVERIFIED` | Wrong endpoint or contract. | Confirm with Sparrow before any real request. | Yes |
| Authentication/token rotation | Body `token` works; token can be generated and rotated. | Code and docs. | `UNVERIFIED` | Auth failure or unrotatable leaked credential. | Store only in protected runtime; require rotation/revocation procedure before live test. | Yes |
| Request fields | Uses `token`, `from`, `to`, `text`. | Code and legacy service. | `UNVERIFIED` | Provider rejects sends or interprets fields incorrectly. | Confirm official schema; adjust adapter before enabling. | Yes |
| Synchronous response schema | 2xx JSON object contains provider reference candidate. | Code mapping. | `UNVERIFIED` | Provider accepted send but FieldOS records unusable reference. | Require official response schema; block if provider ID cannot be extracted or reconciled. | Yes |
| Acceptance vs delivery | 2xx means provider accepted, not delivered. | Internal docs and safe state model. | `UNVERIFIED` for Sparrow wording but safe assumption. | Misreporting delivery to users/operators. | Never mark delivered from submission response; use callback/reconciliation only. | No |
| Phone-number formats | National 98/97 and +977/977 variants are acceptable. | FieldOS normalization policy. | `UNVERIFIED` | Rejections or wrong destinations. | Confirm supported formats; keep strict normalization and first recipient manually verified. | Yes |
| Multipart behavior | Long SMS split/charged by provider. | No Sparrow evidence. | `UNKNOWN` | Unexpected cost and multi-part delivery behavior. | Keep first template short; block long/multipart templates until verified. | Yes for long/Unicode test; No for short ASCII test if pricing known |
| Balance/transaction history | Account supports balance checks/transaction reporting. | No Sparrow evidence. | `UNKNOWN` | Sends fail mid-test or cost cannot be audited. | Manual dashboard balance screenshot/evidence before and after test. | Yes |
| Daily/monthly limits | Provider has account limits. | No Sparrow evidence. | `UNKNOWN` | Throttling or compliance issue. | FieldOS local limit=1 for first test; documented account limits before expansion. | Yes |

## Implementation decisions by capability

### Idempotency

If Sparrow supports provider-side idempotency:

- Preserve one stable provider idempotency value per outbox/attempt.
- Send it using Sparrow's documented field/header, not an invented FieldOS header unless Sparrow confirms the header is honored.
- Retry safely with the same value after pre-acceptance retryable failures.
- Store a request hash and idempotency-key hash, not raw PII-bearing payloads.
- Detect same-key/same-payload duplicates and persist the returned existing provider reference as success.
- Detect same-key/different-payload conflicts and mark `provider_uncertain` / manual review.

If Sparrow does not support provider-side idempotency:

- Add `provider_uncertain` / `manual_review` state before real-provider activation.
- Do not automatically retry uncertain real sends after the provider call may have been accepted.
- Reconcile by provider ID, report export, account dashboard, time window, sender, template hash, and masked recipient evidence before any resend.
- If reconciliation cannot prove non-send/non-delivery, default to no automatic resend.

### Callbacks

If Sparrow provides signed callbacks:

- Implement provider-specific verification exactly as documented by Sparrow.
- Verify canonical input, timestamp/replay handling, signature headers, fail-closed empty-secret behavior, malformed/expired timestamp behavior, and duplicate/conflicting payload handling.

If Sparrow callbacks are unsigned:

- Callback path secrecy alone is insufficient and must not be treated as authentication.
- Use compensating controls before accepting callbacks:
  - secret callback path as only one layer;
  - IP allowlist where Sparrow supports stable source IPs;
  - provider message ID validation against stored provider references;
  - callback endpoint rate limiting;
  - strict state-transition rules and final-state protection;
  - duplicate/conflicting callback detection;
  - reconciliation checks for critical status changes.
- Treat unsigned callback support as a risk acceptance decision requiring FieldOS owner approval.

### Reconciliation

If Sparrow provides reconciliation/lookup APIs:

- Implement scheduled reconciliation for provider-accepted rows without callbacks after the agreed SLA.
- Support lookup by provider message ID and, if available, by client reference/idempotency key.
- Store only sanitized reconciliation metadata and hashes in audit logs.

If Sparrow does not provide reconciliation/lookup APIs:

- Require manual review for uncertain sends.
- Keep rollout extremely limited: first one-message test only, then very small batches with manual dashboard/export checks.
- Do not automatically resend any uncertain real SMS.

### Rate limits and pricing

If authoritative rate limits/pricing are available:

- Encode local send/cost ceilings lower than provider limits.
- Use documented retry-after/backoff behavior.
- Add alerts near 80% and 100% of local limits before any rollout beyond one message.

If unavailable:

- First test is limited to one message maximum.
- No batch sends or reminders are permitted.
- Manual account balance/cost evidence is required before and after the test.

## One-message Sparrow test plan — do not execute

This is an eventual test design only. It is not approval to configure credentials, enable Sparrow, start workers, or send SMS.

### Preconditions

- Written approval from FieldOS owner for exactly one real SMS.
- One explicitly approved internal recipient, stored only in protected runtime/test data and reported only masked.
- One approved message template, short enough to avoid multipart unless multipart pricing is verified.
- Sender ID approved by Sparrow and FieldOS owner.
- Sparrow production or sandbox API docs/support response reviewed and attached to the test record.
- API token loaded only through protected runtime environment, never git.
- Balance/cost verified before test.
- Callback endpoint URL verified, HTTPS active, and callback authentication or compensating controls approved.
- Emergency stop active until immediately before the test.
- Daily send limit = 1.
- Per-recipient limit = 1.
- No pending real communication rows.
- Exactly one eligible synthetic/internal test outbox row selected by explicit ID.
- Workers are stopped before and after the one-shot command.
- n8n disabled, Redis replay disabled, reminders disabled, Phase 9 not started.

### Execution outline

1. Capture preflight: git SHA, runtime flags, queue counts, no workers, no pending real rows, balance/cost evidence, callback readiness evidence.
2. Load credentials from protected runtime only.
3. Disable emergency stop only for the bounded one-shot window.
4. Run one one-shot dispatch command scoped to exactly one approved outbox ID.
5. Immediately restore emergency stop and stop/remove any worker process/container used for the one-shot.
6. Capture provider response, FieldOS DB state, queue state, audit records, callback/reconciliation result, and post-test balance/cost evidence.
7. Rotate/revoke test token if exposure or logging anomaly is detected.

### Pass conditions

- Exactly one provider request occurred.
- Exactly one approved internal recipient was targeted.
- Provider reference persisted from the authoritative response field.
- No duplicate dispatch audit/provider call.
- No message sent to real clients or unapproved numbers.
- No full phone number, token, message body, provider raw response, or account identifier appears in logs/audits/docs.
- Queue/retry/DLQ counts return to zero.
- Callback or reconciliation records final state according to authoritative Sparrow status semantics.
- Workers are stopped after test.
- Runtime config restored to safe defaults.

### Fail conditions

- Any unapproved recipient, second provider request, duplicate callback conflict, unknown provider reference, full PII/secret leakage, queue buildup, DLQ growth, callback auth failure, unexpected response schema, missing provider reference, unresolved uncertain send, balance anomaly, or worker left running.
- On failure: emergency stop remains active, provider stays disabled, workers stopped, no resend until reconciliation/manual review completes.

## Blocking unknowns before first real SMS

- Authoritative production API URL and request schema.
- Authentication method, token generation, rotation, revocation, and storage requirements.
- Sender ID approval evidence.
- Provider message ID field in the synchronous success response.
- Provider-side idempotency or documented absence of it plus accepted fallback controls.
- Duplicate-request behavior.
- Callback registration and authentication, or owner-approved unsigned-callback compensating controls.
- Delivery status vocabulary and meaning.
- Reconciliation/lookup/reporting method for uncertain or missing callback cases.
- Rate limits and retry guidance.
- Pricing, Unicode/multipart pricing, balance behavior, and account limits.
- Approved internal recipient and approved one-message template.
- FieldOS owner approval for live test scope and risk acceptance.

## Documentation-only validation expectation

Validation for this planning change is limited to:

```bash
git diff --check
```

No backend tests are required because this file changes documentation only.
