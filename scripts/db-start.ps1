# Liga o MariaDB local em segundo plano (não precisa de administrador).
. "$PSScriptRoot\_common.ps1"

$cfg = Read-EnvFile
$port = [int]$cfg['DB_PORT']
if (-not $port) { $port = 3306 }

if (Test-DbPort $port) { Write-Host "MariaDB já está rodando na porta $port."; return }
if (-not (Test-Path $DataDir)) { throw 'Banco ainda não preparado. Rode primeiro: npm run db:setup' }

Start-Process -FilePath (Join-Path $MariaBin 'mariadbd.exe') `
    -ArgumentList "--defaults-file=`"$DataDir\my.ini`"", '--bind-address=127.0.0.1', "--port=$port" `
    -WindowStyle Hidden

if (-not (Wait-DbPort $port 30)) { throw "MariaDB não respondeu na porta $port. Veja o log em $DataDir\*.err" }
Write-Host "MariaDB rodando em 127.0.0.1:$port."
