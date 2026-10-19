// ════════════════════════════════════════════════════════
//  Crystal AI — Hot Lead Alert Function
//  Fires when lead score hits 70+
//  Sends SMS via Twilio + email fallback
//
//  Required Netlify environment variables:
//    TWILIO_ACCOUNT_SID   — from console.twilio.com
//    TWILIO_AUTH_TOKEN    — from console.twilio.com
//    TWILIO_FROM_NUMBER   — your Twilio phone number (e.g. +18005551234)
//    ALERT_PHONE_NUMBER   — salesperson's cell to receive alerts (e.g. +18605551234)
//    ALERT_EMAIL          — optional backup email
// ════════════════════════════════════════════════════════

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  let lead;
  try {
    lead = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: 'Invalid JSON' };
  }

  // Build the alert message
  const score = lead.score || 0;
  const emoji = score >= 90 ? '🔥🔥🔥' : score >= 80 ? '🔥🔥' : '🔥';
  const biz = lead.businessHours ? '(IN HOURS — call now!)' : '(after hours — follow up ASAP)';

  const msg = [
    `${emoji} CRYSTAL HOT LEAD — ${score}% ${biz}`,
    `Name: ${lead.name || 'Not given'}`,
    `Phone: ${lead.phone || 'Not given'}`,
    `Email: ${lead.email || 'Not given'}`,
    `Vehicle: ${lead.vehicle || 'Not specified'}`,
    `Budget: ${lead.budget || 'Not specified'}`,
    `Finance: ${lead.finance || 'Not specified'}`,
    `Trade-in: ${lead.tradein || 'None'}`,
    `Timeline: ${lead.timeline || 'Not specified'}`,
    `Appt: ${lead.appt || 'Not booked yet'}`,
    `Msgs: ${lead.conversationLength || 0} exchanges`
  ].join('\n');

  // ── Twilio SMS ──────────────────────────────────────────
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;
  const to    = process.env.ALERT_PHONE_NUMBER;

  let smsResult = 'skipped (Twilio not configured)';

  if (sid && token && from && to) {
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const body = new URLSearchParams({ From: from, To: to, Body: msg });
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });
      const data = await resp.json();
      smsResult = data.sid ? `sent (${data.sid})` : `error: ${data.message}`;
    } catch (err) {
      smsResult = `error: ${err.message}`;
    }
  }

  console.log(`[Crystal hot-lead] score=${score} name="${lead.name}" sms=${smsResult}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, sms: smsResult })
  };
};
