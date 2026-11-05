# Stub Az modules (test doubles)

These three tiny modules shadow `Az.Accounts`, `Az.Compute` and `Az.DesktopVirtualization` ONLY inside
the test run (the runner prepends this folder to `PSModulePath`). They let the real, unmodified
`Invoke-AvdHibernateWatchdog.ps1` run - including its `#Requires -Modules` line - against an in-memory
fake fleet held in `$global:AzFake`, and record every call so tests can assert "no changes were made".

They are never packaged: `build.ps1` excludes the whole `tests` folder.
