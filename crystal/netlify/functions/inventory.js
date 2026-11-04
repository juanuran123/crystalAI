// ════════════════════════════════════════════════════════
//  Crystal AI — Live Inventory Function
//  Calls whalingcityford.com's own JSON APIs directly.
//  No Puppeteer / headless browser needed.
// ════════════════════════════════════════════════════════

const RESP_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const ACCOUNT_ID = '27791';
const BASE = 'https://www.whalingcityford.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

const NEW_MODELS = [
  { name: 'F-150',        slug: 'F 150'         },
  { name: 'Bronco',       slug: 'Bronco'         },
  { name: 'Bronco Sport', slug: 'Bronco Sport'   },
  { name: 'Explorer',     slug: 'Explorer'       },
  { name: 'Maverick',     slug: 'Maverick'       },
  { name: 'Ranger',       slug: 'Ranger'         },
  { name: 'Mustang',      slug: 'Mustang'        },
  { name: 'Mach-E',       slug: 'Mustang Mach-E' },
  { name: 'Expedition',   slug: 'Expedition'     },
];

// ── Fetch trim counts for one model via the filter sidebar API ──────────────
async function fetchModelTrims(model) {
  const params = new URLSearchParams({
    Type: 'New',
    PaymentType: 'cash',
    Makes: 'Ford',
    Models: model.slug,
    SortType: 'priceltoh',
    InTransit: 'true',
    InProduction: 'true',
    InStock: 'true',
    EVDealer: 'true',
    ModelEGroupedAccounts: '',
    SourceFrom: 'inventorycontroller'
  });

  const url = `${BASE}/api/Inventory/getinventorymultiselectionfilters/v2?${params}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': BASE }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // The filter API returns sidebar filter options.
    // Trim counts live under data.trims or data.Trims or data.filters.trims
    const trimCounts = {};
    let total = 0;

    // Try to find total vehicle count
    if (data.TotalCount != null) total = data.TotalCount;
    else if (data.totalCount != null) total = data.totalCount;
    else if (data.Count != null) total = data.Count;

    // Try multiple paths where trims might live
    const trimList = data.Trims || data.trims ||
                     (data.Filters && (data.Filters.Trims || data.Filters.trims)) ||
                     (data.filters && (data.filters.Trims || data.filters.trims)) || [];

    for (const t of trimList) {
      const name = t.Name || t.name || t.Value || t.value || t.Text || t.text;
      const count = t.Count || t.count || t.TotalCount || t.totalCount || 1;
      if (!name) continue;
      // "All" is the total count selector, not a real trim — capture it as total
      if (name.toLowerCase() === 'all') {
        if (!total) total = count;
        continue;
      }
      if (count > 0) trimCounts[name] = count;
    }

    // If we didn't get a total from an "All" entry or the top-level field, sum the trims
    if (!total && Object.keys(trimCounts).length > 0) {
      total = Object.values(trimCounts).reduce((a, b) => a + b, 0);
    }

    console.log(`[inventory] ${model.name}: total=${total}, trims=`, trimCounts);
    return { model: model.name, total, trimCounts };
  } catch (err) {
    console.error(`[inventory] fetchModelTrims error for ${model.name}:`, err.message);
    return { model: model.name, total: 0, trimCounts: {} };
  }
}

// ── Fallback: get inventory list (VINs + trims) from listing API ───────────
async function fetchInventoryList(model) {
  // Try the inventory listing endpoint
  const params = new URLSearchParams({
    accountId: ACCOUNT_ID,
    Type: 'New',
    Makes: 'Ford',
    Models: model.slug,
    PaymentType: 'cash',
    InStock: 'true',
    SortType: 'priceltoh',
    PageSize: '100',
    start: '0'
  });

  const urls = [
    `${BASE}/api/Inventory/getinventory?${params}`,
    `${BASE}/api/Inventory/GetInventory?${params}`,
    `${BASE}/api/inventory/getinventory?${params}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': BASE }
      });
      if (!res.ok) continue;
      const data = await res.json();

      // Look for vehicle list in common response shapes
      const vehicles = data.Vehicles || data.vehicles || data.Items || data.items ||
                       data.Inventory || data.inventory || data.Results || data.results || [];

      if (!Array.isArray(vehicles) || vehicles.length === 0) continue;

      const trimCounts = {};
      for (const v of vehicles) {
        const trim = v.Trim || v.trim || v.TrimName || v.trimName || 'Unknown';
        trimCounts[trim] = (trimCounts[trim] || 0) + 1;
      }

      const total = data.TotalCount || data.totalCount || vehicles.length;
      console.log(`[inventory] ${model.name} list: ${vehicles.length} vehicles`);
      return { model: model.name, total, trimCounts };
    } catch (err) {
      // try next URL
    }
  }
  return null;
}

// ── Scrape the HTML page as final fallback ─────────────────────────────────
async function fetchModelFromHTML(model) {
  const urlSlug = model.slug.toLowerCase().replace(/ /g, '-').replace('mustang-mach-e', 'mustang-mach-e');
  const url = `${BASE}/inventory/new/ford/${urlSlug}?paymenttype=cash&instock=true`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const html = await res.text();

    // Count from "Results: N Vehicles"
    const totalMatch = html.match(/Results:\s*(\d+)\s*Vehicles?/i) ||
                       html.match(/(\d+)\s*Vehicles?\s*Found/i);
    const total = totalMatch ? parseInt(totalMatch[1]) : 0;

    // Extract trims from VIN blocks (pre-rendered only — may miss JS-loaded ones)
    const trimCounts = {};
    const trimPattern = /\b(STX|XL\b|XLT|Lariat|King Ranch|Platinum|Limited|Raptor R\b|Raptor\b|Tremor|Big Bend|Outer Banks|Badlands|Heritage Limited|Heritage|First Edition|Active|ST-Line Select|ST-Line|Titanium|Sport|Dark Horse|Mach 1|EcoBoost Premium|EcoBoost\b|Select|Pro\b|Timberline)\b/gi;
    const vinBlocks = html.match(/data-vin="[^"]{17}"[^<]{0,2000}/g) || [];
    for (const block of vinBlocks) {
      const m = block.match(trimPattern);
      if (m) {
        const trim = m[0];
        trimCounts[trim] = (trimCounts[trim] || 0) + 1;
      }
    }

    // Fallback: scan title tags like "2024 Ford F-150 Lariat"
    if (Object.keys(trimCounts).length === 0) {
      const titlePattern = /20\d\d\s+Ford\s+[\w\s\-]+?\s+(STX|XL\b|XLT|Lariat|King Ranch|Platinum|Limited|Raptor R?\b|Tremor|Big Bend|Outer Banks|Badlands|Heritage Limited|Heritage|Base|ST-Line Select|ST-Line|Titanium|Sport|Dark Horse|Select|Timberline)\b/gi;
      let m;
      while ((m = titlePattern.exec(html)) !== null) {
        const trim = m[1];
        trimCounts[trim] = (trimCounts[trim] || 0) + 1;
      }
    }

    console.log(`[inventory] ${model.name} HTML fallback: total=${total}`, trimCounts);
    return { model: model.name, total: total || Object.values(trimCounts).reduce((a,b) => a+b, 0), trimCounts };
  } catch (err) {
    console.error(`[inventory] HTML fallback error for ${model.name}:`, err.message);
    return { model: model.name, total: 0, trimCounts: {} };
  }
}

// ── Fetch a model using best available method ──────────────────────────────
async function fetchModel(model) {
  // 1. Try filter API (fastest, most accurate for counts)
  const filterResult = await fetchModelTrims(model);
  if (filterResult.total > 0 || Object.keys(filterResult.trimCounts).length > 0) {
    return filterResult;
  }

  // 2. Try inventory list API
  const listResult = await fetchInventoryList(model);
  if (listResult) return listResult;

  // 3. HTML fallback
  return fetchModelFromHTML(model);
}

// ── Used inventory (plain HTML scrape — server-rendered, works fine) ────────
async function fetchUsed() {
  const vehicles = [];
  const urls = [
    `${BASE}/used-inventory/index.htm`,
    `${BASE}/used-inventory/index.htm?start=20`,
    `${BASE}/used-inventory/index.htm?start=40`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const text = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const pattern = /(\d{4})\s+(Chevrolet|Ford|Toyota|Honda|Jeep|RAM|Subaru|Nissan|Dodge|Lincoln|Lexus|Hyundai|Kia|BMW|Mercedes|Volvo|GMC|Buick|Cadillac|Mazda)\s+([\w][\w\s\-]{1,40}?)\s+(?:Your Price|Whaling City Price)?\s*\$([0-9,]+)/gi;
      const seen = new Set();
      let m;
      while ((m = pattern.exec(text)) !== null) {
        const year = parseInt(m[1]);
        if (year < 2010 || year > 2028) continue;
        const price = parseInt(m[4].replace(/,/g, ''));
        if (price < 3000 || price > 150000) continue;
        const model = m[3].trim().replace(/\s+/g, ' ').replace(/\s*(Whaling City Price|Your Price)\s*/gi, '').trim();
        if (model.length < 2) continue;
        const key = `${year}-${m[2]}-${model}-${price}`;
        if (!seen.has(key) && vehicles.length < 80) {
          seen.add(key);
          vehicles.push({ year: m[1], make: m[2], model, price: `$${m[4]}`, type: 'used' });
        }
      }
    } catch (err) {
      console.error('[inventory] fetchUsed error:', err.message);
    }
  }
  return vehicles;
}

// ── Main handler ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: RESP_HEADERS, body: '' };
  }

  try {
    // Fetch all models + used inventory in parallel
    const [modelResults, usedVehicles] = await Promise.all([
      Promise.all(NEW_MODELS.map(fetchModel)),
      fetchUsed()
    ]);

    const newInventory = modelResults.filter(r => r.total > 0 || Object.keys(r.trimCounts).length > 0);
    const totalNewCount = newInventory.reduce((s, v) => s + (v.total || 0), 0);

    // Add starting price from trimCounts (we don't have prices from filter API — that's OK)
    const result = {
      lastUpdated: new Date().toISOString(),
      new: newInventory,
      used: usedVehicles,
      summary: {
        newCount: totalNewCount,
        usedCount: usedVehicles.length,
        models: newInventory.map(v => ({
          model: v.model,
          total: v.total,
          startingPrice: v.startingPrice || null,
          trimCounts: v.trimCounts
        }))
      }
    };

    return {
      statusCode: 200,
      headers: { ...RESP_HEADERS, 'Cache-Control': 'public, max-age=900' },
      body: JSON.stringify(result)
    };
  } catch (err) {
    console.error('[inventory] handler error:', err);
    return {
      statusCode: 500,
      headers: RESP_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
