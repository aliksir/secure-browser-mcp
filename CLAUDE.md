# playwright-browser-mcp

外部通信ゼロ・テレメトリなしのブラウザ自動化MCPサーバー。Playwrightベースで完全ローカル動作し、Claude CodeからMCPサーバーとして接続してヘッドレス/ヘッドフルのブラウザ操作を提供する。

## 技術スタック
- Node.js + TypeScript
- Playwright（ブラウザ自動化）
- @modelcontextprotocol/sdk（MCPサーバー）

## セットアップ
```bash
npm install
```

Playwrightブラウザのインストール（初回のみ）:
```bash
npx playwright install chromium
```

## ビルド
```bash
npm run build
```

開発時（TypeScriptウォッチモード）:
```bash
npm run dev
```

## テスト
該当なし（自動テストなし）

## 開発規約
- 外部サーバーへの通信を一切行わない（テレメトリ・クラウド同期・分析なし）
- LLMのAPIキー不要（Claude Code自体が判断するため）
- Python依存なし（Node.js のみで完結）
- npm公開名は `secure-browser-mcp`（GitHubリポジトリ名も同じ）、ローカルフォルダ名は `playwright-browser-mcp`
- npmの同名パッケージ `playwright-browser-mcp@1.0.0` は別人（npm 上の別作者）のもの。混同注意
