# Desliga o MariaDB local com segurança.
. "$PSScriptRoot\_common.ps1"

$cfg = Read-EnvFile
$port = [int]$cfg['DB_PORT']
if (-not (Test-DbPort $port)) { Write-Host 'MariaDB já está desligado.'; return }

$env:MYSQL_PWD = $cfg['DB_ROOT_PASSWORD']
& (Join-Path $MariaBin 'mariadb-admin.exe') --user=root --host=127.0.0.1 "--port=$port" --skip-ssl shutdown
Remove-Item Env:MYSQL_PWD
Write-Host 'MariaDB desligado.'
