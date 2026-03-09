# Asterisk Starter Pack

These files are a starter for a single-tenant lab PBX setup.

## Files
- `pjsip.conf`: SIP endpoints/extensions `1001-1003`
- `queues.conf`: queue `support-main`
- `extensions.conf`: inbound flow + queue + recording + webhook call on hangup

## Basic Flow
1. Inbound trunk enters `[from-trunk]`
2. Call is recorded via `MixMonitor`
3. Call is queued to `support-main`
4. On hangup, Asterisk posts a completed event to Support Hub API

## Required changes before use
- Replace SIP passwords
- Set real DID/trunk context into `[from-trunk]`
- Change `client_id` in webhook payload
- Point webhook URL to your backend host
