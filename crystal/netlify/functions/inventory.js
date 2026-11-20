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
async function fetchModelFromHTML(model, trimFilter = '') {
  const urlSlug = model.slug.toLowerCase().replace(/ /g, '-');
  const trimParam = trimFilter ? `&trims=${encodeURIComponent(trimFilter)}` : '';
  const url = `${BASE}/inventory/new/ford/${urlSlug}?paymenttype=cash&instock=true&sorttype=priceltoh${trimParam}`;
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

    // ── Find VINs anywhere in the HTML, then extract surrounding context ────────
    // VINs appear in href URLs like /details/2026/1FTEW2LP6TFB98044/ and in
    // data attributes, script blocks, etc. This approach is format-agnostic.
    if (vehicles.length === 0) {
      const vinRegex = /[A-HJ-NPR-Z0-9]{17}/g;
      const seenVins = new Set();
      let m;
      while ((m = vinRegex.exec(html)) !== null) {
        const vin = m[0];
        if (seenVins.has(vin)) continue;
        // Basic VIN validation: must start with a letter/digit that's valid for VINs
        // (VINs exclude I, O, Q — already excluded by the character class above)
        // Accept 1=USA, 2=Canada, 3=Mexico, W=Germany and others; just exclude obvious non-VINs
        if (!/^[A-HJ-NPR-Z0-9][A-HJ-NPR-Z0-9]/.test(vin)) continue;
        seenVins.add(vin);

        // Grab 1500 chars of context around the VIN
        const start = Math.max(0, m.index - 200);
        const end   = Math.min(html.length, m.index + 1300);
        const block = html.slice(start, end);

        // Trim — look for known trim names near the VIN
        // Order matters: longer/more-specific names MUST come before shorter ones they contain.
        // "Sport" excluded — it's the Bronco Sport model name, not a trim level.
        // "ST" comes AFTER "ST-Line Select" and "ST-Line" so the longer forms match first.
        const TRIM_NAMES = 'Lariat|King Ranch|Platinum|Limited|Raptor R|Raptor|Tremor|STX|XLT|XL|Big Bend|Outer Banks|Badlands|Heritage Limited|Heritage|First Edition|Active|ST-Line Select|ST-Line|ST|Titanium|GT Premium|Dark Horse|Mach 1|EcoBoost Premium|EcoBoost|Select|Timberline|Base|Lobo High|Lobo Standard|Wildtrak|Pro|Premium';
        const trimM = block.match(new RegExp(`\\b(${TRIM_NAMES})\\b`, 'i'));
        const trim = trimM ? trimM[1] : '';

        // Year
        const yearM = block.match(/\b(202[3-9]|203\d)\b/);
        const year = yearM ? parseInt(yearM[1]) : 2026;

        // Price — look for $XX,XXX or plain 5-digit number near "price"
        const priceM = block.match(/\$\s*([0-9]{2,3},[0-9]{3})/) ||
                       block.match(/[Pp]rice[^0-9]{0,20}([4-9][0-9]{4})/);
        const price = priceM ? parseInt(priceM[1].replace(/,/g,'')) : 0;

        // Color
        const colorM = block.match(/(?:Ext(?:erior)?|Color)[^A-Za-z]{0,15}([A-Z][a-zA-Z ]{3,25})/) ||
                       block.match(/"(?:ext(?:erior)?[Cc]olor|[Ee]xt[Cc]olor)"\s*:\s*"([^"]{3,30})"/i);
        const extColor = colorM ? colorM[1].trim() : '';

        // Cab style
        const cabM = block.match(/\b(SuperCrew|SuperCab|Regular Cab|Crew Cab|Extended Cab|4-Door|2-Door)\b/i);
        const cabStyle = cabM ? cabM[1] : '';

        // Drivetrain
        const driveM = block.match(/\b(4x4|4x2|4WD|AWD|RWD|FWD|2WD)\b/i);
        const driveType = driveM ? driveM[1].toUpperCase() : '';

        // Include vehicle even without a matched trim — count still valid, trim can be inferred later
        vehicles.push({ vin, trim, year, price, extColor, cabStyle, driveType, stock: '' });
      }
      console.log(`[inventory] ${model.name} VIN scrape: ${vehicles.length} vehicles found (${seenVins.size} unique VINs scanned)`);
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
  // Step 1: Get accurate counts from filter API (fast, always works)
  const filterResult = await fetchModelTrims(model);
  const total = filterResult.total || 0;
  const trimCounts = filterResult.trimCounts;

  // Step 2: Fetch one HTML page per trim.
  // The dealer's server ignores ?start=N and always returns ~11 vehicles per page.
  // Sort-order tricks give partial overlap. The reliable fix: filter by trim so each
  // fetch returns only that trim's vehicles (Bronco Badlands: 6, never >11).
  // e.g. Bronco: 4 trims × 1 fetch = 4 requests → all 22 Broncos
  const trims = Object.keys(trimCounts);
  console.log(`[inventory] ${model.name}: total=${total}, fetching ${trims.length} trim(s): ${trims.join(', ')}`);
  const htmlPages = await Promise.all(trims.map(trim => fetchModelFromHTML(model, trim)));

  // Step 3: Merge vehicles from all trim fetches, dedup by VIN
  const seenVins = new Set();
  const vehicles = [];
  for (const page of htmlPages) {
    for (const v of page.vehicles) {
      if (v.vin && seenVins.has(v.vin)) continue;
      if (v.vin) seenVins.add(v.vin);
      vehicles.push(v);
    }
  }

  // Step 5: Group by trim for the frontend card builder
  const vehiclesByTrim = {};
  for (const v of vehicles) {
    if (!v.trim) continue;
    if (!vehiclesByTrim[v.trim]) vehiclesByTrim[v.trim] = [];
    vehiclesByTrim[v.trim].push(v);
  }

  console.log(`[inventory] ${model.name}: trimCounts=${JSON.stringify(trimCounts)}, vehicles=${vehicles.length}/${total}`);
  return { model: model.name, total, trimCounts, vehicles, vehiclesByTrim };
}

// ── Used inventory — multi-sort pass to beat the ~11-vehicle server cap ─────
// The dealer's server ignores ?start=N but DOES respect ?sorttype=X.
// We fetch with different sorts in parallel and merge unique vehicles.
// Order of SORTS matters: first sort's vehicles appear first in results,
// so "newtoold" (most recently added = most featured) becomes the default
// ranking Crystal uses when picking the top 4 to show.
async function fetchUsed() {
  // ── Strategy 1: Dealer.com JSON API (same pattern as new inventory) ──────────
  // This gives us explicit Odometer/Mileage fields — far more reliable than HTML scraping.
  const API_URLS = [
    `${BASE}/api/Inventory/getinventory?${new URLSearchParams({
      Type: 'Used', PaymentType: 'cash', SortType: 'priceltoh',
      InStock: 'true', PageSize: '150', PageNumber: '1',
      SourceFrom: 'inventorycontroller'
    })}`,
    `${BASE}/api/Inventory/getinventory?${new URLSearchParams({
      Type: 'Used', PaymentType: 'cash', SortType: 'priceltoh',
      InStock: 'true', PageSize: '150', start: '0',
      accountId: ACCOUNT_ID
    })}`,
    `${BASE}/api/Inventory/GetInventoryList?${new URLSearchParams({
      Type: 'Used', PaymentType: 'cash', SortType: 'priceltoh',
      InStock: 'true', PageSize: '150', PageNumber: '1'
    })}`,
  ];

  for (const url of API_URLS) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': BASE }
      });
      if (!res.ok) { console.log(`[inventory] used API ${res.status}: ${url.split('?')[0]}`); continue; }
      const data = await res.json();
      const rawVehicles = data.Vehicles || data.vehicles || data.Items || data.items ||
                          data.Inventory || data.inventory || data.Results || data.results ||
                          data.VehicleList || data.vehicleList || data.Data || data.data || [];
      if (!Array.isArray(rawVehicles) || rawVehicles.length === 0) {
        console.log(`[inventory] used API no vehicles at ${url.split('?')[0]}, keys:`, Object.keys(data).join(', '));
        continue;
      }
      console.log(`[inventory] used API: ${rawVehicles.length} vehicles, fields:`, Object.keys(rawVehicles[0]||{}).slice(0,12).join(', '));
      const vehicles = rawVehicles.map(v => {
        const rawMiles = v.Odometer || v.odometer || v.Mileage || v.mileage || v.Miles || v.miles || v.OdometerReading || v.odometerReading || null;
        const miles = rawMiles != null ? parseInt(String(rawMiles).replace(/[^0-9]/g, '')) || null : null;
        const price = parseInt(String(v.Price || v.price || v.ListPrice || v.listPrice || v.MSRP || v.Msrp || 0).replace(/[^0-9]/g, ''));
        const year  = v.Year || v.year || '';
        const make  = v.Make || v.make || v.Brand || v.brand || 'Ford';
        const model = `${v.Model || v.model || ''} ${v.Trim || v.trim || ''}`.trim();
        if (!model || price < 3000 || price > 150000) return null;
        return {
          year: String(year), make, model,
          price: `$${price.toLocaleString()}`,
          miles: (miles && miles > 100 && miles < 300000) ? miles : null,
          type: (v.Type || v.type || '').toLowerCase().includes('cpo') ? 'cpo' : 'used',
          popular: false
        };
      }).filter(Boolean);
      console.log(`[inventory] fetchUsed (API): ${vehicles.length} used vehicles, miles sample:`, vehicles.slice(0,3).map(v=>`${v.model}=${v.miles}`).join(', '));
      return vehicles;
    } catch (err) {
      console.error(`[inventory] used API error:`, err.message);
    }
  }

  // ── Strategy 2: HTML scrape fallback ─────────────────────────────────────────
  // Used when the JSON API doesn't work. Scrapes the dealer's used inventory page.
  // Mileage is embedded in each card's structured markup.
  console.log('[inventory] falling back to HTML scrape for used inventory');
  const SORT_URLS = [
    `${BASE}/used-inventory/index.htm`,
    `${BASE}/used-inventory/index.htm?sorttype=priceltoh`,
    `${BASE}/used-inventory/index.htm?sorttype=pricehtol`,
    `${BASE}/used-inventory/index.htm?sorttype=newtoold`,
  ];

  const pages = await Promise.all(SORT_URLS.map(async (url) => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': BASE } });
      return await res.text();
    } catch (err) {
      console.error(`[inventory] fetchUsed HTML error for ${url}:`, err.message);
      return '';
    }
  }));

  const MAKES = 'Chevrolet|Ford|Toyota|Honda|Jeep|RAM|Ram|Subaru|Nissan|Dodge|Lincoln|Lexus|Hyundai|Kia|BMW|Mercedes|Volvo|GMC|Buick|Cadillac|Mazda';
  const pattern = new RegExp(
    `(\\d{4})\\s+(${MAKES})\\s+([\\w][\\w\\s\\-]{1,40}?)\\s+(?:Your Price|Whaling City Price)?\\s*\\$([0-9,]+)`, 'gi'
  );
  // Look for mileage in a wider window (600 chars) both before and after each vehicle match
  const milesPattern = /\b([\d,]{4,7})\s*(?:mi(?:les?)?)\b/gi;

  const seenKeys = new Set();
  const vehicles = [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const isDefaultSort = pageIdx === 0;
    const html = pages[pageIdx];
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const year = parseInt(m[1]);
      if (year < 2010 || year > 2028) continue;
      const price = parseInt(m[4].replace(/,/g, ''));
      if (price < 3000 || price > 150000) continue;
      const model = m[3].trim().replace(/\s+/g, ' ').replace(/\s*(Whaling City Price|Your Price)\s*/gi, '').trim();
      if (model.length < 2) continue;
      const key = `${year}-${m[2]}-${model}-${price}`;
      if (!seenKeys.has(key) && vehicles.length < 120) {
        seenKeys.add(key);
        // Search 600 chars forward AND 200 chars backward for mileage
        const start = Math.max(0, m.index - 200);
        const snippet = text.slice(start, m.index + 600);
        let miles = null;
        milesPattern.lastIndex = 0;
        let milesMatch;
        while ((milesMatch = milesPattern.exec(snippet)) !== null) {
          const candidate = parseInt(milesMatch[1].replace(/,/g, ''));
          if (candidate > 100 && candidate < 300000 && (candidate < 2010 || candidate > 2028)
              && candidate !== price) {
            miles = candidate;
            break;
          }
        }
        vehicles.push({ year: m[1], make: m[2], model, price: `$${m[4]}`, miles, type: 'used', popular: isDefaultSort });
      }
    }
  }

  console.log(`[inventory] fetchUsed (HTML): ${vehicles.length} unique vehicles, miles sample:`, vehicles.slice(0,3).map(v=>`${v.model}=${v.miles}`).join(', '));
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
