import bcrypt from "bcryptjs";

const ROUNDS = 10;
const MAX_PASSWORD_BYTES = 72;

/** 新注册员工在管理员审核通过后的首次登录密码。 */
export const REGISTRATION_INITIAL_PASSWORD = "Hz@123456";

function passwordBytes(password: string): number {
  return new TextEncoder().encode(password).length;
}

export async function hashPassword(plain: string): Promise<string> {
  if (passwordBytes(plain) > MAX_PASSWORD_BYTES) {
    throw new Error("密码不能超过 72 字节");
  }
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function validateNewPassword(password: string): string | null {
  if (password.length < 8) return "密码至少 8 位";
  if (passwordBytes(password) > MAX_PASSWORD_BYTES) return "密码不能超过 72 字节";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "密码需同时包含字母和数字";
  }
  return null;
}
