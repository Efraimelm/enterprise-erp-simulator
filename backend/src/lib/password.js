// Hash de senha com Argon2id (recomendação OWASP) e política mínima de senha.
import argon2 from 'argon2';

const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain) => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Hash calculado uma vez e usado quando o usuário não existe, para que a resposta demore
// o mesmo tempo e não revele quais usuários existem.
let dummyHash;
export async function verifyAgainstDummy(plain) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummyHash, plain);
  return false;
}

// Política: mínimo de 12 caracteres e pelo menos 3 destes 4 tipos: minúscula, maiúscula, número, símbolo.
export function passwordPolicyErrors(plain, { username } = {}) {
  const errors = [];
  if (typeof plain !== 'string' || plain.length < 12) errors.push('Use pelo menos 12 caracteres.');
  if (typeof plain === 'string' && plain.length > 128) errors.push('Use no máximo 128 caracteres.');
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(plain || '')).length;
  if (kinds < 3) errors.push('Misture pelo menos 3 tipos: minúsculas, maiúsculas, números e símbolos.');
  if (username && plain && plain.toLowerCase().includes(username.toLowerCase())) {
    errors.push('A senha não pode conter o nome de usuário.');
  }
  return errors;
}
