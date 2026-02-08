export const MIST_PER_SUI = 1_000_000_000n;
export const U64_MAX = (1n << 64n) - 1n;

export function formatMistToSui(mist: bigint | string) {
  let v: bigint;
  try {
    v = typeof mist === "bigint" ? mist : BigInt(mist || "0");
  } catch {
    return "-";
  }
  const whole = v / MIST_PER_SUI;
  const frac = v % MIST_PER_SUI;
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

export function parseSuiToMist(input: string): bigint {
  const s = input.trim();
  if (!s) throw new Error("Amount is required");
  if (s.startsWith("-")) throw new Error("Amount must be positive");

  const m = s.match(/^(\d+)(?:\.(\d{0,9})\d*)?$/);
  if (!m) throw new Error("Invalid amount");

  const whole = BigInt(m[1] || "0");
  const fracRaw = m[2] || "";
  const fracPadded = (fracRaw + "000000000").slice(0, 9);
  const frac = BigInt(fracPadded || "0");
  const mist = whole * MIST_PER_SUI + frac;
  if (mist > U64_MAX) throw new Error("Amount too large");
  return mist;
}

