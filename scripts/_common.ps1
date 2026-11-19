# Funções e caminhos usados pelos scripts do banco local.
$ErrorActionPreference = 'Stop'

$Root        = Split-Path $PSScriptRoot -Parent
$MariaVer    = '11.4.5'
$MariaSha256 = 'b7c11d38657f16b837e68199d73670510aadb78f42dfa5d5fdea31a7aab342e3'
$MariaUrl    = "https://archive.mariadb.org/mariadb-$MariaVer/winx64-packages/mariadb-$MariaVer-winx64.zip"
$ToolsDir    = Join-Path $Root '.tools'
$MariaBin    = Join-Path $ToolsDir "mariadb-$MariaVer-winx64\bin"
$DataDir     = Join-Path $ToolsDir 'mariadb-data'
$EnvFile     = Join-Path $Root '.env'

function Read-EnvFile {
    $vars = @{}
    if (Test-Path $EnvFile) {
        foreach ($line in Get-Content $EnvFile) {
            if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim() }
        }
    }
    return $vars
}

function New-Secret {
    # Senha aleatória criptograficamente segura, só letras e números (sem aspas para o SQL).
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $s = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '')
    return 'Erp' + $s.Substring(0, 20) + '7'
}

function Test-DbPort([int]$Port) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $Port); $c.Close(); return $true
    } catch { return $false }
}

function Wait-DbPort([int]$Port, [int]$Seconds = 30) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-DbPort $Port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}
