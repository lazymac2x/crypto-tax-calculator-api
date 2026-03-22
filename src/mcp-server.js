#!/usr/bin/env node

/**
 * Crypto Tax Calculator — MCP Server (stdio transport)
 *
 * Tools:
 *   calculate_crypto_tax    — Compute capital gains from a trade list
 *   parse_csv_trades        — Parse CSV text into trades + calculate
 *   list_tax_methods        — List supported cost basis methods
 *   annual_tax_summary      — Per-year breakdown comparing all methods
 */

const { calculate, parseCSV, annualSummary, METHODS } = require('./calculator');
const readline = require('readline');

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function jsonrpcResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonrpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

// ---------------------------------------------------------------------------
// MCP Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'calculate_crypto_tax',
    description: 'Calculate capital gains/losses from crypto trades using FIFO, LIFO, or Average Cost basis. Returns per-disposal breakdown with short-term/long-term classification and totals.',
    inputSchema: {
      type: 'object',
      properties: {
        trades: {
          type: 'array',
          description: 'Array of trade objects',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['buy', 'sell'], description: 'Trade type' },
              currency: { type: 'string', description: 'Asset symbol, e.g. BTC, ETH, SOL' },
              amount: { type: 'number', description: 'Quantity traded' },
              price_per_unit: { type: 'number', description: 'USD price per unit at time of trade' },
              date: { type: 'string', description: 'Trade date (ISO 8601 or YYYY-MM-DD)' },
              fee: { type: 'number', description: 'Trading fee in USD (optional)' },
            },
            required: ['type', 'currency', 'amount', 'price_per_unit', 'date'],
          },
        },
        method: {
          type: 'string',
          enum: ['fifo', 'lifo', 'average'],
          description: 'Cost basis method (default: fifo)',
        },
      },
      required: ['trades'],
    },
  },
  {
    name: 'parse_csv_trades',
    description: 'Parse CSV trade history text and calculate crypto taxes. CSV columns: type, currency, amount, price_per_unit, date, fee (optional).',
    inputSchema: {
      type: 'object',
      properties: {
        csv: { type: 'string', description: 'CSV text with header row' },
        method: {
          type: 'string',
          enum: ['fifo', 'lifo', 'average'],
          description: 'Cost basis method (default: fifo)',
        },
      },
      required: ['csv'],
    },
  },
  {
    name: 'list_tax_methods',
    description: 'List all supported cost basis calculation methods with descriptions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'annual_tax_summary',
    description: 'Generate annual tax summary comparing all cost basis methods side by side. Recommends the lowest-tax method.',
    inputSchema: {
      type: 'object',
      properties: {
        trades: {
          type: 'array',
          description: 'Array of trade objects (same format as calculate_crypto_tax)',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['buy', 'sell'] },
              currency: { type: 'string' },
              amount: { type: 'number' },
              price_per_unit: { type: 'number' },
              date: { type: 'string' },
              fee: { type: 'number' },
            },
            required: ['type', 'currency', 'amount', 'price_per_unit', 'date'],
          },
        },
      },
      required: ['trades'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

function executeTool(name, args) {
  switch (name) {
    case 'calculate_crypto_tax': {
      const result = calculate(args.trades, args.method || 'fifo');
      return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    }
    case 'parse_csv_trades': {
      const trades = parseCSV(args.csv);
      const result = calculate(trades, args.method || 'fifo');
      result.parsed_trades = trades.length;
      return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    }
    case 'list_tax_methods': {
      return [{ type: 'text', text: JSON.stringify({
        methods: METHODS,
        descriptions: {
          fifo: 'First In First Out — sells oldest coins first',
          lifo: 'Last In First Out — sells newest coins first',
          average: 'Average Cost — uses weighted average of all purchases',
        },
      }, null, 2) }];
    }
    case 'annual_tax_summary': {
      const summary = annualSummary(args.trades);
      let best = null, lowest = Infinity;
      for (const [m, s] of Object.entries(summary)) {
        if (s.net_gain_loss < lowest) { lowest = s.net_gain_loss; best = m; }
      }
      return [{ type: 'text', text: JSON.stringify({
        methods: summary,
        recommendation: { lowest_tax_method: best, net_gain_loss: lowest },
      }, null, 2) }];
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC message handler
// ---------------------------------------------------------------------------

function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return jsonrpcResponse(id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'crypto-tax-calculator', version: '1.0.0' },
        capabilities: { tools: {} },
      });

    case 'notifications/initialized':
      return null; // no response needed

    case 'tools/list':
      return jsonrpcResponse(id, { tools: TOOLS });

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const content = executeTool(name, args || {});
        return jsonrpcResponse(id, { content });
      } catch (err) {
        return jsonrpcResponse(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      }
    }

    default:
      return jsonrpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// stdio transport
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let buffer = '';

rl.on('line', (line) => {
  buffer += line;
  try {
    const msg = JSON.parse(buffer);
    buffer = '';
    const response = handleMessage(msg);
    if (response) {
      process.stdout.write(response + '\n');
    }
  } catch {
    // Incomplete JSON — keep buffering
  }
});

process.stderr.write('Crypto Tax Calculator MCP server started (stdio)\n');
