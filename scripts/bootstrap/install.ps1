$ErrorActionPreference = "Stop"

Write-Host "MemoryMesh installer (PowerShell)"

function Write-NodeGuidance {
  Write-Host "Node.js 18+ is required to install MemoryMesh CLI."
  Write-Host ""
  Write-Host "Suggested install options:"
  Write-Host "- winget: winget install OpenJS.NodeJS.LTS"
  Write-Host "- Chocolatey: choco install nodejs-lts"
  Write-Host "- Official installer: https://nodejs.org/"
}

function Write-NpmGuidance {
  Write-Host "npm is required to install MemoryMesh CLI."
  Write-Host ""
  Write-Host "Suggested remediation:"
  Write-Host "- Reinstall/upgrade Node.js LTS from https://nodejs.org/"
  Write-Host "- Verify npm is available: npm --version"
}

function Test-Command {
  param([Parameter(Mandatory=$true)][string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-ProcessPath {
  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  if ($machinePath -or $userPath) {
    $env:Path = @($machinePath, $userPath) -ne "" -join ";"
  }
}

function Install-PrerequisitesIfSupported {
  if (Test-Command winget) {
    Write-Host "Attempting best-effort prerequisite install via winget..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    return $true
  }

  if (Test-Command choco) {
    Write-Host "Attempting best-effort prerequisite install via Chocolatey..."
    choco install nodejs-lts -y
    return $true
  }

  return $false
}

Write-Host "Checking prerequisites..."
if (!(Test-Command node) -or !(Test-Command npm)) {
  Write-Host "Node.js and/or npm are missing. Attempting best-effort prerequisite bootstrap..."
  if (!(Install-PrerequisitesIfSupported)) {
    Write-Host "No supported package manager detected for automatic prerequisite install."
  } else {
    Refresh-ProcessPath
  }
}

if (!(Test-Command node)) {
  Write-Error "Missing prerequisite: Node.js"
  Write-NodeGuidance
  exit 1
}

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) {
  Write-Error "Node.js 18+ is required"
  Write-NodeGuidance
  exit 1
}

if (!(Test-Command npm)) {
  Write-Error "Missing prerequisite: npm"
  Write-NpmGuidance
  exit 1
}

Write-Host "Installing/updating MemoryMesh CLI globally..."
npm install -g @okutucu/memorymesh
Refresh-ProcessPath

if (!(Test-Command memorymesh)) {
  Write-Error "memorymesh command not found after install"
  exit 1
}

Write-Host "Starting MemoryMesh..."
memorymesh
