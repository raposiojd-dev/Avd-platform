# ADR 0003: Reading fleet state
Status: accepted

Session hosts and host pools come from Azure Resource Graph (`desktopvirtualizationresources`) in one paged query per subscription. VM power state comes from the Compute VM list with `statusOnly`, which can rarely return no power state; the UI treats that as the "blank power state" case rather than an error. Requests retry with backoff and honour Retry-After, to stay within ARM throttling limits.
