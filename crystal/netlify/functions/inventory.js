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

// ── Fetch individual vehicle records (VIN, color, cab, drivetrain, price) ────
async function fetchInventoryDetails(model) {
  // Use the same params that work for the filter API
  const sharedParams = {
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
    SourceFrom: 'inventorycontroller',
    PageSize: '100',
    PageNumber: '1'
  };

  const urls = [
    `${BASE}/api/Inventory/getinventory?${new URLSearchParams(sharedParams)}`,
    `${BASE}/api/Inventory/GetInventoryList?${new URLSearchParams(sharedParams)}`,
    `${BASE}/api/Inventory/getinventorylist?${new URLSearchParams(sharedParams)}`,
    `${BASE}/api/Inventory/GetVehiclesByFilter?${new URLSearchParams(sharedParams)}`,
    // Legacy params variant
    `${BASE}/api/Inventory/getinventory?${new URLSearchParams({
      accountId: ACCOUNT_ID, Type: 'New', Makes: 'Ford', Models: model.slug,
      PaymentType: 'cash', InStock: 'true', SortType: 'priceltoh', PageSize: '100', start: '0'
    })}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': BASE }
      });
      console.log(`[inventory] ${model.name} list API ${res.status}: ${url.split('?')[0]}`);
      if (!res.ok) continue;
      const data = await res.json();

      // Log top-level keys so we can see the response shape
      console.log(`[inventory] ${model.name} response keys:`, Object.keys(data).join(', '));

      const rawVehicles = data.Vehicles || data.vehicles || data.Items || data.items ||
                          data.Inventory || data.inventory || data.Results || data.results ||
                          data.VehicleList || data.vehicleList || data.Data || data.data || [];

      if (!Array.isArray(rawVehicles) || rawVehicles.length === 0) {
        console.log(`[inventory] ${model.name} no vehicle array found in response`);
        continue;
      }

      console.log(`[inventory] ${model.name} list API: ${rawVehicles.length} vehicles, first keys:`, Object.keys(rawVehicles[0] || {}).slice(0,8).join(', '));

      // Normalize each vehicle to a consistent shape
      const vehicles = rawVehicles.map(v => ({
        vin:       v.VIN || v.Vin || v.vin || '',
        trim:      v.Trim || v.trim || v.TrimName || v.trimName || '',
        year:      v.Year || v.year || 2026,
        price:     v.Price || v.price || v.MSRP || v.Msrp || v.msrp || v.ListPrice || v.listPrice || 0,
        extColor:  v.ExteriorColor || v.exteriorColor || v.ExtColor || v.extColor || v.Color || v.color || '',
        intColor:  v.InteriorColor || v.interiorColor || v.IntColor || v.intColor || '',
        cabStyle:  v.BodyStyle || v.bodyStyle || v.CabStyle || v.cabStyle || v.Style || v.style || '',
        driveType: v.DriveType || v.driveType || v.Drivetrain || v.drivetrain || v.Drive || v.drive || '',
        stock:     v.StockNumber || v.stockNumber || v.StockNum || v.stockNum || v.Stock || '',
        mpgCity:   v.MPGCity || v.mpgCity || v.FuelEconomyCity || 0,
        mpgHwy:    v.MPGHighway || v.mpgHighway || v.FuelEconomyHighway || 0,
      })).filter(v => v.trim); // drop records with no trim

      return vehicles;
    } catch (err) {
      console.error(`[inventory] fetchInventoryDetails error for ${model.name}:`, err.message);
    }
  }
  return [];
}

// ── Fallback: get inventory list (VINs + trims) from listing API ───────────
async function fetchInventoryList(model) {
  const vehicles = await fetchInventoryDetails(model);
  if (!vehicles.length) return null;

  const trimCounts = {};
  for (const v of vehicles) {
    trimCounts[v.trim] = (trimCounts[v.trim] || 0) + 1;
  }
  return { model: model.name, total: vehicles.length, trimCounts };
}

// ── Scrape HTML inventory page to extract individual vehicle records ─────────
// The dealer site server-renders vehicle cards — no separate vehicle list API.
// This function pulls VINs + trim/color/price/cab from the rendered HTML.
async function fetchModelFromHTML(model) {
  const urlSlug = model.slug.toLowerCase().replace(/ /g, '-');
  const url = `${BASE}/inventory/new/ford/${urlSlug}?paymenttype=cash&instock=true&sorttype=priceltoh`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': BASE } });
    const html = await res.text();

    console.log(`[inventory] HTML for ${model.name}: ${html.length} chars`);

    // ── Try JSON embedded in script tags first (most reliable) ──────────────
    // Dealer.com sometimes embeds vehicle data as JSON in the page
    const vehicles = [];
    const jsonPatterns = [
      /window\.__inventory\s*=\s*(\[[\s\S]*?\]);/,
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/,
      /"vehicles"\s*:\s*(\[[\s\S]*?\])\s*[,}]/,
      /inventoryData\s*=\s*(\[[\s\S]*?\]);/,
    ];
    for (const pat of jsonPatterns) {
      const m = html.match(pat);
      if (m) {
        try {
          const data = JSON.parse(m[1]);
          const arr = Array.isArray(data) ? data : (data.vehicles || data.Vehicles || []);
          if (arr.length > 0) {
            console.log(`[inventory] ${model.name} JSON embed: ${arr.length} vehicles`);
            for (const v of arr) {
              vehicles.push({
                vin:       v.VIN || v.Vin || v.vin || '',
                trim:      v.Trim || v.trim || '',
                year:      v.Year || v.year || 2026,
                price:     v.Price || v.price || v.MSRP || v.msrp || 0,
                extColor:  v.ExteriorColor || v.exteriorColor || v.Color || '',
                cabStyle:  v.BodyStyle || v.bodyStyle || v.CabStyle || '',
                driveType: v.DriveType || v.driveType || v.Drivetrain || '',
                stock:     v.StockNumber || v.stockNumber || '',
              });
            }
            break;
          }
        } catch(e) {}
      }
    }

    // ── Fall back to data-* attribute scraping ───────────────────────────────
    if (vehicles.length === 0) {
      // Extract vehicle cards: each has data-vin plus surrounding data attributes
      // Pattern: data-vin="VIN" ... with nearby trim/color/price data
      const cardPattern = /data-vin="([A-HJ-NPR-Z0-9]{17})"([^>]*>[\s\S]{0,1500}?)(?=data-vin="|<\/section|<\/article|$)/gi;
      let cardMatch;
      while ((cardMatch = cardPattern.exec(html)) !== null) {
        const vin = cardMatch[1];
        const block = cardMatch[2];

        // Extract trim
        const trimM = block.match(/data-trim="([^"]+)"/i) ||
                      block.match(/data-model-trim="([^"]+)"/i) ||
                      block.match(/"trim"\s*:\s*"([^"]+)"/i);
        const trim = trimM ? trimM[1] : '';

        // Extract year
        const yearM = block.match(/data-year="(\d{4})"/i) || block.match(/"year"\s*:\s*"?(\d{4})"?/i);
        const year = yearM ? parseInt(yearM[1]) : 2026;

        // Extract price
        const priceM = block.match(/data-price="([0-9]+)"/i) ||
                       block.match(/"price"\s*:\s*"?([0-9]+)"?/i) ||
                       block.match(/\$([0-9]{2,3},[0-9]{3})/);
        const price = priceM ? parseInt(priceM[1].replace(/,/g,'')) : 0;

        // Extract exterior color
        const colorM = block.match(/data-ext(?:erior)?-color="([^"]+)"/i) ||
                       block.match(/data-color="([^"]+)"/i) ||
                       block.match(/"exteriorColor"\s*:\s*"([^"]+)"/i) ||
                       block.match(/Exterior[^:]*:\s*<[^>]*>([^<]{3,30})</i);
        const extColor = colorM ? colorM[1].trim() : '';

        // Extract body style / cab
        const cabM = block.match(/data-body-style="([^"]+)"/i) ||
                     block.match(/data-cab="([^"]+)"/i) ||
                     block.match(/"bodyStyle"\s*:\s*"([^"]+)"/i) ||
                     block.match(/\b(SuperCrew|SuperCab|Regular Cab|Crew Cab|Extended Cab|4-Door|2-Door)\b/i);
        const cabStyle = cabM ? cabM[1].trim() : '';

        // Extract drivetrain
        const driveM = block.match(/data-drive(?:train)?="([^"]+)"/i) ||
                       block.match(/"driveType"\s*:\s*"([^"]+)"/i) ||
                       block.match(/\b(4x4|4x2|4WD|AWD|RWD|FWD|2WD)\b/i);
        const driveType = driveM ? driveM[1].trim() : '';

        if (trim || vin) {
          vehicles.push({ vin, trim, year, price, extColor, cabStyle, driveType, stock: '' });
        }
      }
      console.log(`[inventory] ${model.name} HTML attr scrape: ${vehicles.length} vehicles`);
    }

    // ── Build trimCounts from whatever we found ──────────────────────────────
    const trimCounts = {};
    for (const v of vehicles) {
      if (v.trim) trimCounts[v.trim] = (trimCounts[v.trim] || 0) + 1;
    }

    // Count from "Results: N Vehicles" or similar text in page
    const totalMatch = html.match(/Results:\s*(\d+)\s*Vehicles?/i) ||
                       html.match(/(\d+)\s*Vehicles?\s*Found/i) ||
                       html.match(/Showing\s+\d+\s*[-–]\s*\d+\s+of\s+(\d+)/i);
    const total = totalMatch ? parseInt(totalMatch[1]) : (vehicles.length || 0);

    // Fallback: scan title tags like "2024 Ford F-150 Lariat"
    if (Object.keys(trimCounts).length === 0) {
      const titlePattern = /20\d\d\s+Ford\s+[\w\s\-]+?\s+(STX|XL\b|XLT|Lariat|King Ranch|Platinum|Limited|Raptor R?\b|Tremor|Big Bend|Outer Banks|Badlands|Heritage Limited|Heritage|Base|ST-Line Select|ST-Line|Titanium|Sport|Dark Horse|Select|Timberline)\b/gi;
      let m;
      while ((m = titlePattern.exec(html)) !== null) {
        const trim = m[1];
        trimCounts[trim] = (trimCounts[trim] || 0) + 1;
      }
    }

    // Group vehicles by trim for the frontend card builder
    const vehiclesByTrim = {};
    for (const v of vehicles) {
      if (!v.trim) continue;
      if (!vehiclesByTrim[v.trim]) vehiclesByTrim[v.trim] = [];
      vehiclesByTrim[v.trim].push(v);
    }

    console.log(`[inventory] ${model.name} HTML: total=${total}, vehicles=${vehicles.length}, trims=`, trimCounts);
    return {
      model: model.name,
      total: total || Object.values(trimCounts).reduce((a,b) => a+b, 0),
      trimCounts,
      vehicles,
      vehiclesByTrim
    };
  } catch (err) {
    console.error(`[inventory] HTML fallback error for ${model.name}:`, err.message);
    return { model: model.name, total: 0, trimCounts: {}, vehicles: [], vehiclesByTrim: {} };
  }
}

// ── Fetch a model using best available method ──────────────────────────────
async function fetchModel(model) {
  // Run filter API (accurate counts) and HTML scrape (individual vehicles) in parallel
  const [filterResult, htmlResult] = await Promise.all([
    fetchModelTrims(model),
    fetchModelFromHTML(model)
  ]);

  // Filter API gives us the most accurate trim counts
  // HTML scrape gives us individual vehicle records (color, cab, drivetrain)
  const trimCounts = Object.keys(filterResult.trimCounts).length > 0
    ? filterResult.trimCounts
    : htmlResult.trimCounts;

  const total = filterResult.total || htmlResult.total;

  // Use vehicle records from HTML if we got them
  const vehiclesByTrim = htmlResult.vehiclesByTrim || {};
  const vehicles = htmlResult.vehicles || [];

  console.log(`[inventory] ${model.name}: total=${total}, trimCounts=${JSON.stringify(trimCounts)}, vehicles=${vehicles.length}`);

  return { model: model.name, total, trimCounts, vehicles, vehiclesByTrim };
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
      headers: { ...RESP_HEADERS, 'Cache-Control': 'no-cache' },
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
