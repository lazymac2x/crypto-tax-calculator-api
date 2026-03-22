/**
 * Realistic test scenarios for the crypto tax calculator.
 */

const { calculate, parseCSV, annualSummary } = require('../src/calculator');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function approx(a, b, eps = 0.01) {
  return Math.abs(a - b) < eps;
}

// =========================================================================
// Test 1: Simple FIFO — single buy, partial sell
// =========================================================================
console.log('\n--- Test 1: Simple FIFO (BTC buy 1.0 @ 30k, sell 0.5 @ 45k) ---');
{
  const trades = [
    { type: 'buy', currency: 'BTC', amount: 1.0, price_per_unit: 30000, date: '2025-01-15' },
    { type: 'sell', currency: 'BTC', amount: 0.5, price_per_unit: 45000, date: '2025-08-20' },
  ];
  const r = calculate(trades, 'fifo');
  assert(r.disposals.length === 1, 'One disposal');
  assert(r.disposals[0].cost_basis === 15000, `Cost basis = 15000 (got ${r.disposals[0].cost_basis})`);
  assert(r.disposals[0].proceeds === 22500, `Proceeds = 22500 (got ${r.disposals[0].proceeds})`);
  assert(r.disposals[0].gain_loss === 7500, `Gain = 7500 (got ${r.disposals[0].gain_loss})`);
  assert(r.disposals[0].term === 'short-term', 'Short-term (< 1 year)');
}

// =========================================================================
// Test 2: FIFO with multiple lots
// =========================================================================
console.log('\n--- Test 2: FIFO multi-lot (2 buys, 1 sell spanning both) ---');
{
  const trades = [
    { type: 'buy', currency: 'ETH', amount: 5, price_per_unit: 2000, date: '2024-01-10' },
    { type: 'buy', currency: 'ETH', amount: 5, price_per_unit: 3000, date: '2024-06-15' },
    { type: 'sell', currency: 'ETH', amount: 7, price_per_unit: 4000, date: '2025-03-01' },
  ];
  const r = calculate(trades, 'fifo');
  assert(r.disposals.length === 2, `Two disposals (got ${r.disposals.length})`);
  // First disposal: 5 ETH from lot 1 @ 2000
  assert(r.disposals[0].amount === 5, 'First disposal amount = 5');
  assert(r.disposals[0].cost_basis === 10000, `First cost basis = 10000 (got ${r.disposals[0].cost_basis})`);
  assert(r.disposals[0].proceeds === 20000, `First proceeds = 20000 (got ${r.disposals[0].proceeds})`);
  assert(r.disposals[0].term === 'long-term', 'First disposal is long-term (>1yr)');
  // Second disposal: 2 ETH from lot 2 @ 3000
  assert(r.disposals[1].amount === 2, 'Second disposal amount = 2');
  assert(r.disposals[1].cost_basis === 6000, `Second cost basis = 6000 (got ${r.disposals[1].cost_basis})`);
  assert(r.disposals[1].proceeds === 8000, `Second proceeds = 8000 (got ${r.disposals[1].proceeds})`);
  assert(r.disposals[1].term === 'short-term', 'Second disposal is short-term (<1yr)');
}

// =========================================================================
// Test 3: LIFO — same trades, different lot matching
// =========================================================================
console.log('\n--- Test 3: LIFO multi-lot (newest lots sold first) ---');
{
  const trades = [
    { type: 'buy', currency: 'ETH', amount: 5, price_per_unit: 2000, date: '2024-01-10' },
    { type: 'buy', currency: 'ETH', amount: 5, price_per_unit: 3000, date: '2024-06-15' },
    { type: 'sell', currency: 'ETH', amount: 7, price_per_unit: 4000, date: '2025-03-01' },
  ];
  const r = calculate(trades, 'lifo');
  assert(r.disposals.length === 2, `Two disposals (got ${r.disposals.length})`);
  // LIFO: first sells from lot 2 (5 ETH @ 3000), then lot 1 (2 ETH @ 2000)
  assert(r.disposals[0].cost_basis === 15000, `First cost basis = 15000 (got ${r.disposals[0].cost_basis})`);
  assert(r.disposals[0].term === 'short-term', 'First disposal is short-term');
  assert(r.disposals[1].cost_basis === 4000, `Second cost basis = 4000 (got ${r.disposals[1].cost_basis})`);
  assert(r.disposals[1].term === 'long-term', 'Second disposal is long-term');
}

// =========================================================================
// Test 4: Average Cost
// =========================================================================
console.log('\n--- Test 4: Average Cost ---');
{
  const trades = [
    { type: 'buy', currency: 'SOL', amount: 100, price_per_unit: 20, date: '2025-01-01' },
    { type: 'buy', currency: 'SOL', amount: 100, price_per_unit: 40, date: '2025-03-01' },
    { type: 'sell', currency: 'SOL', amount: 50, price_per_unit: 50, date: '2025-06-01' },
  ];
  const r = calculate(trades, 'average');
  // Avg cost = (100*20 + 100*40) / 200 = 6000/200 = 30
  assert(r.disposals.length === 1, `One disposal (got ${r.disposals.length})`);
  assert(r.disposals[0].avg_cost_per_unit === 30, `Avg cost = 30 (got ${r.disposals[0].avg_cost_per_unit})`);
  assert(r.disposals[0].cost_basis === 1500, `Cost basis = 1500 (got ${r.disposals[0].cost_basis})`);
  assert(r.disposals[0].proceeds === 2500, `Proceeds = 2500 (got ${r.disposals[0].proceeds})`);
  assert(r.disposals[0].gain_loss === 1000, `Gain = 1000 (got ${r.disposals[0].gain_loss})`);
}

// =========================================================================
// Test 5: Multi-currency portfolio
// =========================================================================
console.log('\n--- Test 5: Multi-currency portfolio ---');
{
  const trades = [
    { type: 'buy', currency: 'BTC', amount: 0.5, price_per_unit: 40000, date: '2024-01-01' },
    { type: 'buy', currency: 'ETH', amount: 10, price_per_unit: 2500, date: '2024-02-01' },
    { type: 'sell', currency: 'BTC', amount: 0.5, price_per_unit: 60000, date: '2025-06-01' },
    { type: 'sell', currency: 'ETH', amount: 10, price_per_unit: 4000, date: '2025-06-01' },
  ];
  const r = calculate(trades, 'fifo');
  assert(r.disposals.length === 2, 'Two disposals');
  const btc = r.disposals.find(d => d.currency === 'BTC');
  const eth = r.disposals.find(d => d.currency === 'ETH');
  assert(btc.gain_loss === 10000, `BTC gain = 10000 (got ${btc.gain_loss})`);
  assert(eth.gain_loss === 15000, `ETH gain = 15000 (got ${eth.gain_loss})`);
  assert(btc.term === 'long-term', 'BTC is long-term');
  assert(eth.term === 'long-term', 'ETH is long-term');
  assert(r.summary.net_gain_loss === 25000, `Total net = 25000 (got ${r.summary.net_gain_loss})`);
}

// =========================================================================
// Test 6: Loss scenario
// =========================================================================
console.log('\n--- Test 6: Capital loss ---');
{
  const trades = [
    { type: 'buy', currency: 'SOL', amount: 100, price_per_unit: 150, date: '2025-01-01' },
    { type: 'sell', currency: 'SOL', amount: 100, price_per_unit: 80, date: '2025-04-01' },
  ];
  const r = calculate(trades, 'fifo');
  assert(r.disposals[0].gain_loss === -7000, `Loss = -7000 (got ${r.disposals[0].gain_loss})`);
  assert(r.summary.total_losses === -7000, `Total losses = -7000 (got ${r.summary.total_losses})`);
}

// =========================================================================
// Test 7: Fees included
// =========================================================================
console.log('\n--- Test 7: Fee handling ---');
{
  const trades = [
    { type: 'buy', currency: 'BTC', amount: 1.0, price_per_unit: 50000, date: '2025-01-01', fee: 50 },
    { type: 'sell', currency: 'BTC', amount: 1.0, price_per_unit: 60000, date: '2025-07-01', fee: 60 },
  ];
  const r = calculate(trades, 'fifo');
  // Cost basis = 1.0 * (50000 + 50/1) = 50050
  // Proceeds = 1.0 * (60000 - 60/1) = 59940
  // Gain = 59940 - 50050 = 9890
  assert(r.disposals[0].cost_basis === 50050, `Cost basis with fee = 50050 (got ${r.disposals[0].cost_basis})`);
  assert(r.disposals[0].proceeds === 59940, `Proceeds with fee = 59940 (got ${r.disposals[0].proceeds})`);
  assert(r.disposals[0].gain_loss === 9890, `Gain after fees = 9890 (got ${r.disposals[0].gain_loss})`);
}

// =========================================================================
// Test 8: CSV parsing
// =========================================================================
console.log('\n--- Test 8: CSV parsing ---');
{
  const csv = `type,currency,amount,price_per_unit,date,fee
buy,BTC,0.1,30000,2025-01-15,2.5
buy,BTC,0.2,35000,2025-03-20,5
sell,BTC,0.15,45000,2025-09-01,3`;
  const trades = parseCSV(csv);
  assert(trades.length === 3, `Parsed 3 trades (got ${trades.length})`);
  assert(trades[0].currency === 'BTC', 'Currency parsed');
  assert(trades[1].amount === 0.2, 'Amount parsed');
  assert(trades[2].fee === 3, 'Fee parsed');

  const r = calculate(trades, 'fifo');
  assert(r.disposals.length >= 1, 'Has disposals from CSV');
}

// =========================================================================
// Test 9: Annual summary compares all methods
// =========================================================================
console.log('\n--- Test 9: Annual summary ---');
{
  const trades = [
    { type: 'buy', currency: 'BTC', amount: 1, price_per_unit: 20000, date: '2024-01-01' },
    { type: 'buy', currency: 'BTC', amount: 1, price_per_unit: 50000, date: '2024-11-01' },
    { type: 'sell', currency: 'BTC', amount: 1.5, price_per_unit: 60000, date: '2025-06-01' },
  ];
  const s = annualSummary(trades);
  assert(s.fifo !== undefined, 'FIFO summary present');
  assert(s.lifo !== undefined, 'LIFO summary present');
  assert(s.average !== undefined, 'Average summary present');
  // FIFO sells 1 BTC@20k + 0.5 BTC@50k = cost 45k, proceeds 90k, gain 45k
  // LIFO sells 1 BTC@50k + 0.5 BTC@20k = cost 60k, proceeds 90k, gain 30k
  assert(approx(s.fifo.net_gain_loss, 45000), `FIFO net = 45000 (got ${s.fifo.net_gain_loss})`);
  assert(approx(s.lifo.net_gain_loss, 30000), `LIFO net = 30000 (got ${s.lifo.net_gain_loss})`);
  assert(s.lifo.net_gain_loss < s.fifo.net_gain_loss, 'LIFO produces lower tax in rising market');
}

// =========================================================================
// Test 10: Long-term threshold — exactly 365 days
// =========================================================================
console.log('\n--- Test 10: 365-day threshold precision ---');
{
  const trades = [
    { type: 'buy', currency: 'ETH', amount: 1, price_per_unit: 3000, date: '2024-01-01' },
    // Sell on 2024-12-31 = 365 days later (2024 is leap year so 366 days to Jan 1)
    { type: 'sell', currency: 'ETH', amount: 1, price_per_unit: 5000, date: '2024-12-31' },
  ];
  const r = calculate(trades, 'fifo');
  // Jan 1 to Dec 31 = 365 days (2024 is leap year, but we count from Jan 1 to Dec 31 = 365 days)
  assert(r.disposals[0].holding_period_days === 365, `Holding = 365 days (got ${r.disposals[0].holding_period_days})`);
  assert(r.disposals[0].term === 'long-term', 'Exactly 365 days = long-term');
}

// =========================================================================
// Test 11: Realistic year of trading
// =========================================================================
console.log('\n--- Test 11: Realistic trading year (multiple buys/sells across currencies) ---');
{
  const trades = [
    // Q1 — accumulation
    { type: 'buy', currency: 'BTC', amount: 0.5, price_per_unit: 42000, date: '2024-01-05', fee: 10 },
    { type: 'buy', currency: 'ETH', amount: 5, price_per_unit: 2200, date: '2024-01-20', fee: 5 },
    { type: 'buy', currency: 'SOL', amount: 50, price_per_unit: 95, date: '2024-02-10', fee: 3 },
    // Q2 — partial sells during rally
    { type: 'sell', currency: 'BTC', amount: 0.2, price_per_unit: 65000, date: '2024-04-15', fee: 8 },
    { type: 'sell', currency: 'SOL', amount: 30, price_per_unit: 170, date: '2024-05-01', fee: 2 },
    // Q3 — buy the dip
    { type: 'buy', currency: 'BTC', amount: 0.3, price_per_unit: 55000, date: '2024-07-20', fee: 7 },
    { type: 'buy', currency: 'ETH', amount: 3, price_per_unit: 3100, date: '2024-08-01', fee: 4 },
    // Q4 — year-end sells
    { type: 'sell', currency: 'ETH', amount: 4, price_per_unit: 3800, date: '2024-12-10', fee: 6 },
    { type: 'sell', currency: 'BTC', amount: 0.4, price_per_unit: 98000, date: '2024-12-28', fee: 12 },
    // Next year — long-term sell
    { type: 'sell', currency: 'SOL', amount: 20, price_per_unit: 210, date: '2025-03-15', fee: 2 },
  ];

  const fifo = calculate(trades, 'fifo');
  const lifo = calculate(trades, 'lifo');

  assert(fifo.disposals.length > 0, `FIFO has ${fifo.disposals.length} disposals`);
  assert(lifo.disposals.length > 0, `LIFO has ${lifo.disposals.length} disposals`);
  assert(fifo.summary.by_currency.BTC !== undefined, 'BTC in summary');
  assert(fifo.summary.by_currency.ETH !== undefined, 'ETH in summary');
  assert(fifo.summary.by_currency.SOL !== undefined, 'SOL in summary');

  // The SOL sell in March 2025 should be long-term (bought Feb 2024 via FIFO)
  const solSell2025 = fifo.disposals.find(d => d.currency === 'SOL' && d.sell_date === '2025-03-15');
  assert(solSell2025 && solSell2025.term === 'long-term', 'SOL sold in 2025 is long-term');

  // Annual summary should have both 2024 and 2025
  assert(fifo.summary.by_year['2024'] !== undefined, '2024 in yearly summary');
  assert(fifo.summary.by_year['2025'] !== undefined, '2025 in yearly summary');

  console.log(`  FIFO net: $${fifo.summary.net_gain_loss}`);
  console.log(`  LIFO net: $${lifo.summary.net_gain_loss}`);
}

// =========================================================================
// Summary
// =========================================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
else console.log('All tests passed!');
