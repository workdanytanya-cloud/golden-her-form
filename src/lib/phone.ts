/** Russian phone: always starts with 7, display +7 (XXX) XXX-XX-XX */

export function digitsOnlyPhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatRuPhoneInput(raw: string): string {
  let digits = digitsOnlyPhone(raw);

  // 8XXXXXXXXXX → 7XXXXXXXXXX
  if (digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }
  // pasted local 9XXXXXXXXX
  if (digits.length > 0 && !digits.startsWith("7")) {
    digits = `7${digits}`;
  }
  // ensure at least country code while typing
  if (digits.length === 0) {
    return "+7 ";
  }

  digits = digits.slice(0, 11);
  const local = digits.slice(1); // up to 10 digits

  let out = "+7";
  if (local.length === 0) return `${out} `;

  out += ` (${local.slice(0, 3)}`;
  if (local.length < 3) return out;

  out += `) ${local.slice(3, 6)}`;
  if (local.length < 6) return out;

  out += `-${local.slice(6, 8)}`;
  if (local.length < 8) return out;

  out += `-${local.slice(8, 10)}`;
  return out;
}

export function isCompleteRuPhone(value: string): boolean {
  const d = digitsOnlyPhone(value);
  return d.length === 11 && d.startsWith("7");
}
