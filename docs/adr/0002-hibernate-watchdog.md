# ADR 0002: Hibernate watchdog
Status: accepted

Problem: session hosts resumed from hibernate can come back with no power state reported and/or an RD Agent that never re-registers. Microsoft documents agent re-registration failures after hibernate resume (see "Hibernation for Azure Virtual Desktop session hosts" on Microsoft Learn).

Decision: a timer Function runs every 15 minutes. A host is acted on only if the problem is confirmed on 3 consecutive checks, is older than a grace period, the host has no user sessions, and it is not tagged `avd-watchdog-exclude`. Per pool it stops if more than 50% look stuck (likely a platform incident) and acts on at most 10 hosts a run. Sequence: drain, optional agent restart, deallocate and verify, optionally start, restore drain state. Default mode is Report; Remediate needs a redeploy because the role assignment follows the mode (least privilege). Agent restart uses Run Command (runs a script as SYSTEM), so it is a separate optional custom role, off by default.

Known gaps: no check for a concurrent scaling-plan resume; a null last-operation time skips the grace period.
