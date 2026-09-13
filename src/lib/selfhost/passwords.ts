import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import bcrypt from "bcryptjs";

const GENERIC_LOGIN_ERROR = "Неверный email или пароль";

export function genericLoginError(): string {
  return GENERIC_LOGIN_ERROR;
}

export function isBcryptHash(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash);
}

export function isArgon2Hash(hash: string): boolean {
  return hash.startsWith("$argon2");
}

export async function hashPasswordArgon2id(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (isArgon2Hash(passwordHash)) {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }
  if (isBcryptHash(passwordHash)) {
    return bcrypt.compare(password, passwordHash);
  }
  return false;
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
