// push で追加された新しいレポートを検出し、ブログ記事の告知を X に投稿する
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TwitterApi } from "twitter-api-v2";

// 末尾スラッシュ付きが事前レンダリング済みページの正規 URL。無しだと 301 を挟むため、
// X がリダイレクト前の内容でカードをキャッシュすることがある
const SITE = "https://blog.kinolab.work";

/**
 * X からの流入を GA4 で分離するための UTM。
 * t.co 経由の referral だけだと、どの投稿から来たのかまでは追えない
 */
function withUtm(url, defaultCampaign) {
  const campaign =
    process.env.UTM_CAMPAIGN ||
    (process.env.MANUAL_PATH ? "repost" : defaultCampaign);
  return `${url}?utm_source=x&utm_medium=social&utm_campaign=${encodeURIComponent(
    campaign,
  )}`;
}

const DAILY_RE = /^daily\/\d{4}\/\d{2}\/(\d{4}-\d{2}-\d{2})\.md$/;
const WEEKLY_RE = /^weekly\/\d{4}\/\d{2}\/(\d{4})-(\d{2})-(\d{2})\.md$/;
const MONTHLY_RE = /^monthly\/\d{4}\/(\d{4})-(\d{2})\.md$/;
// 不定期コラム（ちいかわ）。ID の組み立てはブログ側 digest.ts と同期させること
const COLUMN_RE = /^chiikawa\/(?:.*\/)?(\d{4})-(\d{2})-(\d{2})(?:[-_](.+))?\.md$/;

const DIGEST_HASHTAGS = "#LLM #AIエージェント";
const COLUMN_HASHTAGS = "#ちいかわ #エンジニアと繋がりたい";

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
  const c = COLUMN_RE.exec(path);
  if (!d && !w && !m && !c) {
    return null;
  }

  const content = readFileSync(path, "utf8");
  // レポート冒頭の見出しをタイトルとして使う
  const firstLine = content.split("\n")[0] ?? "";
  const title = firstLine.replace(/^#+\s*/, "").trim() || "最新レポート";
  // weekly / monthly は定型のまとめ文で十分なため固定文を使う
  // （x-summary が埋め込まれていればそちらを優先）
  const explicitSummary = extractExplicitSummary(content);

  if (c) {
    const id = c[4]
      ? `${c[1]}-${c[2]}-${c[3]}_${c[4]}`
      : `${c[1]}-${c[2]}-${c[3]}`;
    return {
      header: "【不定期コラム更新】",
      title,
      teaser: explicitSummary ?? extractParagraphFallback(content),
      url: withUtm(`${SITE}/column/${id}/`, "column"),
      hashtags: COLUMN_HASHTAGS,
    };
  }

  if (d) {
    const [year, month, day] = d[1].split("-");
    return {
      label: `${year}/${Number(month)}/${Number(day)}`,
      title,
      teaser: explicitSummary ?? extractTeaserFallback(content),
      url: withUtm(`${SITE}/daily/${d[1]}/`, "new_post"),
    };
  }
  if (w) {
    return {
      label: `${w[1]}年${Number(w[2])}月 第${Number(w[3])}週`,
      title,
      teaser:
        explicitSummary ??
        "今週のLLM・AIエージェント関連の主要リリース・研究動向・セキュリティインシデントを、1本のレポートで振り返ります",
      url: withUtm(`${SITE}/weekly/${w[1]}-${w[2]}-${w[3]}/`, "new_post"),
    };
  }
  return {
    label: `${m[1]}年${Number(m[2])}月`,
    title,
    teaser:
      explicitSummary ??
      "今月のLLM・AIエージェント動向を総括。主要モデルのリリース・研究・セキュリティの動きをまとめて確認できます",
    url: withUtm(`${SITE}/monthly/${m[1]}-${m[2]}/`, "new_post"),
  };
}

// レポート生成側が埋め込む X 告知用サマリ（<!-- x-summary: ... -->）を取り出す
function extractExplicitSummary(content) {
  // 要約に「>」を書くことがあるので `-->` までを拾う。ただし閉じ忘れたコメントが
  // 本文を飲み込まないよう、改行と `-->` のどちらも跨がせない（x-summary は必ず1行）。
  // ブログ側 front/scripts/articleText.mjs と同じ正規表現。片方を直したら両方直すこと
  const explicit = /<!--\s*x-summary:\s*((?:(?!-->)[^\n])*)\s*-->/.exec(content);
  // 中身が空のコメントで本文の無い投稿にならないよう、空なら既定文にフォールバックする
  const summary = explicit?.[1].trim();
  if (!summary) {
    return null;
  }
  // 座談会形式の告知では発言ごとに改行したいが、x-summary は1行しか書けない。
  // リテラルの \n を実際の改行に戻すことで、1行のまま複数行の本文を表現する。
  // ブログ側（front/scripts/articleText.mjs・src/lib/articleMeta.ts）は同じ箇所を
  // 空白に落としてカード説明文にしている。片方を直したらもう片方も直すこと
  const withBreaks = summary.replace(/\\n/g, "\n");
  // 生成側の書きすぎに備えて上限だけかける（改行ぶん従来より緩めている）
  return truncateTeaser(withBreaks, 50, 140);
}

// 冒頭の引用ブロック（「今号について」など）から 50〜80 字のティーザーを自動抽出する
function extractTeaserFallback(content) {
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t.startsWith(">")) {
      continue;
    }
    const plain = t
      .replace(/^>+\s*/, "")
      .replace(/^\*\*[^*]+\*\*[:：]?\s*/, "")
      .replace(/\[\[\d+\]\]\(#[^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .trim();
    if (!plain) {
      continue;
    }
    // 「対象期間（…）は〜」の定型文はスキップし、中身のある文から拾う
    const sentences = plain
      .split("。")
      .map((s) => s.trim())
      .filter(Boolean);
    const body =
      sentences.find((s) => !s.startsWith("対象期間")) ?? sentences[0] ?? "";
    const cleaned = body
      .replace(/^(一方で|また|さらに|なお|加えて)、?/, "")
      .replace(/^[:：、。\s]+/, "");
    if (cleaned) {
      return truncateTeaser(cleaned);
    }
  }
  return "";
}

// コラム記事（引用ブロックを持たない構成）向け: 最初の通常段落をティーザーにする
function extractParagraphFallback(content) {
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (
      !t ||
      t.startsWith("#") ||
      t.startsWith("---") ||
      t.startsWith(">") ||
      t.startsWith("- ") ||
      t.startsWith("* ") ||
      t.startsWith("<") ||
      t.startsWith("|")
    ) {
      continue;
    }
    const plain = t
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .trim();
    if (plain) {
      return truncateTeaser(plain);
    }
  }
  return "";
}

function truncateTeaser(text, min = 50, max = 80) {
  if (text.length <= max) {
    return text;
  }
  // min〜max 字の間に句読点があればそこで自然に切る
  for (let i = min; i <= max; i += 1) {
    if ("、。".includes(text[i])) {
      return `${text.slice(0, i)}…`;
    }
  }
  return `${text.slice(0, max)}…`;
}

// X の重み付き文字数（CJK・絵文字は2、半角は1。URL は一律23）
function weightedLength(text) {
  return [...text].reduce(
    (n, ch) => n + (ch.codePointAt(0) > 0x10ff ? 2 : 1),
    0,
  );
}

const X_LIMIT = 280;
const URL_WEIGHT = 23;
const SAFETY_MARGIN = 6;

// 重み付き上限 maxWeight まで文字列を切り出す（CJK・絵文字は2、半角は1）
function sliceWeighted(text, maxWeight) {
  let w = 0;
  let out = "";
  for (const ch of text) {
    const cw = ch.codePointAt(0) > 0x10ff ? 2 : 1;
    if (w + cw > maxWeight) break;
    w += cw;
    out += ch;
  }
  return out;
}

function composeText({ label, header, title, teaser, url, hashtags }) {
  const tags = hashtags ?? DIGEST_HASHTAGS;
  // コラムは長い H1 を載せず header（+x-summary）を本文にする。
  // daily/weekly/monthly は「📰 日付 | タイトル」形式（タイトルは短い）
  const head = header ?? `📰 ${label} | ${title}`;

  // 固定部分（head・区切り・URL・ハッシュタグ）の重みを引いた残りを summary に割り当てる。
  // URL は実長に関わらず X 上は 23 単位で計算される
  const fixedWeight =
    weightedLength(head) + weightedLength(tags) + URL_WEIGHT + SAFETY_MARGIN;
  const budget = X_LIMIT - fixedWeight;

  let summary = teaser ?? "";
  if (weightedLength(summary) > budget) {
    summary = `${sliceWeighted(summary, Math.max(0, budget - 2))}…`;
  }

  const summaryBlock = summary ? `${summary}\n\n` : "";
  return `${head}\n\n${summaryBlock}${url}\n${tags}`;
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
    // 同一 push で announce が二重起動した場合など、既に投稿済みの内容を再投稿すると
    // X が重複エラー（403 / duplicate content）を返す。これは実害がないため成功扱いにする
    const isDuplicate = /duplicate/i.test(`${detail} ${JSON.stringify(error?.data ?? {})}`);
    if (isDuplicate) {
      console.log(`スキップ: ${announcement.url} は既に投稿済み（重複）`);
      continue;
    }
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
