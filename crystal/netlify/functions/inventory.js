// ════════════════════════════════════════════════════════
//  Crystal AI — Live Inventory Function (Puppeteer)
//  Uses a real headless browser so JavaScript executes
//  and ALL vehicles load — not just the pre-rendered ones
// ════════════════════════════════════════════════════════

const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

const RESP_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// New models to scrape
const NEW_MODELS = [
  { name: 'F-150',        slug: 'f-150'          },
  { name: 'Bronco',       slug: 'bronco'          },
  { name: 'Bronco Sport', slug: 'bronco-sport'    },
  { name: 'Explorer',     slug: 'explorer'        },
  { name: 'Maverick',     slug: 'maverick'        },
  { name: 'Ranger',       slug: 'ranger'          },
  { name: 'Mustang',      slug: 'mustang'         },
  { name: 'Mach-E',       slug: 'mustang-mach-e'  },
  { name: 'Expedition',   slug: 'expedition'      },
];

// Launch Puppeteer with @sparticuz/chromium (Lambda-compatible)
async function launchBrowser() {
  return puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 900 },
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
}

// Scrape all vehicles for one model — scrolls to load JS-rendered ones
async function scrapeModel(page, model) {
  const url = `https://www.whalingcityford.com/inventory/new/ford/${model.slug}?paymenttype=cash&instock=true`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Wait for at least one vehicle card to appear
    await page.waitForSelector('[class*="vehicle"], [class*="inventory"], [data-vin], [class*="listing"]', {
      timeout: 8000
    }).catch(() => {}); // don't throw if selector never found

    // Scroll to bottom to trigger lazy-loaded vehicles
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let totalHeight = 0;
        const distance = 400;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 150);
        // Safety timeout
        setTimeout(() => { clearInterval(timer); resolve(); }, 5000);
      });
    });

    // Wait a beat for any remaining async loads
    await new Promise(r => setTimeout(r, 1500));

    // Extract all vehicles from the page
    const result = await page.evaluate((modelName) => {
      // Total count from header
      let total = 0;
      const countEl = document.querySelector('[class*="result-count"], [class*="srp-count"], [class*="inventory-count"]');
      if (countEl) {
        const m = countEl.textContent.match(/(\d+)/);
        if (m) total = parseInt(m[1]);
      }
      // Fallback: find "Results: N Vehicles" anywhere
      if (!total) {
        const bodyText = document.body.innerText;
        const m = bodyText.match(/Results:\s*(\d+)\s*Vehicles?/i) || bodyText.match(/(\d+)\s*Vehicles?\s*Found/i);
        if (m) total = parseInt(m[1]);
      }

      // Gather all vehicle listings — try multiple selector patterns
      const vehicles = [];
      const seen = new Set();

      // Approach 1: elements with data-vin
      document.querySelectorAll('[data-vin]').forEach(el => {
        const vin = el.getAttribute('data-vin');
        if (seen.has(vin)) return;
        seen.add(vin);
        const text = el.innerText || '';
        const trimMatch = text.match(/\b(STX|XL\b|XLT|Lariat|King Ranch|Platinum|Limited|Raptor R\b|Raptor\b|Tremor|Black\b|Base|Big Bend|Outer Banks|Badlands|Heritage Limited|Heritage|First Edition|Active|ST-Line Select|ST-Line|Titanium|Sport|Dark Horse|Mach 1|EcoBoost Premium|EcoBoost\b|Select|Pro\b|Timberline)\b/i);
        const priceMatch = text.match(/\$([0-9,]{4,8})/);
        if (trimMatch) {
          vehicles.push({
            trim: trimMatch[1],
            price: priceMatch ? `$${priceMatch[1]}` : null,
            vin
          });
        }
      });

      // Approach 2: vehicle card containers
      if (vehicles.length === 0) {
        const cards = document.querySelectorAll('[class*="vehicle-card"], [class*="srp-list-item"], [class*="inventory-listing"]');
        cards.forEach(card => {
          const text = card.innerText || '';
          const trimMatch = text.match(/\b(STX|XL\b|XLT|Lariat|King Ranch|Platinum|Limited|Raptor R\b|Raptor\b|Tremor|Black\b|Base|Big Bend|Outer Banks|Badlands|Heritage Limited|Heritage|First Edition|Active|ST-Line Select|ST-Line|Titanium|Sport|Dark Horse|Mach 1|EcoBoost Premium|EcoBoost\b|Select|Pro\b|Timberline)\b/i);
          const priceMatch = text.match(/\$([0-9,]{4,8})/);
          if (trimMatch && priceMatch) {
            const key = `${trimMatch[1]}-${priceMatch[1]}`;
            if (!seen.has(key)) {
              seen.add(key);
              vehicles.push({ trim: trimMatch[1], price: `$${priceMatch[1]}` });
            }
          }
        });
      }

      // Approach 3: broad text scan for "Year Ford Model Trim $Price" patterns
      if (vehicles.length === 0) {
        const allText = document.body.innerText;
        const pattern = /20[0-9]{2}\s+Ford\s+[\w\s\-]+?\s+(STX|XL\b|XLT|Lariat|King Ranch|Platinum|Limited|Raptor R?|Tremor|Big Bend|Outer Banks|Badlands|Heritage Limited|Heritage|Base|ST-Line Select|ST-Line|Titanium|Sport|Dark Horse|Select|Timberline)\b[^\n]*\$([0-9,]{4,8})/gi;
        let m;
        while ((m = pattern.exec(allText)) !== null) {
          const key = `${m[1]}-${m[2]}`;
          if (!seen.has(key)) {
            seen.add(key);
            vehicles.push({ trim: m[1], price: `$${m[2]}` });
          }
        }
      }

      // Starting price
      let startingPrice = null;
      if (vehicles.length > 0) {
        const prices = vehicles.map(v => parseInt((v.price || '$0').replace(/[$,]/g, ''))).filter(p => p > 0);
        if (prices.length) startingPrice = `$${Math.min(...prices).toLocaleString()}`;
      }

      // Trim counts
      const trimCounts = {};
      vehicles.forEach(v => {
        const t = v.trim;
        trimCounts[t] = (trimCounts[t] || 0) + 1;
      });

      return { total: total || vehicles.length, vehicles, trimCounts, startingPrice };
    }, model.name);

    console.log(`[inventory] ${model.name}: ${result.vehicles.length} vehicles found (total: ${result.total})`);
    return { model: model.name, ...result, type: 'new' };
  } catch (err) {
    console.error(`[inventory] scrapeModel error for ${model.name}:`, err.message);
    return { model: model.name, total: 0, vehicles: [], trimCounts: {}, startingPrice: null, type: 'new' };
  }
}

// Scrape used inventory (plain fetch is fine — these pages are server-rendered)
async function fetchUsed() {
  const vehicles = [];
  const urls = [
    'https://www.whalingcityford.com/used-inventory/index.htm',
    'https://www.whalingcityford.com/used-inventory/index.htm?start=20',
    'https://www.whalingcityford.com/used-inventory/index.htm?start=40',
  ];
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: RESP_HEADERS, body: '' };
  }

  let browser;
  try {
    // Launch browser + start fetching used inventory at the same time
    const [browserInstance, usedVehicles] = await Promise.all([
      launchBrowser(),
      fetchUsed()
    ]);
    browser = browserInstance;

    // Scrape new models — reuse one page, navigate between models
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

    // Block images/fonts/css to speed up loading
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const newInventory = [];
    for (const model of NEW_MODELS) {
      const result = await scrapeModel(page, model);
      if (result.total > 0 || result.vehicles.length > 0) {
        newInventory.push(result);
      }
    }

    await browser.close();
    browser = null;

    const totalNewCount = newInventory.reduce((s, v) => s + (v.total || 0), 0);

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
          startingPrice: v.startingPrice,
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
    if (browser) await browser.close().catch(() => {});
    console.error('[inventory] handler error:', err);
    return {
      statusCode: 500,
      headers: RESP_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
