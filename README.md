# 犯人は踊る Family Browser Edition — Ver.0.1

家族のスマホ・タブレットから、**インストールなし**で参加できるブラウザ版の土台です。

## Ver.0.1で動くもの

- 端末ごとの匿名セッション（ログイン画面なし）
- 4桁ルーム番号の発行
- QRコード参加
- 3〜8人の待機室
- ホストだけがゲーム開始
- 人数×4枚を自動選択・シャッフル・配札
- 第一発見者を持つ人を開始プレイヤーに設定
- **各端末には自分の手札しかSELECTできないRLS**
- カード画像32枚をWebP化（合計 約2.5MB）
- カード画像はService Workerで一度表示したものを端末キャッシュ
- PWAマニフェストあり（ホーム画面追加は任意。必須ではありません）

## 重要：現在のカード選択ルール

Ver.0.1では家族テストを早く始めるため、常に以下5枚を入れ、残りを32枚からランダム選択します。

- 犯人
- 第一発見者
- 探偵 1枚
- アリバイ 1枚
- たくらみ 1枚

合計枚数は常に `人数 × 4` です。公式の「人数別おすすめ構成」へ合わせる場合は、次版でプリセット化します。

## セットアップ

### 1. Supabase

1. SupabaseでFreeプロジェクトを作成
2. **Authentication > Providers > Anonymous Sign-Ins** を有効化
3. SQL Editorを開き、`supabase/schema.sql` を全文実行
4. Project URL と Publishable Key を確認

Supabaseの匿名サインインは、メールアドレス等を入力させずに各端末へ認証済みユーザーセッションを作る機能です。RLSと組み合わせて手札を分離します。

### 2. ローカル環境

```bash
cp .env.example .env.local
```

`.env.local` を編集：

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
```

次に：

```bash
npm install
npm run dev
```

http://localhost:3000 を開きます。

### 3. Vercel

GitHubへこのフォルダをPushし、VercelでImportします。
Environment Variables に上記2項目を設定してDeployします。

## 家族でのテスト方法

1. 1台目で「新しい部屋を作る」
2. 待機室のQRコードを家族の端末で読む
3. 名前を入力して参加
4. 3人以上になったらホストが「ゲーム開始」
5. 各端末に4枚だけ表示されることを確認
6. 第一発見者を持つ端末に「あなたからスタート」と出ることを確認

## 通信量について

カード画像32枚は元写真（約200MB超）をWeb用に切り出し・圧縮し、合計約2.5MBにしています。
さらに `/cards/` はService Workerのcache-first対象です。

ゲーム状態はSupabaseへカード画像を送らず、`culprit-01` のようなカードIDだけを送受信します。

## セキュリティ設計

- UI上で隠すだけではなく、DBのRLSで他人の `hands` 行をSELECT不可
- ルーム作成・参加・開始は直接INSERTではなく、チェック付きRPCのみ
- Service Role Keyはフロントエンドに置かない
- Publishable Keyだけを使用

## 次に実装するもの（Ver.0.2）

- カードをタップして使用
- 手番の時計回り進行
- 一般人 / 目撃者 / 取り引き
- 情報操作 / うわさ（全員同時選択）
- 少年（本人だけ犯人所在地表示）
- 探偵 / アリバイ判定
- いぬ
- 犯人勝利 / たくらみ陣営
- ゲーム終了演出と犯人カードの移動履歴
