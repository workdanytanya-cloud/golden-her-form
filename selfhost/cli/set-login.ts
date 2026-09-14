import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadSelfhostEnvFiles } from "../../src/lib/selfhost/load-env";
import { closePostgresPool, getPostgresPool } from "../../src/lib/selfhost/db";
import { listImportedUsers, updateImportedUserLogin } from "../../src/lib/selfhost/set-login";

loadSelfhostEnvFiles();

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
  if (process.argv.some((item) => item.startsWith("--email") || item.startsWith("--password"))) {
    throw new Error("Email и пароль нельзя передавать аргументами командной строки");
  }
  const pool = getPostgresPool();
  const users = await listImportedUsers(pool);
  if (users.length === 0) throw new Error("Импортированных пользователей нет");

  console.log("Импортированные пользователи:");
  users.forEach((user, index) => {
    console.log(
      `${index + 1}. role=${user.role} access=${user.accessStatus ?? "none"} courses=${user.courseCount} email=${user.emailMasked}`,
    );
  });

  const rl = readline.createInterface({ input, output });
  const indexRaw = (await rl.question("Номер пользователя: ")).trim();
  const index = Number(indexRaw);
  if (!Number.isInteger(index) || index < 1 || index > users.length) {
    rl.close();
    throw new Error("Некорректный номер пользователя");
  }
  const email = await rl.question("Новый email: ");
  rl.close();

  const password = await readHidden("Пароль: ");
  const confirm = await readHidden("Повторите пароль: ");
  if (password !== confirm) throw new Error("Пароли не совпадают");

  const selected = users[index - 1];
  if (!selected) throw new Error("Пользователь не найден");
  await updateImportedUserLogin(pool, { userId: selected.id, email, password });
  console.log(JSON.stringify({ updated: true }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
