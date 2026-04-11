<p align="center"><img src="logo.png" width="120" alt="logo"></p>

# Crypto Tax Calculator API

> ⭐ **Building in public from $0 MRR.** Star if you want to follow the journey — [lazymac-mcp](https://github.com/lazymac2x/lazymac-mcp) (42 tools, one MCP install) · [lazymac-k-mcp](https://github.com/lazymac2x/lazymac-k-mcp) (Korean wedge) · [lazymac-sdk](https://github.com/lazymac2x/lazymac-sdk) (TS client) · [api.lazy-mac.com](https://api.lazy-mac.com) · [Pro $29/mo](https://coindany.gumroad.com/l/zlewvz).

[![npm](https://img.shields.io/npm/v/@lazymac/mcp.svg?label=%40lazymac%2Fmcp&color=orange)](https://www.npmjs.com/package/@lazymac/mcp)
[![Smithery](https://img.shields.io/badge/Smithery-lazymac%2Fmcp-orange)](https://smithery.ai/server/lazymac/mcp)
[![lazymac Pro](https://img.shields.io/badge/lazymac%20Pro-%2429%2Fmo-ff6b35)](https://coindany.gumroad.com/l/zlewvz)
[![api.lazy-mac.com](https://img.shields.io/badge/REST-api.lazy--mac.com-orange)](https://api.lazy-mac.com)

> 🚀 Want all 42 lazymac tools through ONE MCP install? `npx -y @lazymac/mcp` · [Pro $29/mo](https://coindany.gumroad.com/l/zlewvz) for unlimited calls.

Premium crypto tax calculation engine — REST API + MCP server.

Calculate capital gains/losses with **FIFO**, **LIFO**, and **Average Cost** basis methods.
Automatic short-term vs long-term classification (365-day threshold).
Supports any cryptocurrency (BTC, ETH, SOL, ADA, etc.).

## Quick Start

```bash
npm install
npm start          # REST API on port 5300
npm run mcp        # MCP server (stdio)
```

## API Endpoints

### `GET /api/v1/methods`
List supported cost basis methods and CSV format.

### `POST /api/v1/calculate`
Calculate taxes from a trade list.

```json
{
  "method": "fifo",
  "trades": [
    { "type": "buy",  "currency": "BTC", "amount": 1.0,  "price_per_unit": 30000, "date": "2025-01-15", "fee": 5 },
    { "type": "sell", "currency": "BTC", "amount": 0.5,  "price_per_unit": 45000, "date": "2025-08-20", "fee": 5 }
  ]
}
```

### `POST /api/v1/csv`
Parse CSV trade history and calculate.

```
type,currency,amount,price_per_unit,date,fee
buy,BTC,1.0,30000,2025-01-15,5
sell,BTC,0.5,45000,2025-08-20,5
```

### `POST /api/v1/summary`
Annual tax summary comparing all methods side by side with lowest-tax recommendation.

## MCP Tools

| Tool | Description |
|------|-------------|
| `calculate_crypto_tax` | Calculate gains/losses from trade array |
| `parse_csv_trades` | Parse CSV + calculate |
| `list_tax_methods` | List available methods |
| `annual_tax_summary` | Per-year multi-method comparison |

## Docker

```bash
docker build -t crypto-tax-calculator .
docker run -p 5300:5300 crypto-tax-calculator
```

## Features

- FIFO, LIFO, Average Cost basis methods
- Short-term vs long-term capital gains (365-day threshold)
- Per-disposal breakdown with cost basis, proceeds, gain/loss
- Annual summary by year and by currency
- Lowest-tax method recommendation
- CSV import with flexible column mapping
- Fee-aware calculations
- 8 decimal place precision (crypto-grade)

## License

MIT

<sub>💡 Host your own stack? <a href="https://m.do.co/c/c8c07a9d3273">Get $200 DigitalOcean credit</a> via lazymac referral link.</sub>
