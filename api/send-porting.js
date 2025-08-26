// api/send-porting.js
import { Resend } from 'resend';
import PDFDocument from 'pdfkit';
import https from 'https';

const resend = new Resend(process.env.RESEND_API_KEY);

// Simple HTTPS buffer fetcher (works on Vercel functions)
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    if (!url) return resolve(null);
    https.get(url, (res) => {
      const data = [];
      res.on('data', (d) => data.push(d));
      res.on('end', () => resolve(Buffer.concat(data)));
    }).on('error', reject);
  });
}

/* ========== PORTING LETTER OF AUTHORITY (PDFKit) ========== */
async function buildPortingPdfBuffer({ company = {}, client = {}, port = {} }) {
  const doc = new PDFDocument({ size: 'A4', margin: 42 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const gray600 = '#4b5563';
  const gray300 = '#d1d5db';
  const band = '#f3f4f6';

  let y = 42;
  const logoBuf = company.logoUrl ? await fetchBuffer(company.logoUrl) : null;
  if (logoBuf) { try { doc.image(logoBuf, 42, y, { width: 110 }); } catch {} }
  doc.font('Helvetica-Bold').fontSize(14).text('NON GEOGRAPHIC AND GEOGRAPHIC NUMBER PORTING REQUEST FORM', 0, y, { align: 'right' });
  y += 26;

  doc.font('Helvetica').fontSize(10).fillColor(gray600)
    .text(`This request form authorises ${company.name || 'VoIP Shop'} to request that the service and current telephone number(s) specified below be transferred to ${company.name || 'VoIP Shop'}.`,
      42, y, { width: 511, lineGap: 2 });
  doc.fillColor('black'); y = doc.y + 12;

  doc.moveTo(42, y).lineTo(553, y).strokeColor(gray300).stroke(); y += 12;

  const kv = (label, value = '') => {
    const wL = 260, wV = 511 - wL - 8, vX = 42 + wL + 8;
    doc.font('Helvetica-Bold').fontSize(10).text(label, 42, y, { width: wL });
    doc.font('Helvetica').fontSize(10).fillColor(gray600).text(String(value || '_____________________________'), vX, y, { width: wV });
    doc.fillColor('black'); y = doc.y + 10;
  };
  const note = (t) => { doc.font('Helvetica').fontSize(9).fillColor(gray600).text(t, 42, y, { width: 511 }); doc.fillColor('black'); y = doc.y + 8; };

  kv('Subscriber Name', client.company || client.name || '');
  kv('Name & designation of person authorised to make this request if subscriber is a company', port.authorisedName ? `${port.authorisedName}${port.authorisedTitle ? ' — ' + port.authorisedTitle : ''}` : '');
  kv('Contact Number', port.contactNumber || client.phone || '');
  kv('South African Identity / Passport Number', port.idNumber || '');
  kv('Present Service Provider', port.provider || '');
  kv('Present Service Provider — Account Number', port.accountNumber || '');
  note('Please attach a copy of your latest invoice to confirm numbers and account status');

  kv('Service Address', port.serviceAddress || client.address || '');
  kv('Geographical Numbers to be ported', (Array.isArray(port.numbers) && port.numbers.length) ? port.numbers.join(', ') : '');
  kv('PBX Location', port.pbxLocation || '');
  note('Please ensure that none of the above mentioned numbers are linked to any video conferencing services nor are they the target number for any 0800 or 086 service.');

  y += 6;
  doc.save().rect(42, y, 511, 18).fill(band).restore();
  doc.font('Helvetica-Bold').fontSize(11).text('Declaration', 48, y + 4);
  y += 26;

  const decl = [
    `${company.name || 'VoIP Shop'} is hereby authorised to request that my present service provider port the above numbers to ${company.name || 'VoIP Shop'}. I am duly authorised to make this request and to the best of my knowledge the above information is correct.`,
    'I acknowledge that the subscriber shall remain liable in terms of any contract with the present service provider for so long as it remains in force.',
    'Credits and discounts afforded to the subscriber by the present service provider are not transferrable.',
    'I have been advised of the porting costs and the subscriber agrees to be liable for such costs.'
  ];
  doc.font('Helvetica').fontSize(10).fillColor(gray600);
  for (let i = 0; i < decl.length; i++) {
    doc.text(`${i + 1}. ${decl[i]}`, 42, y, { width: 511, lineGap: 2 });
    y = doc.y + 6;
  }
  doc.fillColor('black');

  y += 8;
  const drawLine = (label, w = 200) => {
    doc.font('Helvetica').fontSize(10).text(label, 42, y + 2);
    doc.moveTo(42 + 70, y + 8).lineTo(42 + 70 + w, y + 8).strokeColor(gray300).stroke();
  };
  drawLine('Sign:', 220);
  doc.text('', 0, y);
  y += 20;
  drawLine('Date:', 130);

  // Page 2: letter
  doc.addPage();
  y = 42;
  if (logoBuf) { try { doc.image(logoBuf, 42, y, { width: 110 }); } catch {} }
  doc.font('Helvetica-Bold').fontSize(14).text('Porting — To whom it may concern', 0, y, { align: 'right' });
  y += 28;
  doc.moveTo(42, y).lineTo(553, y).strokeColor(gray300).stroke(); y += 14;

  const para = (txt) => { doc.font('Helvetica').fontSize(10).fillColor(gray600).text(txt, 42, y, { width: 511, lineGap: 2 }); y = doc.y + 10; doc.fillColor('black'); };

  para(`I, _______________________________________ hereby give permission to ${company.name || '(new service provider)'} to port the following numbers from the current service provider.`);
  para(`Current service provider Account No: ${port.accountNumber || '_______________________________'}`);
  para(`The number/number range(s) we want ported is/are: ${(Array.isArray(port.numbers) && port.numbers.length) ? port.numbers.join(', ') : '_______________________________'}.`);
  para('We acknowledge that any numbers in the range that are not ported will be lost and cannot be recovered.');
  para('We acknowledge that ADSL functionality linked to the number being ported may be lost after porting.');
  para('We acknowledge that if we have any other subscriptions (e.g. switchboard or other services) we no longer need, we have to directly contact our current Service Provider AFTER porting has been completed, and instruct them to cancel the subscriptions/services.');
  para('Kind regards,');

  y += 6;
  drawLine('Sign:', 220);
  y += 22;
  drawLine('Full Name:', 260);
  y += 22;
  drawLine('Designation:', 180);

  doc.end();
  return done;
}

/* ============================ HANDLER ============================ */
export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  const acrh   = req.headers['access-control-request-headers'] || '';
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', acrh || 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const body = req.body || {};
    const {
      company = {
        name: 'VoIP Shop',
        logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png'
      },
      client = {},                 // { name, company, email, phone, address }
      port = {}                    // { provider, accountNumber, numbers[], serviceAddress, pbxLocation, contactNumber, idNumber, authorisedName, authorisedTitle }
    } = body;

    if (!client?.email) return res.status(400).send('Missing client email.');

    // 1) Build Porting LOA PDF
    const portingPdf = await buildPortingPdfBuffer({ company, client, port });

    // 2) Email LOA only
    const { error, data } = await resend.emails.send({
      from: 'sales@voipshop.co.za',
      to: client.email,
      reply_to: 'sales@voipshop.co.za',
      subject: `Porting Letter of Authority • ${client.company || client.name || ''}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial;color:#111;max-width:560px;margin:0 auto;padding:24px;">
          <div style="text-align:center;margin-bottom:16px;">
            ${company.logoUrl ? `<img src="${company.logoUrl}" alt="${company.name}" style="height:36px;">` : ''}
          </div>
          <p>Hi ${client.name || 'there'},</p>
          <p>Your <strong>Porting Letter of Authority</strong> is attached. Please sign and return it to proceed with number porting.</p>
          <p>— ${company.name} Team</p>
        </div>`,
      attachments: [
        { filename: `Porting-Letter-of-Authority.pdf`, content: portingPdf.toString('base64'), contentType: 'application/pdf' }
      ]
    });
    if (error) throw error;

    return res.status(200).json({ ok: true, id: data?.id, attached: { porting: true } });
  } catch (err) {
    console.error('send-porting error', err);
    return res.status(500).send(String(err?.message || err) || 'Failed to create/send porting LOA.');
  }
}
