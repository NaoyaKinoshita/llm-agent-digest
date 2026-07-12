// push で追加された新しいレポートを検出し、ブログ記事の告知を X に投稿する
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TwitterApi } from "twitter-api-v2";

const SITE = "https://blog.kinolab.work";

const DAILY_RE = /^daily\/\d{4}\/\d{2}\/(\d{4}-\d{2}-\d{2})\.md$/;
const WEEKLY_RE = /^weekly\/\d{4}\/\d{2}\/(\d{4})-(\d{2})-(\d{2})\.md$/;
const MONTHLY_RE = /^monthly\/\d{4}\/(\d{4})-(\d{2})\.md$/;

// 対象を「このpushで新規追加された md」に限定することで二重投稿を防ぐ。
// 同一日付の改訂版（_v2 など）は正規表現に一致しないため投稿されない
function detectNewArticles() {
  const before = process.env.BEFORE_SHA;
  const after = process.env.AFTER_SHA;
  const manualPath = process.env.MANUAL_PATH;

  if (manualPath) {
    return [manualPath];
  }
  // 新規ブランチ作成などで before が全ゼロの場合は直近コミットのみ対象
  const range = /^0+$/.test(before ?? "")
    ? `${after}~1 ${after}`
    : `${before} ${after}`;
  return execSync(`git diff --name-only --diff-filter=A ${range}`, {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function toAnnouncement(path) {
  const d = DAILY_RE.exec(path);
  const w = WEEKLY_RE.exec(path);
  const m = MONTHLY_RE.exec(path);
  if (!d && !w && !m) {
    return null;
  }

  // レポート冒頭の見出しをタイトルとして使う
  const firstLine = readFileSync(path, "utf8").split("\n")[0] ?? "";
  const title = firstLine.replace(/^#+\s*/, "").trim() || "最新レポート";

  if (d) {
    const [year, month, day] = d[1].split("-");
    return {
      label: `${year}/${Number(month)}/${Number(day)}`,
      title,
      url: `${SITE}/daily/${d[1]}`,
    };
  }
  if (w) {
    return {
      label: `${w[1]}年${Number(w[2])}月 第${Number(w[3])}週`,
      title,
      url: `${SITE}/weekly/${w[1]}-${w[2]}-${w[3]}`,
    };
  }
  return {
    label: `${m[1]}年${Number(m[2])}月`,
    title,
    url: `${SITE}/monthly/${m[1]}-${m[2]}`,
  };
}

// X の文字数制限（日本語は2単位換算で280単位、URLは一律23単位）に収める
function composeText({ label, title, url }) {
  const hashtags = "#LLM #AIエージェント";
  const head = `📰 ${label} | ${title}`;
  const truncated = head.length > 90 ? `${head.slice(0, 89)}…` : head;
  return `${truncated}\n\n${url}\n${hashtags}`;
}

const paths = detectNewArticles();
const announcements = paths
  .map(toAnnouncement)
  .filter((a) => a !== null);

if (announcements.length === 0) {
  console.log("新規レポートなし。投稿をスキップします");
  process.exit(0);
}

// Secrets の登録漏れ・名前違いを実行前に検出する
const required = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `エラー: Secrets が未設定です → ${missing.join(", ")}\n` +
      "リポジトリの Settings → Secrets and variables → Actions で登録してください",
  );
  process.exit(1);
}

const client = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
});

for (const announcement of announcements) {
  const text = composeText(announcement);
  try {
    const { data } = await client.v2.tweet(text);
    console.log(`投稿完了: ${announcement.url} (tweet id: ${data.id})`);
  } catch (error) {
    const code = error?.code ?? "?";
    const detail =
      error?.data?.detail ?? error?.data?.title ?? error?.message ?? "";
    console.error(`エラー: X API が ${code} を返しました: ${detail}`);
    if (code === 401) {
      console.error(
        "→ キーの値が誤っている可能性。4つの Secrets の値を再確認してください",
      );
    } else if (code === 403) {
      console.error(
        "→ App permissions が Read and Write になっているか、その設定後に Access Token を再生成したか、クレジット残高があるかを確認してください",
      );
    }
    process.exit(1);
  }
}
