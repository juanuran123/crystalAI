// ════════════════════════════════════════════════════════
//  Crystal AI — Live Inventory Function
//  Fetches real-time individual vehicle listings from whalingcityford.com
//  New inventory: individual units with trim, price, color, stock#
//  Used inventory: individual listings from used inventory pages
// ════════════════════════════════════════════════════════

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// Ford models to scrape — matches their URL slug
const NEW_MODELS = [
  { slug: 'bronco',          label: 'Bronco' },
  { slug: 'bronco-sport',    label: 'Bronco Sport' },
  { slug: 'explorer',        label: 'Explorer' },
  { slug: 'f-150',           label: 'F-150' },
  { slug: 'maverick',        label: 'Maverick' },
  { slug: 'ranger',          label: 'Ranger' },
  { slug: 'mustang',         label: 'Mustang' },
  { slug: 'mustang-mach-e',  label: 'Mustang Mach-E' },
  { slug: 'expedition',      label: 'Expedition' },
  { slug: 'super-duty-f-250-srw', label: 'F-250' },
  { slug: 'super-duty-f-350-srw', label: 'F-350' },
  { slug: 'escape',          label: 'Escape' },
  { slug: 'edge',            label: 'Edge' },
];

// Fetch individual new vehicle listings for one model
async function fetchNewModel(slug, label) {
  const url = `https://www.whalingcityford.com/inventory/new/ford/${slug}?paymenttype=cash&instock=true&intransit=true`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return [];
    const html = res.text ? await res.text() : '';
    const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    const vehicles = [];
    const seen = new Set();

    // Pattern: "YEAR Ford MODEL TRIM ... Price $XX,XXX ... Stock # XXXXX"
    // Example: "2025 Ford F-150 Platinum Dealer Discounted Price $79,483 MSRP $86,095 Disclosure Details Pricing vin 1FTFW... Stock # F25311"
    const pattern = /(\d{4})\s+Ford\s+([\w][\w\s\-\/]{1,40}?)\s+(?:Dealer Discounted Price|Your Price|Whaling City Price|Price)\s*\$([0-9,]+).*?Stock\s*#\s*([A-Z0-9]+)/gi;
    let m;
    while ((m = pattern.exec(stripped)) !== null) {
      const year = parseInt(m[1]);
      if (year < 2020 || year > 2028) continue;
      const price = parseInt(m[3].replace(/,/g, ''));
      if (price < 5000 || price > 250000) continue;
      const trimModel = m[2].trim().replace(/\s+/g, ' ');
      const stock = m[4].trim();
      const key = stock || `${year}-${trimModel}-${price}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Try to extract color — appears before or after the trim name
      let color = 'Various';
      const colorMatch = stripped.substring(Math.max(0, m.index - 200), m.index + 400)
        .match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(?:exterior|Exterior)\b/);
      if (colorMatch) color = colorMatch[1];

      vehicles.push({
        year: String(year),
        make: 'Ford',
        model: trimModel,
        price: `$${m[3]}`,
        priceNum: price,
        stock,
        color,
        type: 'new'
      });
    }

    // Fallback: simpler pattern without Stock # (some pages may differ)
    if (vehicles.length === 0) {
      const simple = /(\d{4})\s+Ford\s+([\w][\w\s\-\/]{1,40}?)\s+(?:Dealer Discounted Price|Your Price|Whaling City Price)\s*\$([0-9,]+)/gi;
      while ((m = simple.exec(stripped)) !== null) {
        const year = parseInt(m[1]);
        if (year < 2020 || year > 2028) continue;
        const price = parseInt(m[3].replace(/,/g, ''));
        if (price < 5000 || price > 250000) continue;
        const trimModel = m[2].trim().replace(/\s+/g, ' ');
        const key = `${year}-${trimModel}-${price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        vehicles.push({
          year: String(year), make: 'Ford', model: trimModel,
          price: `$${m[3]}`, priceNum: price, stock: '', color: 'Various', type: 'new'
        });
      }
    }

    console.log(`[inventory] ${label}: found ${vehicles.length} individual units`);
    return vehicles;
  } catch (err) {
    console.error(`[inventory] fetchNewModel(${label}) error:`, err.message);
    return [];
  }
}

// Fetch new inventory — individual units across all models in parallel
async function fetchNew() {
  try {
    const results = await Promise.all(NEW_MODELS.map(m => fetchNewModel(m.slug, m.label)));
    const all = results.flat();

    // If individual pages returned nothing (site layout may differ), fall back to summary page
    if (all.length === 0) {
      console.log('[inventory] individual pages returned 0 — falling back to summary page');
      return await fetchNewSummary();
    }

    console.log(`[inventory] fetchNew total: ${all.length} individual units`);
    return all;
  } catch (err) {
    console.error('[inventory] fetchNew error:', err.message);
    return fetchNewSummary();
  }
}

// Fallback: summary page (model-level, no trim info)
async function fetchNewSummary() {
  try {
    const res = await fetch('https://www.whalingcityford.com/new-inventory/index.htm', {
      headers: { 'User-Agent': UA }
    });
    const html = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const vehicles = [];
    const seen = new Set();
    const pattern = /(\d+)\s+Available\s+(\d{4})\s+Ford\s+([\w][\w\s\-\/]*?)\s+\2\s+Ford\s+[\w][\w\s\-\/]*?Starting\s*at\s*\$([0-9,]+)/gi;
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const key = `${m[2]}-${m[3].trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        vehicles.push({
          year: m[2], make: 'Ford',
          model: m[3].trim().replace(/\s+/g, ' '),
          price: `$${m[4]}`, priceNum: parseInt(m[4].replace(/,/g,'')),
          count: parseInt(m[1]), stock: '', color: 'Various', type: 'new'
        });
      }
    }
    console.log(`[inventory] fetchNewSummary: found ${vehicles.length} models`);
    return vehicles;
  } catch (err) {
    console.error('[inventory] fetchNewSummary error:', err.message);
    return [];
  }
}

// Fetch used inventory — individual listings across 3 pages
async function fetchUsed() {
  const vehicles = [];
  const urls = [
    'https://www.whalingcityford.com/used-inventory/index.htm',
    'https://www.whalingcityford.com/used-inventory/index.htm?start=20',
    'https://www.whalingcityford.com/used-inventory/index.htm?start=40',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const html = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const pattern = /(\d{4})\s+(Chevrolet|Ford|Toyota|Honda|Jeep|RAM|Subaru|Nissan|Dodge|Lincoln|Lexus|Jaguar|Hyundai|Kia|BMW|Mercedes|Volvo|GMC|Buick|Cadillac|Mazda)\s+([\w][\w\s\-]{1,40}?)\s+(?:Your Price|Whaling City Price|Starting at)?\s*\$([0-9,]+)/gi;
      const seen = new Set();
      let m;
      while ((m = pattern.exec(html)) !== null) {
        const year = parseInt(m[1]);
        if (year < 2010 || year > 2028) continue;
        const price = parseInt(m[4].replace(/,/g, ''));
        if (price < 3000 || price > 150000) continue;
        const model = m[3].trim().replace(/\s+/g, ' ')
          .replace(/\s*Whaling City Price\s*/gi, '')
          .replace(/\s*Your Price\s*/gi, '').trim();
        if (model.length < 2) continue;
        const key = `${year}-${m[2]}-${model}-${price}`;
        if (!seen.has(key) && vehicles.length < 80) {
          seen.add(key);
          vehicles.push({ year: m[1], make: m[2], model, price: `$${m[4]}`, priceNum: price, type: 'used' });
        }
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
