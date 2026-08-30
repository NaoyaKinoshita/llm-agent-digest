# Qiita 投稿用のメモ

Qiita へ出すときの、初出リンクの書き方と UTM の付け方。

## ディレクトリの意味

Qiita 向けに書き下ろした・再構成した原稿はこの `qiita/` に置く。
**`chiikawa/` に置くとブログ側が自動で拾って公開してしまう**ため、混ぜないこと
（ブログの記事検出は `chiikawa/(サブディレクトリ可)/YYYY-MM-DD*.md` にマッチする）。

## UTM の付け方

Qiita に貼る自ブログへのリンクには、必ず付ける。

```
?utm_source=qiita&utm_medium=referral&utm_campaign=column&utm_content=top
```

| パラメータ | 値 | 意味 |
| :--- | :--- | :--- |
| `utm_source` | `qiita` | 流入元 |
| `utm_medium` | `referral`（プロフィール欄は `profile`） | 経路の種類 |
| `utm_campaign` | `column` | 施策。X 告知も `column`、読者のシェアは `share_button` |
| `utm_content` | `top` / `bottom` | 冒頭と末尾のどちらが押されたか |

**内部リンク（ブログ内のリンク）には付けないこと。** GA4 がセッションを切り直して計測が壊れる。

## 冒頭に置く初出リンク

### 再構成して出す場合

```markdown
:::note info
この記事は、個人ブログ **kinolab** に書いた記事を、実装寄りに再構成したものです。
初出: [記事タイトル](https://blog.kinolab.work/column/<記事ID>/?utm_source=qiita&utm_medium=referral&utm_campaign=column&utm_content=top)
:::
```

### 全文を転載する場合

```markdown
:::note info
この記事は、個人ブログ **kinolab** に掲載した記事の転載です。
初出: [記事タイトル](https://blog.kinolab.work/column/<記事ID>/?utm_source=qiita&utm_medium=referral&utm_campaign=column&utm_content=bottom)
:::
```

## 末尾に置く導線

「続きはブログで」にしない。Qiita の記事だけで完結させたうえで、
**別の切り口の記事として案内する**。

```markdown
---

この記事のもとになった、**<比喩や切り口の説明>**の記事が個人ブログにあります。
<何が書いてあるか>を知りたい方はこちらもどうぞ。

- [記事タイトル](https://blog.kinolab.work/column/<記事ID>/?utm_source=qiita&utm_medium=referral&utm_campaign=column&utm_content=bottom)
```

## プロフィール欄

```
https://blog.kinolab.work/?utm_source=qiita&utm_medium=profile&utm_campaign=profile
```

## 記事ごとの向き先

| 記事 | Qiita | 補足 |
| :--- | :--- | :--- |
| うさぎ×イベント駆動 | ◎ | 手順＋実エラー3件。最優先 |
| サウナ×リトライ | ◯ | Python コードあり。ほぼそのまま出せる |
| 人魚の島×VPC | ◯ | gcloud コマンドあり |
| コンテナエスケープ | △ | 再構成版が `qiita/2026-08-30_ai-agent-sandbox.md` |
| 冷凍うどん×IT用語 | × | はてブ・X 向き |
| 出汁×UAT | × | 実装要素なし。X 向き |
