// ════════════════════════════════════════════════════════
//  Crystal AI — Hot Lead Alert Function
//  Fires when lead score hits 70+
//  Sends SMS via Twilio + ADF/XML email via Resend
//
//  Required Netlify environment variables:
//    TWILIO_ACCOUNT_SID   — from console.twilio.com
//    TWILIO_AUTH_TOKEN    — from console.twilio.com
//    TWILIO_FROM_NUMBER   — your Twilio phone number (e.g. +18005551234)
//    ALERT_PHONE_NUMBER   — salesperson's cell to receive alerts
//    RESEND_API_KEY       — from resend.com
//    LEAD_EMAIL           — email to receive ADF leads (your email for testing,
//                           swap for dealership's eLEADS intake address when live)
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

  const score = lead.score || 0;
  const emoji = score >= 90 ? '🔥🔥🔥' : score >= 80 ? '🔥🔥' : '🔥';

  // ── Twilio SMS ──────────────────────────────────────────
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;
  const to    = process.env.ALERT_PHONE_NUMBER;

  const smsMsg = `${emoji} HOT LEAD ${score}% ${lead.businessHours ? '(CALL NOW)' : '(after hrs)'} | ${lead.name || 'Unknown'} | ${lead.phone || 'No phone'} | ${lead.vehicle || 'No vehicle'} | Timeline: ${lead.timeline || '?'}`;

  let smsResult = 'skipped (Twilio not configured)';

  if (sid && token && from && to) {
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const body = new URLSearchParams({ From: from, To: to, Body: smsMsg });
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
      const data = await resp.json();
      smsResult = data.sid ? `sent (${data.sid})` : `error: ${data.message}`;
    } catch (err) {
      smsResult = `error: ${err.message}`;
    }
  }

  // ── ADF/XML email via Resend ────────────────────────────
  const resendKey = process.env.RESEND_API_KEY;
  const leadEmail = process.env.LEAD_EMAIL;

  let emailResult = 'skipped (Resend not configured)';

  if (resendKey && leadEmail) {
    // Build ADF/XML — the auto industry standard lead format
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const adf = `<?xml version="1.0" encoding="UTF-8"?>
<?adf version="1.0"?>
<adf>
  <prospect>
    <requestdate>${now}</requestdate>
    <vehicle interest="buy" status="used">
      <year></year>
      <make>Ford</make>
      <model>${(lead.vehicle || '').replace(/[<>]/g, '')}</model>
      <trim></trim>
    </vehicle>
    <customer>
      <contact>
        <name part="full">${(lead.name || 'Unknown').replace(/[<>]/g, '')}</name>
        <phone>${(lead.phone || '').replace(/[<>]/g, '')}</phone>
        <email>${(lead.email || '').replace(/[<>]/g, '')}</email>
      </contact>
      <comments>Crystal AI Lead — Score: ${score}%
Vehicle Interest: ${lead.vehicle || 'Not specified'}
Budget: ${lead.budget || 'Not specified'}
Finance: ${lead.finance || 'Not specified'}
Trade-in: ${lead.tradein || 'None'}
Timeline: ${lead.timeline || 'Not specified'}
Appointment: ${lead.appt || 'Not booked'}
Messages exchanged: ${lead.conversationLength || 0}</comments>
    </customer>
    <vendor>
      <vendorname>Whaling City Ford</vendorname>
      <contact>
        <name part="full">Crystal AI</name>
        <email>crystal@whalingcityford.com</email>
      </contact>
    </vendor>
    <provider>
      <name>Crystal AI</name>
      <service>Chat Lead</service>
    </provider>
  </prospect>
</adf>`;

    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Crystal AI <onboarding@resend.dev>',
          to: [leadEmail],
          subject: `${emoji} Crystal Hot Lead — ${lead.name || 'Unknown'} | ${score}% | ${lead.vehicle || 'No vehicle'}`,
          text: adf,
          attachments: [{
            filename: 'lead.adf.xml',
            content: Buffer.from(adf).toString('base64')
          }]
        })
      });
      const data = await resp.json();
      emailResult = data.id ? `sent (${data.id})` : `error: ${JSON.stringify(data)}`;
    } catch (err) {
      emailResult = `error: ${err.message}`;
    }
  }

  console.log(`[Crystal hot-lead] score=${score} name="${lead.name}" sms=${smsResult} email=${emailResult}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, sms: smsResult, email: emailResult })
  };
};
