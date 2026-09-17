# 映像テロップ校閲システム — 複数運用者版

Google Driveを使わず、ブラウザから複数人で同じ辞書・ルールを共有する無料MVPです。

## 構成

- フロントエンド: 静的HTML / JavaScript
- 共有DB・認証: Supabase Free
- ホスティング: GitHub Pages / Cloudflare Pages など無料枠で可
- AI API: 使わない
- ChatGPT連携: 「AI確認用テキストをコピー」→ ChatGPTへ手動貼付

## 権限

### 管理者
- 校閲
- 全運用ログ閲覧
- 共有辞書の追加・削除
- 運用者の権限変更

### 運用者
- 校閲
- 共有辞書の参照
- 自分の運用ログ閲覧

設定ページは管理者だけが開けます。

## データの扱い

原稿本文はSupabaseへ保存しません。
共有DBに保存する運用ログは以下のみです。

- 日時
- 運用者
- 原稿の行数
- 指摘数

辞書データは全運用者で共有します。

## 初期データ

デフォルト辞書はすべて空です。

## セットアップ

### 1. Supabaseを無料で作成

Supabaseで新規Projectを作成します。

### 2. DBを作成

Supabaseの SQL Editor で `supabase/schema.sql` を全て実行します。

### 3. 接続情報を設定

Supabase Dashboard の Project Settings > API から、

- Project URL
- publishable key

を確認し、`src/config.js` に入力します。

```js
window.APP_CONFIG = {
  supabaseUrl: "https://xxxxx.supabase.co",
  supabasePublishableKey: "xxxxx"
};
```

このキーはブラウザ用の公開キーです。辞書の編集権限などはRLSで保護します。
`service_role` key は絶対にブラウザへ設定しないでください。

### 4. Webサーバーで開く

ローカル試験ならフォルダ内で:

```bash
python3 -m http.server 8080
```

その後 `http://localhost:8080/auth.html` を開きます。

複数人で使う場合はGitHub Pages等へ配置します。

### 5. 最初のアカウント

`auth.html` の「新規登録」から最初に登録したユーザーが自動的に管理者になります。
2人目以降は運用者になります。

メール確認がONの場合は確認メールを完了してください。

### 6. テスト終了後の推奨

必要な運用者アカウントを作成した後は、Supabase Auth設定で新規サインアップを無効化すると安全です。

## 現在の校閲機能

- NG表記・推奨表記
- 登録済み固有名詞
- 類似固有名詞
- 辞書未登録の固有名詞候補
- 字体・フォント注意
- 読み・ルビ注意
- 未登録地名の読み確認
- 正式名称・略称注意
- 確信度 高 / 中 / 低
- 低確信度の強調表示
- CSV出力
- ChatGPT確認用テキスト生成

## 補足

未登録固有名詞や未登録地名は、無料・AI APIなしのヒューリスティック判定です。
正しい読みや正式名称を勝手に生成せず、「確認が必要」とサジェストします。

## 最初の管理者登録で重要なこと

最初に登録したアカウントが管理者になります。
公開URLへ配置する前に、まず自分の管理者アカウントを作成することを推奨します。

管理者画面には「新規登録」のON/OFFを追加しています。
必要な運用者が登録し終わったらOFFにしてください。
停止後は新規アカウント作成をDB側でも拒否します。

## Supabaseキーについて

2026年時点ではブラウザ用途は `publishable key` (`sb_publishable_...`) を使用します。
秘密の `secret key` / 旧 `service_role` はこのアプリには設定しません。

## 接続済みプロジェクト

この配布版は以下のSupabaseプロジェクトへ接続済みです。

- Project URL: `https://pxiogpphwffpcsvlpkyh.supabase.co`
- Project ref: `pxiogpphwffpcsvlpkyh`
- Region: Tokyo (`ap-northeast-1`)
- 辞書初期値: 空
- 新規登録: ON（最初の管理者作成前）

ブラウザにはpublishable keyのみを含めています。secret/service_role keyは含めていません。

DB側にはRLSを設定済みで、Security Advisorの警告は0件です。

## GitHub Pagesへの公開

このアプリはビルド不要の静的サイトです。GitHubリポジトリへ配置した後、

1. GitHub > Settings > Pages
2. Build and deployment: `Deploy from a branch`
3. Branch: `main`
4. Folder: `/(root)`

を選べば公開できます。

公開URLは通常:

`https://<GitHubユーザー名>.github.io/<リポジトリ名>/`

になります。

公開後、最初に `auth.html` を開き、自分の管理者アカウントを作成してください。
必要な運用者を登録したら、管理者画面から「新規登録」を停止してください。
