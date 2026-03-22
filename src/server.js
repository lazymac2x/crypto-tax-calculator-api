const express = require('express');
const cors = require('cors');
const { calculate, parseCSV, annualSummary, METHODS } = require('./calculator');

const app = express();
const PORT = process.env.PORT || 5300;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/csv', limit: '10mb' }));

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/', (_req, res) => {
  res.json({
    name: 'crypto-tax-calculator-api',
    version: '1.0.0',
    description: 'Premium crypto tax calculation — FIFO, LIFO, Average Cost basis',
    endpoints: [
      'POST /api/v1/calculate',
      'POST /api/v1/csv',
      'GET  /api/v1/methods',
      'POST /api/v1/summary',
    ],
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/methods — List supported cost basis methods
// ---------------------------------------------------------------------------

app.get('/api/v1/methods', (_req, res) => {
  res.json({
    methods: METHODS.map(m => ({
      id: m,
      name: m === 'fifo' ? 'First In First Out' : m === 'lifo' ? 'Last In First Out' : 'Average Cost',
      description: m === 'fifo'
        ? 'Sells the oldest purchased coins first. Most common method, required by many tax jurisdictions.'
        : m === 'lifo'
          ? 'Sells the most recently purchased coins first. Can minimize short-term gains in rising markets.'
          : 'Uses the weighted average cost of all holdings. Simpler but may not be accepted in all jurisdictions.',
    })),
    supported_currencies: 'Any — BTC, ETH, SOL, ADA, DOT, AVAX, MATIC, etc.',
    csv_format: {
      columns: 'type,currency,amount,price_per_unit,date,fee',
      example: 'buy,BTC,0.5,30000,2025-01-15,5.00',
      notes: 'fee column is optional. date accepts ISO 8601 or YYYY-MM-DD.',
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/calculate — Calculate taxes from trade list
// ---------------------------------------------------------------------------

app.post('/api/v1/calculate', (req, res) => {
  try {
    const { trades, method = 'fifo' } = req.body;

    if (!trades) {
      return res.status(400).json({ error: 'Missing "trades" array in request body' });
    }

    const result = calculate(trades, method);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/csv — Parse CSV and calculate
// ---------------------------------------------------------------------------

app.post('/api/v1/csv', (req, res) => {
  try {
    let csvText;
    let method = 'fifo';

    if (typeof req.body === 'string') {
      // Content-Type: text/csv
      csvText = req.body;
      method = req.query.method || 'fifo';
    } else {
      // Content-Type: application/json with { csv, method }
      csvText = req.body.csv;
      method = req.body.method || 'fifo';
    }

    if (!csvText) {
      return res.status(400).json({ error: 'Missing CSV data. Send as text/csv body or JSON { "csv": "...", "method": "fifo" }' });
    }

    const trades = parseCSV(csvText);
    const result = calculate(trades, method);
    result.parsed_trades = trades.length;
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/summary — Annual tax summary (all methods compared)
// ---------------------------------------------------------------------------

app.post('/api/v1/summary', (req, res) => {
  try {
    const { trades } = req.body;

    if (!trades) {
      return res.status(400).json({ error: 'Missing "trades" array in request body' });
    }

    // Validate quickly by running calculate with fifo
    calculate([...trades.map(t => ({ ...t }))], 'fifo');

    const summary = annualSummary(trades);
    res.json({
      description: 'Annual tax summary comparing all cost basis methods',
      methods: summary,
      recommendation: pickBestMethod(summary),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function pickBestMethod(summary) {
  let best = null;
  let lowestTax = Infinity;
  for (const [method, s] of Object.entries(summary)) {
    if (s.net_gain_loss < lowestTax) {
      lowestTax = s.net_gain_loss;
      best = method;
    }
  }
  return {
    lowest_tax_method: best,
    net_gain_loss: lowestTax,
    note: 'This is the method that results in the lowest taxable gain. Consult a tax professional before choosing.',
  };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Crypto Tax Calculator API running on http://localhost:${PORT}`);
});

module.exports = app;
