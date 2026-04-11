#!/usr/bin/env node
import { BrowserMCPServer } from './server.js';

process.stderr.write('secure-browser-mcp v0.1.0\n');

const server = new BrowserMCPServer();

async function main(): Promise<void> {
  await server.start();
}

async function cleanup(): Promise<void> {
  process.stderr.write('Shutting down secure-browser-mcp...\n');
  await server.stop();
  process.exit(0);
}

process.on('SIGINT', () => {
  cleanup().catch((err: unknown) => {
    process.stderr.write(`Cleanup error: ${String(err)}\n`);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  cleanup().catch((err: unknown) => {
    process.stderr.write(`Cleanup error: ${String(err)}\n`);
    process.exit(1);
  });
});

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  process.exit(1);
});
