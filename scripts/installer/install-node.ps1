<#
  install-node.ps1 —— 把 Node.js 的免安装版下到本地，供一键包装使用。

  为什么要有这个：
    一键包原来只 `where node` 检查，没装就退出，让用户自己去官网下。
    现在改成：没装就自己下一个便携版（约 30MB），解压到工具目录，
    只给这个安装器/桥接用，不写注册表、不改系统环境变量。

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File install-node.ps1
    powershell ... -File install-node.ps1 -Dest "D:\qq-bridge\_runtime\node" -Version v22.23.3

  出口码：0 = node 可用；1 = 失败
#>
param(
    [string]$Dest = "",
    [string]$Version = "v22.23.3",
    [int]$TimeoutSec = 600
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$ProgressPreference = "SilentlyContinue"

if (-not $Dest) { $Dest = Join-Path $PSScriptRoot "_runtime\node" }
$arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } else { "x64" }
$pkg = "node-$Version-win-$arch"
$exe = Join-Path $Dest "node.exe"

function Write-Step([string]$msg) { Write-Host "        $msg" }

# ── 已经可用就直接返回 ─────────────────────────────────────────
if (Test-Path $exe) {
    try {
        $v = & $exe -v 2>$null
        if ($v) { Write-Step "便携版已存在：$v（$Dest）"; exit 0 }
    } catch {}
}

# ── 依次试镜像 ────────────────────────────────────────────────
$urls = @(
    "https://npmmirror.com/mirrors/node/$Version/$pkg.zip",
    "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/$Version/$pkg.zip",
    "https://nodejs.org/dist/$Version/$pkg.zip"
)

$tmpDir = Join-Path $env:TEMP ("node-portable-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
$zip = Join-Path $tmpDir "$pkg.zip"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

$got = $null
foreach ($u in $urls) {
    try {
        Write-Step "下载中：$u"
        Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing -TimeoutSec $TimeoutSec
        if ((Test-Path $zip) -and (Get-Item $zip).Length -gt 10MB) { $got = $u; break }
        Write-Step "文件太小，换下一个源"
    } catch {
        Write-Step "这个源不行（$($_.Exception.Message)）"
    }
}

if (-not $got) {
    Write-Step "❌ 三个源都没下下来"
    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

# ── 解压、去掉外层目录、落位 ──────────────────────────────────
try {
    Write-Step "解压中…"
    $unzip = Join-Path $tmpDir "unzipped"
    Expand-Archive -Path $zip -DestinationPath $unzip -Force
    $inner = Get-ChildItem $unzip -Directory | Select-Object -First 1
    if (-not $inner) { throw "压缩包里没有目录" }

    if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
    New-Item -ItemType Directory -Path (Split-Path $Dest -Parent) -Force | Out-Null
    Move-Item $inner.FullName $Dest
} catch {
    Write-Step "❌ 解压失败：$($_.Exception.Message)"
    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

# ── 验收 ─────────────────────────────────────────────────────
if (-not (Test-Path $exe)) { Write-Step "❌ 没找到 node.exe"; exit 1 }
try { $v = & $exe -v } catch { Write-Step "❌ node.exe 跑不起来"; exit 1 }
$npm = Join-Path $Dest "npm.cmd"
$hasNpm = Test-Path $npm
Write-Step "✅ 便携版 Node $v 已就位：$Dest"
if ($hasNpm) { Write-Step "✅ npm 也在" } else { Write-Step "⚠️ 没看到 npm.cmd（有些精简包会去掉）" }
exit 0
