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
    const rawHtml = await res.text();
    // Strip tags and collapse whitespace for easier regex matching
    const html = rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const vehicles = [];

    // Page structure: "Available 2026 Ford Bronco 2026 Ford Bronco Starting at $41,493"
    // The model name appears twice before "Starting at$price"
    const pattern = /Available\s+(\d{4})\s+Ford\s+([\w][\w\s\-\/]*?)\d{4}\s+Ford\s+[\w][\w\s\-\/]*?Starting\s*at\s*\$([0-9,]+)/gi;
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

    // Fallback: simpler pattern without "Available" prefix
    if (vehicles.length === 0) {
      const simple = /(\d{4})\s+Ford\s+([\w][\w\s\-\/]{2,30}?)Starting\s*at\s*\$([0-9,]+)/gi;
      const seen2 = new Set();
      while ((m = simple.exec(html)) !== null) {
        const key = `${m[1]}-${m[2].trim()}`;
        if (!seen2.has(key)) {
          seen2.add(key);
          vehicles.push({
            year: m[1],
            make: 'Ford',
            model: m[2].trim().replace(/\s+/g, ' '),
            startingAt: `$${m[3]}`,
            type: 'new'
          });
        }
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

      // Used listings: "2023 Ford Edge SEL...Your Price$24,493" or "$24,493"
      // Try matching year+make+model followed by a price within 300 chars
      const stripHtml = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const pattern = /(\d{4})\s+(Chevrolet|Ford|Toyota|Honda|Jeep|RAM|Subaru|Nissan|Dodge|Lincoln|Lexus|Jaguar|Hyundai|Kia|BMW|Mercedes|Volvo|GMC|Buick|Cadillac|Mazda)\s+([\w][\w\s\-]{1,30}?)\s+(?:Your Price|Starting at)?\s*\$([0-9,]+)/gi;
      const seen = new Set();
      let m;
      while ((m = pattern.exec(stripHtml)) !== null) {
        const year = parseInt(m[1]);
        if (year < 2010 || year > 2027) continue;
        const price = parseInt(m[4].replace(/,/g, ''));
        if (price < 5000 || price > 150000) continue;
        const model = m[3].trim().replace(/\s+/g, ' ').replace(/\s*Whaling City Price\s*/gi, '').trim();
        if (model.length < 2) continue;
        const key = `${year}-${m[2]}-${model}-${price}`;
        if (!seen.has(key)) {
          seen.add(key);
          vehicles.push({ year: m[1], make: m[2], model, price: `$${m[4]}`, type: 'used' });
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
