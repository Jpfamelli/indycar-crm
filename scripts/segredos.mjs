#!/usr/bin/env node
/* Varredura de segredos (npm run segredos).
   Olha os arquivos versionados + os novos que ainda não estão no .gitignore
   e procura chaves com cara de verdade: Anthropic, Supabase (JWT de serviço
   e sb_secret_), GitHub, Meta, AWS, chave privada e variável de segredo com
   valor. Confere também se o .env e o banco local estão ignorados.
   Sai com código 1 se achar algo (bom para rodar antes do commit). */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', a, { cwd: RAIZ, encoding: 'utf8' });

const PADROES = [
  ['chave da Anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['JWT (chave do Supabase?)', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['chave secreta do Supabase', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['token do GitHub', /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{30,}/],
  ['token da Meta', /\bEAA[A-Za-z0-9]{60,}/],
  ['chave da AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['chave privada', /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['variável de segredo com valor', /\b(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_KEY|ANTHROPIC_API_KEY|CRM_AGENDADOR_TOKEN|CODEWORDS_API_KEY|META_ACCESS_TOKEN|GOOGLE_CLIENT_SECRET)\s*[=:]\s*['"]?[A-Za-z0-9_\-.]{16,}/],
];
/* valor de exemplo/teste não é segredo ("cole-aqui", "sua-chave", "ficticia"...) */
const EXEMPLO = /(cole|sua[-_ ]|seu[-_ ]|ficti|teste|exemplo|example|xxx|aqui|placeholder|changeme|invalid)/i;
const BINARIO = /\.(png|jpe?g|gif|webp|ico|db|sqlite|pdf|zip|woff2?|ttf)$/i;

const arquivos = new Set([
  ...git('ls-files').split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
].filter(Boolean).filter(f => !f.startsWith('node_modules/') && !BINARIO.test(f) && f !== 'package-lock.json'));

const achados = [];
for (const f of arquivos) {
  let txt;
  try { txt = fs.readFileSync(path.join(RAIZ, f), 'utf8'); } catch { continue; }
  if (txt.length > 3_000_000) continue;
  txt.split('\n').forEach((linha, i) => {
    for (const [nome, re] of PADROES) {
      const m = re.exec(linha);
      if (m && !EXEMPLO.test(m[0])) achados.push(`${f}:${i + 1}  ${nome}`);
    }
  });
}

// o que precisa estar fora do git
for (const f of ['.env', 'crm.db']) {
  if (!fs.existsSync(path.join(RAIZ, f))) continue;
  try { git('check-ignore', '-q', f); } catch { achados.push(`${f}  NÃO está no .gitignore`); }
  if (git('ls-files', f).trim()) achados.push(`${f}  está versionado (tire com git rm --cached)`);
}

if (achados.length) {
  console.error(`✖ ${achados.length} possível(is) segredo(s) — o valor não é mostrado:`);
  for (const a of achados) console.error('  ' + a);
  process.exit(1);
}
console.log(`✔ nenhum segredo encontrado em ${arquivos.size} arquivos (.env e banco local fora do git).`);
