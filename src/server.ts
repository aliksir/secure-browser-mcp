import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { analyzeDom, clearIndexAttributes } from './dom-analyzer.js';
import { SessionManager } from './session-manager.js';

// Session型にはbrowserContextがないため、サーバー内部でコンテキストを別管理する
interface InternalSession {
  sessionId: string;
  browserContext: BrowserContext;
}

function generateTabId(existing: Set<string> | Map<string, unknown>): string {
  let id: string;
  do {
    id = Math.random().toString(16).slice(2, 6);
  } while (existing.has(id));
  return id;
}

function maskSensitiveText(text: string): string {
  let masked = text;
  masked = masked.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '****-****-****-****');
  masked = masked.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****');
  masked = masked.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '<email>');
  return masked;
}

export class BrowserMCPServer {
  private readonly server: Server;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private currentPage: Page | null = null;
  private readonly tabMap: Map<string, Page> = new Map();
  private readonly pageToTabId: Map<Page, string> = new Map();
  private readonly sessionManager: SessionManager = new SessionManager();
  private readonly contextMap: Map<string, InternalSession> = new Map();
  private currentSessionId: string | null = null;

  constructor() {
    this.server = new Server(
      { name: 'playwright-browser-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'browser_navigate',
            description:
              'Navigate the browser to a URL. Opens a new tab if new_tab=true.',
            inputSchema: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'URL to navigate to' },
                new_tab: {
                  type: 'boolean',
                  description: 'Open in a new tab',
                  default: false,
                },
              },
              required: ['url'],
            },
          },
          {
            name: 'browser_click',
            description:
              'Click an element by index (from browser_get_state) or by coordinates.',
            inputSchema: {
              type: 'object',
              properties: {
                index: {
                  type: 'number',
                  description: 'Element index from browser_get_state',
                },
                x: { type: 'number', description: 'X coordinate' },
                y: { type: 'number', description: 'Y coordinate' },
              },
            },
          },
          {
            name: 'browser_type',
            description:
              'Type text into an element identified by index. Sensitive data is masked in the response.',
            inputSchema: {
              type: 'object',
              properties: {
                index: {
                  type: 'number',
                  description: 'Element index from browser_get_state',
                },
                text: { type: 'string', description: 'Text to type' },
              },
              required: ['index', 'text'],
            },
          },
          {
            name: 'browser_get_state',
            description:
              'Get the current browser state including URL, title, interactive elements, and optionally a screenshot.',
            inputSchema: {
              type: 'object',
              properties: {
                include_screenshot: {
                  type: 'boolean',
                  description: 'Include a screenshot in the response',
                  default: false,
                },
                max_elements: {
                  type: 'number',
                  description: 'Maximum number of interactive elements to return',
                  default: 200,
                },
              },
            },
          },
          {
            name: 'browser_screenshot',
            description: 'Take a screenshot of the current page.',
            inputSchema: {
              type: 'object',
              properties: {
                full_page: {
                  type: 'boolean',
                  description: 'Capture full page (not just viewport)',
                  default: false,
                },
              },
            },
          },
          {
            name: 'browser_scroll',
            description: 'Scroll the page up or down.',
            inputSchema: {
              type: 'object',
              properties: {
                direction: {
                  type: 'string',
                  enum: ['up', 'down'],
                  description: 'Scroll direction',
                },
              },
              required: ['direction'],
            },
          },
          {
            name: 'browser_go_back',
            description: 'Navigate back in browser history.',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'browser_get_html',
            description:
              'Get the HTML content of the page or a specific element.',
            inputSchema: {
              type: 'object',
              properties: {
                selector: {
                  type: 'string',
                  description: 'CSS selector for a specific element (optional)',
                },
              },
            },
          },
          {
            name: 'browser_list_tabs',
            description: 'List all open tabs in the current browser context.',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'browser_switch_tab',
            description: 'Switch to a specific tab by tab_id.',
            inputSchema: {
              type: 'object',
              properties: {
                tab_id: {
                  type: 'string',
                  description: 'Tab ID from browser_list_tabs',
                },
              },
              required: ['tab_id'],
            },
          },
          {
            name: 'browser_close_tab',
            description: 'Close a specific tab by tab_id.',
            inputSchema: {
              type: 'object',
              properties: {
                tab_id: {
                  type: 'string',
                  description: 'Tab ID from browser_list_tabs',
                },
              },
              required: ['tab_id'],
            },
          },
          {
            name: 'browser_list_sessions',
            description: 'List all active browser sessions.',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'browser_close_session',
            description: 'Close a specific browser session by session_id.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: {
                  type: 'string',
                  description: 'Session ID from browser_list_sessions',
                },
              },
              required: ['session_id'],
            },
          },
          {
            name: 'browser_close_all',
            description: 'Close all browser sessions.',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'browser_batch',
            description:
              'Execute multiple browser actions in a single call. Reduces MCP round-trips. Actions run sequentially; stops on first error.',
            inputSchema: {
              type: 'object',
              properties: {
                actions: {
                  type: 'array',
                  description: 'Array of actions to execute sequentially',
                  items: {
                    type: 'object',
                    properties: {
                      tool: {
                        type: 'string',
                        description:
                          'Tool name (e.g. browser_navigate, browser_click, browser_get_state)',
                      },
                      args: {
                        type: 'object',
                        description: 'Arguments for the tool',
                      },
                    },
                    required: ['tool'],
                  },
                },
              },
              required: ['actions'],
            },
          },
          {
            name: 'browser_evaluate',
            description:
              'Execute JavaScript on the current page and return the result. Useful for extracting data or checking page state.',
            inputSchema: {
              type: 'object',
              properties: {
                expression: {
                  type: 'string',
                  description: 'JavaScript expression to evaluate',
                },
              },
              required: ['expression'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const safeArgs = (args ?? {}) as Record<string, unknown>;

      try {
        switch (name) {
          case 'browser_navigate':
            return await this.browserNavigate(safeArgs);
          case 'browser_click':
            return await this.browserClick(safeArgs);
          case 'browser_type':
            return await this.browserType(safeArgs);
          case 'browser_get_state':
            return await this.browserGetState(safeArgs);
          case 'browser_screenshot':
            return await this.browserScreenshot(safeArgs);
          case 'browser_scroll':
            return await this.browserScroll(safeArgs);
          case 'browser_go_back':
            return await this.browserGoBack();
          case 'browser_get_html':
            return await this.browserGetHtml(safeArgs);
          case 'browser_list_tabs':
            return await this.browserListTabs();
          case 'browser_switch_tab':
            return await this.browserSwitchTab(safeArgs);
          case 'browser_close_tab':
            return await this.browserCloseTab(safeArgs);
          case 'browser_list_sessions':
            return this.browserListSessions();
          case 'browser_close_session':
            return await this.browserCloseSession(safeArgs);
          case 'browser_close_all':
            return await this.browserCloseAll();
          case 'browser_batch':
            return await this.browserBatch(safeArgs);
          case 'browser_evaluate':
            return await this.browserEvaluate(safeArgs);
          default:
            return this.textResult(`Error: Unknown tool: ${name}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return this.textResult(`Error: ${message}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // ブラウザ初期化ヘルパー
  // -------------------------------------------------------------------------

  private async ensureBrowser(): Promise<{
    browser: Browser;
    context: BrowserContext;
    page: Page;
  }> {
    if (!this.browser || !this.context || !this.currentPage) {
      // 古いブラウザインスタンスが残っていれば閉じる
      if (this.browser) {
        await this.browser.close().catch(() => undefined);
      }
      this.browser = await chromium.launch({
        headless: process.env['BROWSER_HEADLESS'] !== 'false',
      });
      this.context = await this.browser.newContext();
      this.currentPage = await this.context.newPage();

      const sessionId = generateTabId(this.contextMap);
      this.currentSessionId = sessionId;
      this.sessionManager.createSession(sessionId);
      this.contextMap.set(sessionId, {
        sessionId,
        browserContext: this.context,
      });

      const tabId = generateTabId(this.tabMap);
      this.tabMap.set(tabId, this.currentPage);
      this.pageToTabId.set(this.currentPage, tabId);
    }

    // lazy cleanup of expired sessions
    const expired = this.sessionManager.cleanupExpired();
    for (const id of expired) {
      const session = this.contextMap.get(id);
      if (session) {
        await session.browserContext.close().catch(() => undefined);
        this.contextMap.delete(id);
      }
    }

    return {
      browser: this.browser,
      context: this.context,
      page: this.currentPage,
    };
  }

  private requireActivePage(): Page {
    if (!this.currentPage) {
      throw new Error('No browser session active. Call browser_navigate first.');
    }
    return this.currentPage;
  }

  private findTabId(page: Page): string {
    return this.pageToTabId.get(page) ?? '';
  }

  // -------------------------------------------------------------------------
  // レスポンスヘルパー
  // -------------------------------------------------------------------------

  private textResult(
    text: string,
  ): { content: Array<{ type: string; text: string }> } {
    return { content: [{ type: 'text', text }] };
  }

  private imageResult(
    base64Data: string,
    mimeType: string,
    caption?: string,
  ): {
    content: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
  } {
    const content: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }> = [];
    if (caption) {
      content.push({ type: 'text', text: caption });
    }
    content.push({ type: 'image', data: base64Data, mimeType });
    return { content };
  }

  // -------------------------------------------------------------------------
  // ツール実装
  // -------------------------------------------------------------------------

  private async browserNavigate(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const url = String(args['url'] ?? '');
    const newTab = Boolean(args['new_tab'] ?? false);

    if (!url) {
      return this.textResult('Error: url is required');
    }

    const { context } = await this.ensureBrowser();

    let page: Page;
    if (newTab) {
      page = await context.newPage();
      const tabId = generateTabId(this.tabMap);
      this.tabMap.set(tabId, page);
      this.pageToTabId.set(page, tabId);
      this.currentPage = page;
    } else {
      page = this.currentPage!;
    }

    // 古いindex属性を無効化
    await clearIndexAttributes(page);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('timeout')) {
        return this.textResult(
          'Error: Navigation timeout (30s). URL may be unreachable.',
        );
      }
      throw err;
    }

    // セッションのアクティビティ更新
    if (this.currentSessionId) {
      this.sessionManager.updateActivity(this.currentSessionId);
    }

    const title = await page.title();
    return this.textResult(`Navigated to: ${url}\nTitle: ${title}`);
  }

  private async browserClick(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const page = this.requireActivePage();

    const index =
      args['index'] !== undefined ? Number(args['index']) : undefined;
    const x = args['x'] !== undefined ? Number(args['x']) : undefined;
    const y = args['y'] !== undefined ? Number(args['y']) : undefined;

    if (index !== undefined) {
      const locator = page.locator(`[data-mcp-index="${index}"]`);
      const count = await locator.count();
      if (count === 0) {
        return this.textResult(
          `Error: Element with index ${index} not found. Call browser_get_state to refresh.`,
        );
      }
      await locator.click();
      return this.textResult(`Clicked element at index ${index}`);
    }

    if (x !== undefined && y !== undefined) {
      await page.mouse.click(x, y);
      return this.textResult(`Clicked at coordinates (${x}, ${y})`);
    }

    return this.textResult(
      'Error: Either index or (x, y) coordinates are required',
    );
  }

  private async browserType(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const page = this.requireActivePage();

    const index = Number(args['index'] ?? -1);
    const text = String(args['text'] ?? '');

    const locator = page.locator(`[data-mcp-index="${index}"]`);
    const count = await locator.count();
    if (count === 0) {
      return this.textResult(
        `Error: Element with index ${index} not found. Call browser_get_state to refresh.`,
      );
    }

    const { tagName, isContentEditable } = await locator.evaluate(
      (el: Element) => ({
        tagName: el.tagName.toLowerCase(),
        isContentEditable: el.getAttribute('contenteditable') === 'true',
      }),
    );

    if (isContentEditable) {
      await locator.click();
      await page.keyboard.type(text);
    } else if (tagName === 'input' || tagName === 'textarea') {
      await locator.fill(text);
    } else {
      await locator.click();
      await page.keyboard.type(text);
    }

    const displayText = maskSensitiveText(text);
    return this.textResult(
      `Typed "${displayText}" into element at index ${index}`,
    );
  }

  private async browserGetState(args: Record<string, unknown>): Promise<{
    content: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
  }> {
    const page = this.requireActivePage();

    const includeScreenshot = Boolean(args['include_screenshot'] ?? false);
    const maxElements = Number(args['max_elements'] ?? 200);

    const domResult = await analyzeDom(page, maxElements);

    const tabs = await this.getTabInfoList();

    const stateText = JSON.stringify(
      {
        url: domResult.url,
        title: domResult.title,
        tabs,
        interactive_elements: domResult.elements,
        viewport: domResult.viewport,
        page: domResult.page,
        scroll: domResult.scroll,
        note: 'After DOM changes (e.g., Ajax), call browser_get_state again to refresh element indices.',
      },
      null,
      2,
    );

    const content: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }> = [{ type: 'text', text: stateText }];

    if (includeScreenshot) {
      const screenshotBuffer = await page.screenshot({ fullPage: false });
      const base64 = screenshotBuffer.toString('base64');
      content.push({ type: 'image', data: base64, mimeType: 'image/png' });
    }

    return { content };
  }

  private async browserScreenshot(args: Record<string, unknown>): Promise<{
    content: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
  }> {
    const page = this.requireActivePage();

    const fullPage = Boolean(args['full_page'] ?? false);
    const screenshotBuffer = await page.screenshot({ fullPage });
    const base64 = screenshotBuffer.toString('base64');

    const viewport = page.viewportSize();
    const caption = viewport
      ? `Screenshot (${viewport.width}x${viewport.height}, fullPage=${fullPage})`
      : `Screenshot (fullPage=${fullPage})`;

    return this.imageResult(base64, 'image/png', caption);
  }

  private async browserScroll(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const page = this.requireActivePage();

    const direction = String(args['direction'] ?? 'down');
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const scrollAmount = viewportHeight * 0.8;

    await page.mouse.wheel(
      0,
      direction === 'down' ? scrollAmount : -scrollAmount,
    );

    return this.textResult(
      `Scrolled ${direction} by ${Math.round(scrollAmount)}px (80% of viewport)`,
    );
  }

  private async browserGoBack(): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    const page = this.requireActivePage();

    await page.goBack({ waitUntil: 'domcontentloaded' });
    const title = await page.title();
    return this.textResult(
      `Navigated back. Current page: ${page.url()}\nTitle: ${title}`,
    );
  }

  private async browserGetHtml(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const page = this.requireActivePage();

    const selector =
      args['selector'] !== undefined ? String(args['selector']) : undefined;

    if (selector) {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count === 0) {
        return this.textResult(
          `Error: No element found for selector: ${selector}`,
        );
      }
      const html = await locator.innerHTML();
      return this.textResult(html);
    }

    const html = await page.content();
    return this.textResult(html);
  }

  private async getTabInfoList(): Promise<
    Array<{ tab_id: string; url: string; title: string; active?: boolean }>
  > {
    if (!this.context) return [];
    const pages = this.context.pages();

    // sync: register new pages, remove closed pages
    const livePages = new Set(pages);
    for (const [id, p] of this.tabMap) {
      if (!livePages.has(p)) {
        this.tabMap.delete(id);
        this.pageToTabId.delete(p);
      }
    }
    for (const p of pages) {
      if (!this.pageToTabId.has(p)) {
        const newId = generateTabId(this.tabMap);
        this.tabMap.set(newId, p);
        this.pageToTabId.set(p, newId);
      }
    }

    return Promise.all(
      pages.map(async (p) => {
        const title = await p.title().catch(() => '');
        return {
          tab_id: this.findTabId(p),
          url: p.url(),
          title,
          active: p === this.currentPage,
        };
      }),
    );
  }

  private async browserListTabs(): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    if (!this.context) {
      return this.textResult(
        'Error: No browser session active. Call browser_navigate first.',
      );
    }
    const tabs = await this.getTabInfoList();
    return this.textResult(JSON.stringify(tabs, null, 2));
  }

  private async browserSwitchTab(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const tabId = String(args['tab_id'] ?? '');
    const page = this.tabMap.get(tabId);

    if (!page) {
      return this.textResult(
        `Error: Tab with id "${tabId}" not found. Call browser_list_tabs to refresh.`,
      );
    }

    await page.bringToFront();
    this.currentPage = page;

    const title = await page.title();
    return this.textResult(
      `Switched to tab ${tabId}: ${page.url()}\nTitle: ${title}`,
    );
  }

  private async browserCloseTab(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const tabId = String(args['tab_id'] ?? '');
    const page = this.tabMap.get(tabId);

    if (!page) {
      return this.textResult(
        `Error: Tab with id "${tabId}" not found. Call browser_list_tabs to refresh.`,
      );
    }

    await page.close();
    this.tabMap.delete(tabId);
    this.pageToTabId.delete(page);

    // 閉じたページが現在のページだった場合、残りのページに切り替え
    if (this.currentPage === page && this.context) {
      const remaining = this.context.pages();
      this.currentPage =
        remaining.length > 0
          ? (remaining[remaining.length - 1] ?? null)
          : null;
    }

    return this.textResult(`Closed tab ${tabId}`);
  }

  private browserListSessions(): {
    content: Array<{ type: string; text: string }>;
  } {
    const sessions = this.sessionManager.listSessions();
    return this.textResult(JSON.stringify(sessions, null, 2));
  }

  private async browserCloseSession(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const sessionId = String(args['session_id'] ?? '');
    const internalSession = this.contextMap.get(sessionId);

    if (!internalSession) {
      return this.textResult(
        `Error: Session "${sessionId}" not found. Call browser_list_sessions to refresh.`,
      );
    }

    await internalSession.browserContext.close();
    this.contextMap.delete(sessionId);
    this.sessionManager.removeSession(sessionId);

    if (this.context === internalSession.browserContext) {
      this.context = null;
      this.currentPage = null;
      this.browser = null;
      this.currentSessionId = null;
      this.tabMap.clear();
      this.pageToTabId.clear();
    }

    return this.textResult(`Closed session ${sessionId}`);
  }

  private async browserCloseAll(): Promise<{
    content: Array<{ type: string; text: string }>;
  }> {
    const sessionCount = this.contextMap.size;

    for (const [sessionId, internalSession] of this.contextMap.entries()) {
      await internalSession.browserContext.close().catch(() => undefined);
      this.sessionManager.removeSession(sessionId);
    }
    this.contextMap.clear();

    if (this.browser) {
      await this.browser.close().catch(() => undefined);
    }

    this.browser = null;
    this.context = null;
    this.currentPage = null;
    this.currentSessionId = null;
    this.tabMap.clear();
    this.pageToTabId.clear();

    return this.textResult(`Closed all sessions (${sessionCount} total)`);
  }

  // -------------------------------------------------------------------------
  // バッチ操作・JS実行
  // -------------------------------------------------------------------------

  /** Tools allowed inside browser_batch (destructive/session tools excluded) */
  private static readonly BATCH_ALLOWED_TOOLS = new Set([
    'browser_navigate',
    'browser_click',
    'browser_type',
    'browser_get_state',
    'browser_screenshot',
    'browser_scroll',
    'browser_go_back',
    'browser_get_html',
    'browser_list_tabs',
    'browser_switch_tab',
    'browser_evaluate',
  ]);

  private async browserBatch(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
    const actions = args['actions'];
    if (!Array.isArray(actions) || actions.length === 0) {
      return this.textResult('Error: actions array is required and must not be empty');
    }

    const results: Array<{ tool: string; success: boolean; result: unknown }> = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i] as Record<string, unknown>;
      const tool = String(action['tool'] ?? '');
      const toolArgs = (action['args'] ?? {}) as Record<string, unknown>;

      if (!BrowserMCPServer.BATCH_ALLOWED_TOOLS.has(tool)) {
        results.push({
          tool,
          success: false,
          result: `Error: Tool "${tool}" is not allowed in batch. Allowed: ${[...BrowserMCPServer.BATCH_ALLOWED_TOOLS].join(', ')}`,
        });
        break;
      }

      try {
        let toolResult: { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };

        switch (tool) {
          case 'browser_navigate':
            toolResult = await this.browserNavigate(toolArgs);
            break;
          case 'browser_click':
            toolResult = await this.browserClick(toolArgs);
            break;
          case 'browser_type':
            toolResult = await this.browserType(toolArgs);
            break;
          case 'browser_get_state':
            toolResult = await this.browserGetState(toolArgs);
            break;
          case 'browser_screenshot':
            toolResult = await this.browserScreenshot(toolArgs);
            break;
          case 'browser_scroll':
            toolResult = await this.browserScroll(toolArgs);
            break;
          case 'browser_go_back':
            toolResult = await this.browserGoBack();
            break;
          case 'browser_get_html':
            toolResult = await this.browserGetHtml(toolArgs);
            break;
          case 'browser_list_tabs':
            toolResult = await this.browserListTabs();
            break;
          case 'browser_switch_tab':
            toolResult = await this.browserSwitchTab(toolArgs);
            break;
          case 'browser_evaluate':
            toolResult = await this.browserEvaluate(toolArgs);
            break;
          default:
            toolResult = this.textResult(`Error: Unknown tool: ${tool}`);
        }

        const textContent = toolResult.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        const hasError = textContent.startsWith('Error:');

        results.push({ tool, success: !hasError, result: textContent });

        if (hasError) break;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ tool, success: false, result: `Error: ${message}` });
        break;
      }
    }

    const summary = results
      .map((r, i) => `[${i + 1}] ${r.tool}: ${r.success ? '✅' : '❌'} ${r.result}`)
      .join('\n');

    return this.textResult(
      `Batch: ${results.length}/${actions.length} actions executed\n\n${summary}`,
    );
  }

  private async browserEvaluate(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const page = this.requireActivePage();
    const expression = String(args['expression'] ?? '');

    if (!expression) {
      return this.textResult('Error: expression is required');
    }

    try {
      const result = await page.evaluate((expr: string) => {
        // eslint-disable-next-line no-eval
        const value = eval(expr);
        if (value === undefined) return 'undefined';
        if (value === null) return 'null';
        if (typeof value === 'object') return JSON.stringify(value, null, 2);
        return String(value);
      }, expression);

      const maskedResult = maskSensitiveText(String(result));
      return this.textResult(maskedResult);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return this.textResult(`Error: ${message}`);
    }
  }

  // -------------------------------------------------------------------------
  // サーバーライフサイクル
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    process.stderr.write('playwright-browser-mcp server started\n');
  }

  async stop(): Promise<void> {
    await this.browserCloseAll();
    await this.server.close();
  }
}
