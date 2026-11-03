#Requires -Version 7.2
<#
.SYNOPSIS
    Builds the deployable zip package for the watchdog Function App.

.DESCRIPTION
    1. Refreshes lib/Invoke-AvdHibernateWatchdog.ps1 from tools/Invoke-AvdHibernateWatchdog.ps1.
       The tool script is the SINGLE SOURCE OF TRUTH for remediation behaviour. The copy in lib/ is
       committed only so the Function folder is self-contained and testable; tests/Invoke-Tests.ps1
       fails if the two ever differ, so they cannot silently drift.
    2. Bundles the Az modules listed in requirements.psd1 into ./Modules (Flex Consumption does not
       support managed dependencies:
       https://learn.microsoft.com/azure/azure-functions/functions-reference-powershell#dependency-management )
       and writes Modules/modules.lock.json with the exact versions bundled.
    3. Zips the Function root (excluding tests, local settings, build output) for
       `az functionapp deployment source config-zip`
       (https://learn.microsoft.com/azure/azure-functions/deployment-zip-push#deploy-a-package ).

.PARAMETER OutputPath
    Zip file to create. Default: ./dist/watchdog-<yyyyMMddHHmmss>.zip

.PARAMETER SkipModules
    Do not download modules (offline/CI dry run). The resulting zip is NOT deployable.

.EXAMPLE
    ./build.ps1 -OutputPath ./dist/watchdog.zip
#>
[CmdletBinding()]
param(
    [string] $OutputPath,
    [switch] $SkipModules
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$toolSource = Join-Path $root '..' '..' 'tools' 'Invoke-AvdHibernateWatchdog.ps1' | Resolve-Path
$toolCopy = Join-Path $root 'lib' 'Invoke-AvdHibernateWatchdog.ps1'

# 1. Single-source copy ---------------------------------------------------------------------------
Copy-Item -LiteralPath $toolSource -Destination $toolCopy -Force
Write-Host "Refreshed $toolCopy from $toolSource"

# 2. Bundle modules -------------------------------------------------------------------------------
$modulesDir = Join-Path $root 'Modules'
if (-not $SkipModules) {
    $requirements = Import-PowerShellDataFile -Path (Join-Path $root 'requirements.psd1')
    Get-ChildItem -Path $modulesDir -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

    foreach ($name in $requirements.Keys) {
        $spec = [string]$requirements[$name]
        if ($spec -notmatch '^(?<major>\d+)\.\*$') { throw "requirements.psd1: '$name' must be pinned as '<major>.*' (got '$spec')." }
        $major = [int]$Matches.major
        $range = "[$major.0.0, $($major + 1).0.0)"
        Write-Host "Saving $name $range ..."
        Save-PSResource -Name $name -Version $range -Repository PSGallery -Path $modulesDir -TrustRepository -ErrorAction Stop
    }

    $lock = foreach ($dir in Get-ChildItem -Path $modulesDir -Directory) {
        $version = (Get-ChildItem -Path $dir.FullName -Directory | Sort-Object { [version]($_.Name -replace '-.*$', '') } -Descending | Select-Object -First 1).Name
        [ordered]@{ name = $dir.Name; version = $version }
    }
    $lock | ConvertTo-Json | Set-Content -Path (Join-Path $modulesDir 'modules.lock.json') -Encoding utf8
    Write-Host 'Wrote Modules/modules.lock.json'
}
else {
    Write-Warning 'SkipModules set: the package will not contain Az modules and is NOT deployable.'
}

# 3. Zip ------------------------------------------------------------------------------------------
if (-not $OutputPath) { $OutputPath = Join-Path $root 'dist' "watchdog-$(Get-Date -Format 'yyyyMMddHHmmss').zip" }
$outDir = Split-Path -Parent $OutputPath
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }

$exclude = @('tests', 'dist', '.git', 'local.settings.json', 'build.ps1')
$items = Get-ChildItem -Path $root -Force | Where-Object { $_.Name -notin $exclude }
Compress-Archive -Path $items.FullName -DestinationPath $OutputPath -CompressionLevel Optimal
Write-Host "Created $OutputPath"
