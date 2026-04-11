/**
 * 共通型定義
 * secure-browser-mcp の全モジュールで使用する型
 */

/** インタラクティブ要素の情報 */
export interface ElementInfo {
  /** data-mcp-index で付与された連番インデックス */
  index: number;
  /** タグ名（小文字）: a, button, input, select, textarea 等 */
  tag: string;
  /** textContent（100文字まで）または aria-label */
  text: string;
  /** placeholder 属性（input/textarea） */
  placeholder?: string;
  /** href 属性（a タグ） */
  href?: string;
  /** type 属性（input タグ）: text, checkbox, radio, submit 等 */
  type?: string;
  /** value 属性（input/select/textarea） */
  value?: string;
  /** checked 状態（checkbox/radio） */
  checked?: boolean;
  /** disabled 属性 */
  disabled?: boolean;
  /** contenteditable="true" の要素か */
  isContentEditable?: boolean;
}

/** ビューポートサイズ */
export interface ViewportInfo {
  /** ビューポート幅（px） */
  width: number;
  /** ビューポート高さ（px） */
  height: number;
}

/** ページ全体のサイズ */
export interface PageInfo {
  /** ページ幅（px） */
  width: number;
  /** ページ高さ（px） */
  height: number;
}

/** スクロール位置 */
export interface ScrollInfo {
  /** 水平スクロール量（px） */
  x: number;
  /** 垂直スクロール量（px） */
  y: number;
}

/** セッション情報 */
export interface Session {
  /** セッション識別子 */
  id: string;
  /** セッション作成日時（Unix ms） */
  created_at: number;
  /** 最終アクティビティ日時（Unix ms） */
  last_activity: number;
}
