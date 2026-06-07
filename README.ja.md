# secure-browser-mcp

[English](README.md) | 日本語

**セキュリティ最優先のブラウザ自動化MCPサーバー。** [Playwright](https://playwright.dev/)ベース、厳格なローカル専用ポリシー。

## セキュリティ機能

| 機能 | 詳細 |
|------|------|
| **テレメトリゼロ** | データは一切外部に送信されない。PostHog・アナリティクス・クラウド同期なし |
| **機密データマスキング** | クレジットカード番号、SSN、メールアドレスを全ツールレスポンスで自動マスク |
| **外部通信なし** | サーバーは一切外部に接続しない。エアギャップ環境でも動作可能 |
| **LLM非依存** | APIキー不要、AI呼び出しなし。MCPクライアントが推論を担当 |
| **Python不要** | 純粋なNode.js。Pythonランタイム・pip・venv不要 |

## @playwright/mcp との違い

| | secure-browser-mcp | @playwright/mcp |
|---|---|---|
| テレメトリ | なし | なし* |
| 機密データマスキング | 内蔵（CC・SSN・email） | なし |
| 外部通信 | ゼロ | 設定次第 |
| DOM要素の安定性 | `data-mcp-index`（CSS非依存） | アクセシビリティスナップショット |

\* @playwright/mcp自体にテレメトリはないが、LLMに渡されるレスポンス内の機密データをマスクする機能はない。

## 動作要件

- Node.js 18+
- Chromium（`npx playwright install chromium` でインストール）

## クイックスタート

### インストール

```bash
git clone https://github.com/aliksir/secure-browser-mcp.git
cd secure-browser-mcp
npm install
npx playwright install chromium
npm run build
```

### 設定

Claude CodeのMCP設定（`~/.claude/settings.json`）に追加：

```json
{
  "mcpServers": {
    "secure-browser": {
      "command": "node",
      "args": ["/path/to/secure-browser-mcp/dist/index.js"],
      "env": {
        "BROWSER_HEADLESS": "true"
      }
    }
  }
}
```

`BROWSER_HEADLESS`を`"false"`にするとブラウザウィンドウが表示される。

## 利用可能なツール

| ツール | 説明 |
|--------|------|
| `browser_navigate` | URLに移動（`new_tab`で新規タブ対応） |
| `browser_get_state` | インデックス付きインタラクティブ要素を含むページ状態を取得 |
| `browser_click` | 要素インデックスまたは座標でクリック |
| `browser_type` | インデックス指定の要素にテキスト入力（機密データ自動マスク） |
| `browser_screenshot` | スクリーンショット取得（ビューポートまたはフルページ） |
| `browser_scroll` | 上下スクロール（ビューポートの80%分） |
| `browser_go_back` | 履歴を戻る |
| `browser_get_html` | HTML取得（フルページまたはCSSセレクタ指定） |
| `browser_list_tabs` | 開いているタブ一覧 |
| `browser_switch_tab` | タブIDで切替 |
| `browser_close_tab` | タブIDで閉じる |
| `browser_list_sessions` | アクティブなセッション一覧 |
| `browser_close_session` | セッションを閉じる |
| `browser_close_all` | 全セッション・ブラウザを閉じる |

## マスキングの仕組み

`browser_type`や`browser_get_state`がテキストを処理する際、MCPクライアントにレスポンスが届く前にパターンが自動置換される：

| パターン | マスク結果 |
|---------|-----------|
| `4111 2222 3333 4444` | `****-****-****-****` |
| `123-45-6789`（SSN） | `***-**-****` |
| `user@example.com` | `<email>` |

LLMのコンテキストウィンドウに機密データが送信されることを防ぐ。

## 設計方針

- **外部通信ゼロ** — テレメトリ・クラウド同期・アナリティクスなし。全てローカル完結
- **LLM非依存** — このサーバーはAI APIを呼ばない。MCPクライアントが推論を担当
- **遅延セッションクリーンアップ** — 30分の非アクティブでセッション期限切れ（バックグラウンドタイマーなし）
- **ビューポート優先インデックス** — 現在表示中の要素を優先してインデックスを付与
- **`data-mcp-index` > CSSセレクタ** — DOM変更に強い注入属性方式

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `BROWSER_HEADLESS` | `true` | `false`でブラウザウィンドウを表示 |

## ライセンス

MIT
