import { readFileSync } from "node:fs";
import { TwitterApi } from "twitter-api-v2";

const SITE_BASE_URL = "https://blog.kinolab.work";

// X API 認証情報の確認
const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET, ADDED_FILES } = process.env;

if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) {
  console.error("エラー: X API の環境変数が設定されていません。");
  process.exit(1);
}

if (!ADDED_FILES) {
  console.log("追加されたコラム記事はありません。");
  process.exit(0);
}

// 追加されたファイルを配列にする (スペース区切り)
const files = ADDED_FILES.split(/\s+/).filter(f => f.startsWith("chiikawa/") && f.endsWith(".md"));

if (files.length === 0) {
  console.log("対象となるコラム記事（chiikawa/*.md）はありませんでした。");
  process.exit(0);
}

const client = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_SECRET,
});

const rwClient = client.readWrite;

// Markdown からタイトルと最初の段落をパースする関数
function parseMarkdown(filePath) {
  try {
    const text = readFileSync(filePath, "utf-8");
    const lines = text.split("\n");
    
    // H1タイトル取得
    const titleLine = lines.find(l => l.startsWith("# "));
    const title = titleLine ? titleLine.slice(2).trim() : "不定期コラム";

    // 最初の通常段落を抜粋として取得
    let excerpt = "";
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("---") || t.startsWith(">") || t.startsWith("- ")) {
        continue;
      }
      excerpt = t;
      break;
    }

    // Markdown 装飾の除去
    excerpt = excerpt
      .replace(/\[\[\d+\]\]\(#[^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .trim();

    return { title, excerpt };
  } catch (e) {
    console.error(`ファイル読み込み失敗: ${filePath}`, e);
    return null;
  }
}

// ファイルパスから記事IDを生成する (フロントエンド digest.ts のロジックと同期)
// chiikawa/2026-07-18_hachiware.md -> 2026-07-18_hachiware
function getArticleId(filePath) {
  const COLUMN_RE = /^chiikawa\/(?:.*\/)?(\d{4})-(\d{2})-(\d{2})(?:[-_](.+))?\.md$/;
  const match = COLUMN_RE.exec(filePath);
  if (match) {
    const year = match[1];
    const month = match[2];
    const day = match[3];
    const slug = match[4];
    return slug ? `${year}-${month}-${day}_${slug}` : `${year}-${month}-${day}`;
  }
  // マッチしなかった場合はファイル名をそのままベースにする
  return filePath.replace("chiikawa/", "").replace(".md", "");
}

// 投稿用テキストを組み立てる (X は全角140字 / 半角280字制限)
function buildTweetText(title, excerpt, url) {
  const header = "【不定期コラム更新】\n";
  const tags = "\n\n#ちいかわ #エンジニアと繋がりたい #llmagentdigest";
  
  // 固定部分の文字数（簡略化のため、全角換算（日本語）で140文字に収まるように計算する）
  const fixedLength = header.length + url.length + tags.length + 5; // 余白マージン
  const maxTitleAndExcerptLen = 140 - fixedLength;

  let contentText = `${title}\n\n`;
  if (excerpt) {
    contentText += `${excerpt}\n`;
  }

  // 140文字を超える場合は、excerpt を短縮
  if ((header + contentText + url + tags).length > 140) {
    const truncatedExcerpt = excerpt.slice(0, Math.max(0, maxTitleAndExcerptLen - title.length - 5)) + "…";
    contentText = `${title}\n\n${truncatedExcerpt}\n`;
  }

  return `${header}${contentText}${url}${tags}`;
}

// メイン処理: 検出されたすべてのコラム記事を投稿する
async function run() {
  for (const file of files) {
    console.log(`処理中: ${file}`);
    const meta = parseMarkdown(file);
    if (!meta) continue;

    const id = getArticleId(file);
    const url = `${SITE_BASE_URL}/column/${id}`;
    const text = buildTweetText(meta.title, meta.excerpt, url);

    console.log("--- 投稿するテキスト ---");
    console.log(text);
    console.log("------------------------");

    try {
      const response = await rwClient.v2.tweet(text);
      console.log(`投稿成功！ Tweet ID: ${response.data.id}`);
    } catch (error) {
      console.error("X への投稿に失敗しました:", error);
    }
  }
}

run();
