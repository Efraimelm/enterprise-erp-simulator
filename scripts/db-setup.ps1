# Prepara o banco local do zero. Pode rodar quantas vezes quiser (é idempotente).
# 1) baixa o MariaDB portátil (se ainda não existir) e confere o SHA-256
# 2) cria o .env com senhas aleatórias (se ainda não existir)
# 3) inicializa a pasta de dados, liga o banco e cria os bancos erp_dev / erp_test e o usuário erp_app
. "$PSScriptRoot\_common.ps1"

# 1) MariaDB portátil
if (-not (Test-Path (Join-Path $MariaBin 'mariadbd.exe'))) {
    Write-Host "Baixando MariaDB $MariaVer (~90 MB)..."
    New-Item -ItemType Directory -Force $ToolsDir | Out-Null
    $zip = Join-Path $ToolsDir 'mariadb.zip'
    Invoke-WebRequest -UseBasicParsing $MariaUrl -OutFile $zip
    $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($hash -ne $MariaSha256) { Remove-Item $zip; throw "SHA-256 não confere ($hash). Download descartado." }
    Expand-Archive $zip -DestinationPath $ToolsDir -Force
    Remove-Item $zip
}

# 2) .env
if (-not (Test-Path $EnvFile)) {
    $content = Get-Content (Join-Path $Root '.env.example') -Raw
    foreach ($name in 'DB_PASSWORD', 'DB_ROOT_PASSWORD', 'ADMIN_PASSWORD', 'AUDITOR_PASSWORD') {
        $content = $content -replace "CHANGE_ME_$name", (New-Secret)
    }
    Set-Content -Path $EnvFile -Value $content -Encoding utf8 -NoNewline
    Write-Host 'Arquivo .env criado com senhas aleatórias.'
}
$cfg = Read-EnvFile
$port = [int]$cfg['DB_PORT']

# 3) Pasta de dados
if (-not (Test-Path $DataDir)) {
    Write-Host 'Inicializando a pasta de dados do MariaDB...'
    & (Join-Path $MariaBin 'mariadb-install-db.exe') "--datadir=$DataDir" "--password=$($cfg['DB_ROOT_PASSWORD'])" "--port=$port" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao inicializar o MariaDB.' }
}

& "$PSScriptRoot\db-start.ps1"

$sql = @"
CREATE DATABASE IF NOT EXISTS ``$($cfg['DB_NAME'])`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS ``$($cfg['DB_NAME_TEST'])`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$($cfg['DB_USER'])'@'localhost' IDENTIFIED BY '$($cfg['DB_PASSWORD'])';
CREATE USER IF NOT EXISTS '$($cfg['DB_USER'])'@'127.0.0.1' IDENTIFIED BY '$($cfg['DB_PASSWORD'])';
ALTER USER '$($cfg['DB_USER'])'@'localhost' IDENTIFIED BY '$($cfg['DB_PASSWORD'])';
ALTER USER '$($cfg['DB_USER'])'@'127.0.0.1' IDENTIFIED BY '$($cfg['DB_PASSWORD'])';
GRANT ALL PRIVILEGES ON ``$($cfg['DB_NAME'])``.* TO '$($cfg['DB_USER'])'@'localhost', '$($cfg['DB_USER'])'@'127.0.0.1';
GRANT ALL PRIVILEGES ON ``$($cfg['DB_NAME_TEST'])``.* TO '$($cfg['DB_USER'])'@'localhost', '$($cfg['DB_USER'])'@'127.0.0.1';
FLUSH PRIVILEGES;
"@
# A senha vai por variável de ambiente, não pela linha de comando (não aparece na lista de processos).
$env:MYSQL_PWD = $cfg['DB_ROOT_PASSWORD']
$sql | & (Join-Path $MariaBin 'mariadb.exe') --user=root --host=127.0.0.1 "--port=$port" --skip-ssl
$code = $LASTEXITCODE
Remove-Item Env:MYSQL_PWD
if ($code -ne 0) { throw 'Falha ao criar bancos e usuário.' }

Write-Host "Pronto: bancos $($cfg['DB_NAME']) e $($cfg['DB_NAME_TEST']) e usuário $($cfg['DB_USER']) configurados."
