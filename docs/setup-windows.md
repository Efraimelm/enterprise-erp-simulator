# Instalação e execução no Windows

Testado no Windows 11 com Node.js 24 e PowerShell 5.1. **Não precisa de administrador.**

## 1. Pré-requisitos (uma vez)

| Programa | Como conferir | Onde baixar |
| --- | --- | --- |
| Node.js 22 ou superior | `node -v` | https://nodejs.org (versão LTS) |
| Git | `git --version` | https://git-scm.com |

> Crie o projeto **fora do OneDrive** (ex.: `C:\dev`). A pasta `node_modules` tem milhares de arquivos e deixa a sincronização lenta.

## 2. Primeira execução

Abra o PowerShell e rode:

```powershell
cd C:\dev\enterprise-erp-simulator
npm install
```
Instala as bibliotecas do backend e do frontend. Pode aparecer o aviso `allow-scripts` sobre `argon2` e `esbuild`. Ele é inofensivo: os dois já trazem os binários prontos para Windows.

```powershell
npm run db:setup
```
1. Baixa o MariaDB 11.4.5 portátil (~90 MB) de archive.mariadb.org e confere o SHA-256.
2. Cria o arquivo `.env` com senhas aleatórias.
3. Inicializa o banco em `.tools\mariadb-data`, liga o banco e cria `erp_dev`, `erp_test` e o usuário `erp_app`.

```powershell
npm run migrate
npm run seed
```
Cria as tabelas e carrega a empresa fictícia, as roles e os usuários `admin` e `auditor`.

```powershell
npm run dev
```
Sobe o backend (http://127.0.0.1:3001) e o frontend (http://localhost:5173). Deixe essa janela aberta.

Abra **http://localhost:5173**. Usuário `admin`. A senha está em `.env`, no campo `SEED_ADMIN_PASSWORD`. Para abrir o arquivo: `notepad .env`. No primeiro login você define uma senha nova.

## 3. Dia a dia

```powershell
cd C:\dev\enterprise-erp-simulator
npm run db:start     # liga o banco (depois de reiniciar o PC)
npm run dev          # sobe o sistema
```
Para parar: `Ctrl+C` na janela do `npm run dev` e depois `npm run db:stop`.

## 4. Testes

```powershell
npm test
```
Recria o banco `erp_test` e roda os testes da API. O banco precisa estar ligado.

## 5. Problemas comuns

| Mensagem | Causa | Solução |
| --- | --- | --- |
| `Não consegui conectar no banco 127.0.0.1:3306` | Banco desligado | `npm run db:start` |
| `Existem N migrations pendentes` | Código novo com tabelas novas | `npm run migrate` |
| `Configuração inválida no .env` | `.env` ausente ou incompleto | `npm run db:setup` (não sobrescreve um `.env` existente) |
| `Port 5173 is already in use` | Outro `npm run dev` aberto | Feche a outra janela |
| `execução de scripts foi desabilitada` | Política do PowerShell | Os scripts `npm run db:*` já usam `-ExecutionPolicy Bypass` só para eles |
| Esqueci a senha do admin | — | `npm run db:reset` recria o banco de desenvolvimento e volta à senha do `.env` (**apaga os dados**) |
| `MariaDB não respondeu` | Porta 3306 ocupada por outro MySQL | Mude `DB_PORT` no `.env` e rode `npm run db:setup` de novo |
