/**
 * Crypto Tax Calculator — Core Engine
 *
 * Supports FIFO, LIFO, and Average Cost basis methods.
 * Handles short-term vs long-term capital gains (365-day threshold).
 * Accurate to the cent — built for production use.
 */

const METHODS = ['fifo', 'lifo', 'average'];
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// CSV Parsing
// ---------------------------------------------------------------------------

/**
 * Parse CSV text into an array of trade objects.
 * Expected columns (case-insensitive, trimmed):
 *   type, currency, amount, price_per_unit, date
 *
 * price_per_unit is in USD.
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error('CSV must contain a header row and at least one data row');
  }

  const rawHeaders = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

  // Map common header variations
  const headerMap = {
    type: ['type', 'side', 'action', 'trade_type'],
    currency: ['currency', 'symbol', 'asset', 'coin', 'token'],
    amount: ['amount', 'quantity', 'qty', 'size', 'volume'],
    price_per_unit: ['price_per_unit', 'price', 'unit_price', 'cost', 'rate'],
    date: ['date', 'datetime', 'timestamp', 'time', 'trade_date'],
    fee: ['fee', 'commission', 'fees'],
  };

  function findIndex(aliases) {
    for (const alias of aliases) {
      const idx = rawHeaders.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  const idx = {};
  for (const [key, aliases] of Object.entries(headerMap)) {
    idx[key] = findIndex(aliases);
  }

  if (idx.type === -1) throw new Error('CSV missing required column: type (buy/sell)');
  if (idx.currency === -1) throw new Error('CSV missing required column: currency');
  if (idx.amount === -1) throw new Error('CSV missing required column: amount');
  if (idx.price_per_unit === -1) throw new Error('CSV missing required column: price_per_unit');
  if (idx.date === -1) throw new Error('CSV missing required column: date');

  const trades = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map(c => c.trim());
    const type = cols[idx.type].toLowerCase();
    if (type !== 'buy' && type !== 'sell') {
      throw new Error(`Row ${i + 1}: type must be "buy" or "sell", got "${cols[idx.type]}"`);
    }

    const amount = parseFloat(cols[idx.amount]);
    const price = parseFloat(cols[idx.price_per_unit]);
    const date = cols[idx.date];
    const fee = idx.fee !== -1 ? parseFloat(cols[idx.fee] || '0') : 0;

    if (isNaN(amount) || amount <= 0) throw new Error(`Row ${i + 1}: invalid amount "${cols[idx.amount]}"`);
    if (isNaN(price) || price < 0) throw new Error(`Row ${i + 1}: invalid price "${cols[idx.price_per_unit]}"`);
    if (isNaN(new Date(date).getTime())) throw new Error(`Row ${i + 1}: invalid date "${date}"`);

    trades.push({
      type,
      currency: cols[idx.currency].toUpperCase(),
      amount,
      price_per_unit: price,
      date,
      fee: isNaN(fee) ? 0 : fee,
    });
  }

  return trades;
}

// ---------------------------------------------------------------------------
// Sort trades chronologically
// ---------------------------------------------------------------------------

function sortTrades(trades) {
  return [...trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ---------------------------------------------------------------------------
// FIFO Cost Basis
// ---------------------------------------------------------------------------

function calculateFIFO(trades) {
  const sorted = sortTrades(trades);
  // Per-currency buy lot queues: { BTC: [ { amount, price_per_unit, date, fee_per_unit } ] }
  const lots = {};
  const disposals = [];

  for (const trade of sorted) {
    const cur = trade.currency;
    if (!lots[cur]) lots[cur] = [];

    if (trade.type === 'buy') {
      lots[cur].push({
        remaining: trade.amount,
        price_per_unit: trade.price_per_unit,
        date: trade.date,
        fee_per_unit: (trade.fee || 0) / trade.amount,
      });
    } else {
      // sell
      let remaining = trade.amount;
      const sellDate = new Date(trade.date);
      const sellPrice = trade.price_per_unit;
      const sellFeePerUnit = (trade.fee || 0) / trade.amount;

      while (remaining > 0 && lots[cur].length > 0) {
        const lot = lots[cur][0]; // FIFO — take from front
        const used = Math.min(remaining, lot.remaining);
        const costBasis = round(used * (lot.price_per_unit + lot.fee_per_unit));
        const proceeds = round(used * (sellPrice - sellFeePerUnit));
        const gainLoss = round(proceeds - costBasis);
        const buyDate = new Date(lot.date);
        const holdingMs = sellDate.getTime() - buyDate.getTime();
        const isLongTerm = holdingMs >= ONE_YEAR_MS;

        disposals.push({
          currency: cur,
          amount: round(used),
          buy_date: lot.date,
          sell_date: trade.date,
          cost_basis: costBasis,
          proceeds,
          gain_loss: gainLoss,
          holding_period_days: Math.floor(holdingMs / (24 * 60 * 60 * 1000)),
          term: isLongTerm ? 'long-term' : 'short-term',
        });

        lot.remaining = round(lot.remaining - used);
        remaining = round(remaining - used);

        if (lot.remaining <= 0) {
          lots[cur].shift();
        }
      }

      if (remaining > 0) {
        disposals.push({
          currency: cur,
          amount: round(remaining),
          buy_date: null,
          sell_date: trade.date,
          cost_basis: 0,
          proceeds: round(remaining * (sellPrice - sellFeePerUnit)),
          gain_loss: round(remaining * (sellPrice - sellFeePerUnit)),
          holding_period_days: null,
          term: 'unknown (no matching buy lot)',
          warning: `No remaining buy lots for ${remaining} ${cur}`,
        });
      }
    }
  }

  return disposals;
}

// ---------------------------------------------------------------------------
// LIFO Cost Basis
// ---------------------------------------------------------------------------

function calculateLIFO(trades) {
  const sorted = sortTrades(trades);
  const lots = {};
  const disposals = [];

  for (const trade of sorted) {
    const cur = trade.currency;
    if (!lots[cur]) lots[cur] = [];

    if (trade.type === 'buy') {
      lots[cur].push({
        remaining: trade.amount,
        price_per_unit: trade.price_per_unit,
        date: trade.date,
        fee_per_unit: (trade.fee || 0) / trade.amount,
      });
    } else {
      let remaining = trade.amount;
      const sellDate = new Date(trade.date);
      const sellPrice = trade.price_per_unit;
      const sellFeePerUnit = (trade.fee || 0) / trade.amount;

      while (remaining > 0 && lots[cur].length > 0) {
        const lot = lots[cur][lots[cur].length - 1]; // LIFO — take from back
        const used = Math.min(remaining, lot.remaining);
        const costBasis = round(used * (lot.price_per_unit + lot.fee_per_unit));
        const proceeds = round(used * (sellPrice - sellFeePerUnit));
        const gainLoss = round(proceeds - costBasis);
        const buyDate = new Date(lot.date);
        const holdingMs = sellDate.getTime() - buyDate.getTime();
        const isLongTerm = holdingMs >= ONE_YEAR_MS;

        disposals.push({
          currency: cur,
          amount: round(used),
          buy_date: lot.date,
          sell_date: trade.date,
          cost_basis: costBasis,
          proceeds,
          gain_loss: gainLoss,
          holding_period_days: Math.floor(holdingMs / (24 * 60 * 60 * 1000)),
          term: isLongTerm ? 'long-term' : 'short-term',
        });

        lot.remaining = round(lot.remaining - used);
        remaining = round(remaining - used);

        if (lot.remaining <= 0) {
          lots[cur].pop();
        }
      }

      if (remaining > 0) {
        disposals.push({
          currency: cur,
          amount: round(remaining),
          buy_date: null,
          sell_date: trade.date,
          cost_basis: 0,
          proceeds: round(remaining * (sellPrice - sellFeePerUnit)),
          gain_loss: round(remaining * (sellPrice - sellFeePerUnit)),
          holding_period_days: null,
          term: 'unknown (no matching buy lot)',
          warning: `No remaining buy lots for ${remaining} ${cur}`,
        });
      }
    }
  }

  return disposals;
}

// ---------------------------------------------------------------------------
// Average Cost Basis
// ---------------------------------------------------------------------------

function calculateAverage(trades) {
  const sorted = sortTrades(trades);
  // Track weighted average cost per currency
  const pool = {}; // { BTC: { total_amount, total_cost } }
  const disposals = [];

  for (const trade of sorted) {
    const cur = trade.currency;
    if (!pool[cur]) pool[cur] = { total_amount: 0, total_cost: 0, buys: [] };

    if (trade.type === 'buy') {
      const cost = trade.amount * trade.price_per_unit + (trade.fee || 0);
      pool[cur].total_amount = round(pool[cur].total_amount + trade.amount);
      pool[cur].total_cost = round(pool[cur].total_cost + cost);
      pool[cur].buys.push({ date: trade.date, amount: trade.amount });
    } else {
      const p = pool[cur];
      if (p.total_amount <= 0) {
        disposals.push({
          currency: cur,
          amount: trade.amount,
          buy_date: null,
          sell_date: trade.date,
          cost_basis: 0,
          proceeds: round(trade.amount * trade.price_per_unit - (trade.fee || 0)),
          gain_loss: round(trade.amount * trade.price_per_unit - (trade.fee || 0)),
          holding_period_days: null,
          term: 'unknown (no matching buy lot)',
          warning: `No remaining buy lots for ${trade.amount} ${cur}`,
        });
        continue;
      }

      const avgCost = p.total_cost / p.total_amount;
      const sellAmount = Math.min(trade.amount, p.total_amount);
      const costBasis = round(sellAmount * avgCost);
      const proceeds = round(sellAmount * trade.price_per_unit - (trade.fee || 0));
      const gainLoss = round(proceeds - costBasis);

      // For average cost, estimate holding period from earliest unmatched buys
      const sellDate = new Date(trade.date);
      let estimatedBuyDate = estimateAverageBuyDate(p.buys, sellAmount);
      const holdingMs = estimatedBuyDate
        ? sellDate.getTime() - new Date(estimatedBuyDate).getTime()
        : 0;
      const isLongTerm = holdingMs >= ONE_YEAR_MS;

      disposals.push({
        currency: cur,
        amount: round(sellAmount),
        buy_date: estimatedBuyDate || 'averaged',
        sell_date: trade.date,
        cost_basis: costBasis,
        proceeds,
        gain_loss: gainLoss,
        holding_period_days: estimatedBuyDate
          ? Math.floor(holdingMs / (24 * 60 * 60 * 1000))
          : null,
        term: estimatedBuyDate ? (isLongTerm ? 'long-term' : 'short-term') : 'short-term',
        avg_cost_per_unit: round(avgCost),
      });

      // Reduce pool
      const ratio = sellAmount / p.total_amount;
      p.total_cost = round(p.total_cost * (1 - ratio));
      p.total_amount = round(p.total_amount - sellAmount);

      // Drain buy records proportionally for date tracking
      drainBuys(p.buys, sellAmount);

      if (trade.amount > sellAmount) {
        const excess = round(trade.amount - sellAmount);
        disposals.push({
          currency: cur,
          amount: excess,
          buy_date: null,
          sell_date: trade.date,
          cost_basis: 0,
          proceeds: round(excess * trade.price_per_unit),
          gain_loss: round(excess * trade.price_per_unit),
          holding_period_days: null,
          term: 'unknown (no matching buy lot)',
          warning: `No remaining buy lots for ${excess} ${cur}`,
        });
      }
    }
  }

  return disposals;
}

/** Estimate the earliest buy date for average cost holding period. Uses FIFO drain. */
function estimateAverageBuyDate(buys, amount) {
  let remaining = amount;
  for (const b of buys) {
    if (b.amount <= 0) continue;
    if (remaining <= 0) break;
    return b.date; // earliest remaining buy
  }
  return null;
}

/** Drain buy records in FIFO order for average cost date tracking. */
function drainBuys(buys, amount) {
  let remaining = amount;
  while (remaining > 0 && buys.length > 0) {
    const b = buys[0];
    const used = Math.min(remaining, b.amount);
    b.amount = round(b.amount - used);
    remaining = round(remaining - used);
    if (b.amount <= 0) buys.shift();
  }
}

// ---------------------------------------------------------------------------
// Top-level calculate function
// ---------------------------------------------------------------------------

/**
 * Calculate capital gains/losses for a set of trades.
 *
 * @param {Array} trades — Array of { type, currency, amount, price_per_unit, date, fee? }
 * @param {string} method — 'fifo' | 'lifo' | 'average'
 * @returns {Object} Full tax report
 */
function calculate(trades, method = 'fifo') {
  if (!trades || !Array.isArray(trades) || trades.length === 0) {
    throw new Error('trades must be a non-empty array');
  }

  const m = method.toLowerCase();
  if (!METHODS.includes(m)) {
    throw new Error(`Unsupported method "${method}". Supported: ${METHODS.join(', ')}`);
  }

  // Validate trades
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (!t.type || !['buy', 'sell'].includes(t.type.toLowerCase())) {
      throw new Error(`Trade ${i}: type must be "buy" or "sell"`);
    }
    if (!t.currency) throw new Error(`Trade ${i}: currency is required`);
    if (!t.amount || t.amount <= 0) throw new Error(`Trade ${i}: amount must be positive`);
    if (t.price_per_unit == null || t.price_per_unit < 0) throw new Error(`Trade ${i}: price_per_unit is required`);
    if (!t.date) throw new Error(`Trade ${i}: date is required`);

    // Normalize
    trades[i] = {
      type: t.type.toLowerCase(),
      currency: t.currency.toUpperCase(),
      amount: parseFloat(t.amount),
      price_per_unit: parseFloat(t.price_per_unit),
      date: t.date,
      fee: parseFloat(t.fee || 0),
    };
  }

  let disposals;
  switch (m) {
    case 'fifo': disposals = calculateFIFO(trades); break;
    case 'lifo': disposals = calculateLIFO(trades); break;
    case 'average': disposals = calculateAverage(trades); break;
  }

  const summary = buildSummary(disposals, m);

  return {
    method: m,
    total_trades: trades.length,
    disposals,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(disposals, method) {
  let totalGains = 0;
  let totalLosses = 0;
  let shortTermGains = 0;
  let shortTermLosses = 0;
  let longTermGains = 0;
  let longTermLosses = 0;
  const byCurrency = {};
  const byYear = {};

  for (const d of disposals) {
    const gl = d.gain_loss;
    if (gl >= 0) totalGains += gl;
    else totalLosses += gl;

    if (d.term === 'short-term') {
      if (gl >= 0) shortTermGains += gl;
      else shortTermLosses += gl;
    } else if (d.term === 'long-term') {
      if (gl >= 0) longTermGains += gl;
      else longTermLosses += gl;
    }

    // Per currency
    if (!byCurrency[d.currency]) {
      byCurrency[d.currency] = { gains: 0, losses: 0, net: 0, total_proceeds: 0, total_cost_basis: 0 };
    }
    const bc = byCurrency[d.currency];
    if (gl >= 0) bc.gains += gl;
    else bc.losses += gl;
    bc.net += gl;
    bc.total_proceeds += d.proceeds;
    bc.total_cost_basis += d.cost_basis;

    // Per year
    const year = new Date(d.sell_date).getFullYear().toString();
    if (!byYear[year]) {
      byYear[year] = {
        short_term_gains: 0, short_term_losses: 0,
        long_term_gains: 0, long_term_losses: 0,
        net: 0,
      };
    }
    const by = byYear[year];
    if (d.term === 'short-term') {
      if (gl >= 0) by.short_term_gains += gl;
      else by.short_term_losses += gl;
    } else if (d.term === 'long-term') {
      if (gl >= 0) by.long_term_gains += gl;
      else by.long_term_losses += gl;
    }
    by.net += gl;
  }

  // Round all summary values
  const roundObj = (obj) => {
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'number') obj[k] = round(obj[k]);
      else if (typeof obj[k] === 'object' && obj[k] !== null) roundObj(obj[k]);
    }
  };

  const summary = {
    method,
    total_disposals: disposals.length,
    net_gain_loss: round(totalGains + totalLosses),
    total_gains: round(totalGains),
    total_losses: round(totalLosses),
    short_term: {
      gains: round(shortTermGains),
      losses: round(shortTermLosses),
      net: round(shortTermGains + shortTermLosses),
    },
    long_term: {
      gains: round(longTermGains),
      losses: round(longTermLosses),
      net: round(longTermGains + longTermLosses),
    },
    by_currency: byCurrency,
    by_year: byYear,
  };

  roundObj(summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Annual summary — takes trades, returns per-year breakdown for all methods
// ---------------------------------------------------------------------------

function annualSummary(trades) {
  const results = {};
  for (const method of METHODS) {
    const report = calculate([...trades.map(t => ({ ...t }))], method);
    results[method] = report.summary;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function round(n) {
  return Math.round(n * 1e8) / 1e8; // 8 decimal places — crypto precision
}

module.exports = {
  calculate,
  parseCSV,
  annualSummary,
  METHODS,
};
