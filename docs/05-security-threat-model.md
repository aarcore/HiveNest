# Security threat model (client + sessiond)

Scope: **local client, loopback sessiond, SSH session, Agent with approval**. Legacy Queen/Worker threats: [legacy-queen-worker.md](./legacy-queen-worker.md).

## Assets

| Asset | Notes |
|-------|--------|
| SSH private keys / agent | Same as login access to hosts |
| Host profiles | Inventory and reachability |
| Active session / PTY | Live control |
| Proposal / approve state | Prevents silent exec |
| LLM API keys | Billing and data exposure |
| Audit log | Accountability |

## Threats and mitigations

| ID | Threat | Mitigation |
|----|--------|------------|
| T1 | Agent tricked into destructive commands | Show full command; default pending for medium/high; blocklists; audit |
| T2 | Prompt injection via remote output | Untrusted tool results; no model self-approve |
| T3 | Local process abuses sessiond | Loopback bind; bearer token |
| T4 | Key leakage | Prefer agent; no cloud key upload; redacted logs |
| T5 | SSH MITM | known_hosts TOFU UI; no silent insecure host key in production path |
| T6 | User mis-clicks approve | Risk labels; no “always allow” for high risk by default |
| T7 | LLM provider data exposure | Optional disable Agent; never send keys/passwords in prompts |
| T8 | Supply chain | Signed releases (manual today); pinned deps |

## MVP checklist

- [ ] High-risk exec rejected without approval
- [ ] Proposed and executed commands visible in UI
- [ ] Audit records host, command, actor, time
- [ ] sessiond refuses non-loopback listen by default
- [ ] Logs and prompts exclude secrets
- [ ] SSH host key policy is explicit (accept / reject / replace)

## Summary

Trust anchor: **the user approving actions in an explicit session**, not a remote control plane. Agent assists; it does not bypass visibility or approval policy.
