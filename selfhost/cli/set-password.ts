import process from "node:process";
import { loadSelfhostEnvFiles } from "../src/lib/selfhost/load-env";
import { closePostgresPool, getPostgresPool } from "../src/lib/selfhost/db";
import { hashPasswordArgon2id } from "../src/lib/selfhost/passwords";

loadSelfhostEnvFiles();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(prompt);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\n" || ch === "\r") {
          cleanup();
          stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          reject(new Error("Отменено"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode?.(Boolean(wasRaw));
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}

async function main() {
  if (process.argv.some((item) => item.startsWith("--password"))) {
    throw new Error("Пароль нельзя передавать аргументом командной строки");
  }
  const email = arg("--email")?.trim().toLowerCase();
  if (!email) throw new Error("Укажите --email");
  const password = await readHidden("Новый пароль: ");
  const confirm = await readHidden("Повторите пароль: ");
  if (password !== confirm) throw new Error("Пароли не совпадают");
  if (password.length < 8) throw new Error("Пароль должен содержать минимум 8 символов");
  const hash = await hashPasswordArgon2id(password);
  const result = await getPostgresPool().query(
    `UPDATE public.users SET password_hash = $2, updated_at = (now() AT TIME ZONE 'utc')
     WHERE email = $1 RETURNING id`,
    [email, hash],
  );
  if (!result.rowCount) throw new Error("Пользователь не найден");
  console.log(JSON.stringify({ updated: true, userId: result.rows[0].id }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
