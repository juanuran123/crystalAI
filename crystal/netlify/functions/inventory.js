// ════════════════════════════════════════════════════════
//  Crystal AI — Live Inventory Function
//  Fetches real-time inventory from whalingcityford.com
//  Returns clean JSON for injection into Crystal's system prompt
// ════════════════════════════════════════════════════════

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Simple HTML tag stripper
function stripTags(str) {
  return (str || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Decode HTML entities
function decodeEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Extract new inventory summary from whalingcityford.com
async function fetchNew() {
  try {
    const res = await fetch('https://www.whalingcityford.com/new-inventory/index.htm', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrystalAI/1.0)' }
    });
    const html = await res.text();

    const vehicles = [];

    // Match inventory cards — each has a year/make/model and price
    const cardPattern = /<div[^>]*class="[^"]*inventory-listing[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    const titlePattern = /(\d{4})\s+Ford\s+([\w\s\-]+?)(?:\s*<|\s*$)/i;
    const pricePattern = /\$([0-9,]+)/;
    const countPattern = /(\d+)\s+(?:vehicle|result)/i;

    // Simpler approach: find model groups with counts and prices
    const modelPattern = /data-model="([^"]+)"[^>]*>[\s\S]*?(\d+)\s+(?:Vehicle|Result)/gi;

    // Parse the summary cards (year + model + count + starting price)
    const summaryPattern = /class="[^"]*title[^"]*"[^>]*>\s*<[^>]+>\s*(20\d\d)\s+Ford\s+([\w\s\-\/]+?)\s*<\/[\s\S]*?Starting\s+at\s*<\/[^>]+>\s*\$([0-9,]+)/gi;

    let match;
    while ((match = summaryPattern.exec(html)) !== null) {
      const year = match[1];
      const model = decodeEntities(stripTags(match[2]));
      const price = match[3];
      vehicles.push({ year, make: 'Ford', model, startingAt: `$${price}`, type: 'new' });
    }

    // Fallback: extract from structured data or simpler patterns
    if (vehicles.length === 0) {
      const blockPattern = /(20\d\d)\s+Ford\s+([\w\s\-]+?)[\s\S]{0,200}?\$([0-9,]+)/gi;
      const seen = new Set();
      while ((match = blockPattern.exec(html)) !== null) {
        const key = `${match[1]}-${match[2]}`;
        if (!seen.has(key)) {
          seen.add(key);
          vehicles.push({
            year: match[1],
            make: 'Ford',
            model: decodeEntities(match[2].trim()),
            startingAt: `$${match[3]}`,
            type: 'new'
          });
        }
        if (vehicles.length >= 30) break;
      }
    }

    return vehicles;
  } catch (err) {
    console.error('[inventory] fetchNew error:', err.message);
    return [];
  }
}

// Extract used inventory from whalingcityford.com (both pages)
async function fetchUsed() {
  const vehicles = [];
  const urls = [
    'https://www.whalingcityford.com/used-inventory/index.htm',
    'https://www.whalingcityford.com/used-inventory/index.htm?start=20'
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrystalAI/1.0)' }
      });
      const html = await res.text();

      // Match vehicle listings with year/make/model/trim and price
      const listingPattern = /class="[^"]*inventory-title[^"]*"[^>]*>\s*<[^>]+>\s*(20\d\d|19\d\d)\s+([\w]+)\s+([\w\s\-\/]+?)(?:\s*<)[\s\S]{0,500}?\$([0-9,]+)/gi;

      let match;
      while ((match = listingPattern.exec(html)) !== null) {
        vehicles.push({
          year: match[1],
          make: decodeEntities(match[2].trim()),
          model: decodeEntities(match[3].trim()),
          price: `$${match[4]}`,
          type: 'used'
        });
        if (vehicles.length >= 60) break;
      }

      // Fallback pattern
      if (vehicles.length === 0) {
        const fallback = /(20\d\d|19\d\d)\s+([\w]+)\s+([\w\s\-]+?)\s*\$([0-9,]+)/gi;
        const seen = new Set();
        while ((match = fallback.exec(html)) !== null) {
          const key = `${match[1]}-${match[2]}-${match[3]}`;
          if (!seen.has(key)) {
            seen.add(key);
            vehicles.push({
              year: match[1],
              make: match[2],
              model: match[3].trim(),
              price: `$${match[4]}`,
              type: 'used'
            });
          }
          if (vehicles.length >= 60) break;
        }
      }
    } catch (err) {
      console.error('[inventory] fetchUsed error:', err.message);
    }
  }

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
      summary: {
        newCount: newVehicles.length,
        usedCount: usedVehicles.length
      }
    };

    console.log(`[inventory] fetched ${newVehicles.length} new, ${usedVehicles.length} used`);

    return {
      statusCode: 200,
      headers: { ...HEADERS, 'Cache-Control': 'public, max-age=1800' }, // cache 30 min
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
