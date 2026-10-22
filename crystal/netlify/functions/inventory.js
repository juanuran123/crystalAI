// ════════════════════════════════════════════════════════
//  Crystal AI — Live Inventory Function
//  Fetches real-time inventory from whalingcityford.com
// ════════════════════════════════════════════════════════

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function stripTags(str) {
  return (str || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Fetch new inventory — grouped by model on the summary page
async function fetchNew() {
  try {
    const res = await fetch('https://www.whalingcityford.com/new-inventory/index.htm', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html = await res.text();
    const vehicles = [];

    // The page has cards like: "22Available 2026 Ford Bronco...Starting at$41,493"
    // Pattern: year + Ford + model + "Starting at" + price (all within ~500 chars)
    const pattern = /(\d{4})\s+Ford\s+([\w\s\-\/]+?)\s*(?:Starting at|starting at)\s*\$([0-9,]+)/gi;
    const seen = new Set();
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const key = `${m[1]}-${m[2].trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        vehicles.push({
          year: m[1],
          make: 'Ford',
          model: m[2].trim().replace(/\s+/g, ' '),
          startingAt: `$${m[3]}`,
          type: 'new'
        });
      }
    }

    // Fallback: try JSON-LD structured data
    if (vehicles.length === 0) {
      const jsonMatch = html.match(/"@type"\s*:\s*"Car"[\s\S]{0,500}?"name"\s*:\s*"([^"]+)"[\s\S]{0,200}?"price"\s*:\s*"?([0-9,]+)"?/gi);
      if (jsonMatch) {
        jsonMatch.forEach(block => {
          const name = block.match(/"name"\s*:\s*"([^"]+)"/);
          const price = block.match(/"price"\s*:\s*"?([0-9,]+)"?/);
          if (name && price) {
            vehicles.push({ year: new Date().getFullYear().toString(), make: 'Ford', model: name[1], startingAt: `$${price[1]}`, type: 'new' });
          }
        });
      }
    }

    console.log(`[inventory] fetchNew: found ${vehicles.length} vehicles`);
    return vehicles;
  } catch (err) {
    console.error('[inventory] fetchNew error:', err.message);
    return [];
  }
}

// Fetch used inventory — individual listings across 2 pages
async function fetchUsed() {
  const vehicles = [];
  const urls = [
    'https://www.whalingcityford.com/used-inventory/index.htm',
    'https://www.whalingcityford.com/used-inventory/index.htm?start=20'
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const html = await res.text();

      // Used listings have year + make + model + price in close proximity
      // Pattern targets: "2023 Ford Edge SEL" ... "$24,493"
      const pattern = /(\d{4})\s+([\w]+)\s+([\w\s\-\/]+?)\s{0,3}(?:<[^>]+>){0,5}\s*\$([0-9,]+)/gi;
      const seen = new Set();
      let m;
      while ((m = pattern.exec(html)) !== null) {
        const year = parseInt(m[1]);
        if (year < 2010 || year > 2027) continue;
        const make = m[2].trim();
        // Skip HTML artifacts
        if (['div', 'class', 'href', 'span', 'data', 'type', 'style', 'item', 'true', 'false'].includes(make.toLowerCase())) continue;
        const model = m[3].trim().replace(/\s+/g, ' ');
        if (model.length < 2 || model.length > 40) continue;
        const price = parseInt(m[4].replace(/,/g, ''));
        if (price < 5000 || price > 150000) continue;

        const key = `${year}-${make}-${model}-${price}`;
        if (!seen.has(key)) {
          seen.add(key);
          vehicles.push({ year: m[1], make, model, price: `$${m[4]}`, type: 'used' });
        }
        if (vehicles.length >= 60) break;
      }
    } catch (err) {
      console.error('[inventory] fetchUsed error:', err.message);
    }
  }

  console.log(`[inventory] fetchUsed: found ${vehicles.length} vehicles`);
  return vehicles;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  try {
    const [newVehicles, usedVehicles] = await Promise.all([fetchNew(), fetchUsed()]);

    const result = {
      lastUpdated: new Date().toISOString(),
      new: newVehicles,
      used: usedVehicles,
      summary: { newCount: newVehicles.length, usedCount: usedVehicles.length }
    };

    return {
      statusCode: 200,
      headers: { ...HEADERS, 'Cache-Control': 'public, max-age=1800' },
      body: JSON.stringify(result)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
