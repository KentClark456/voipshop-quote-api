// api/send-sla.js
import { buildSlaPdfBuffer } from '../services/buildSlaPdfBuffer.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Only POST allowed');
    return;
  }

  try {
    const checkout = req.body || {};

    const services = [
      { name: 'Cloud PBX', qty: checkout.monthly?.cloudPbxQty ?? 1 },
      { name: 'Extensions', qty: checkout.monthly?.extensions ?? 3 },
      { name: 'Geographic Number (DID)', qty: checkout.monthly?.didQty ?? 1 },
      { name: 'Voice Minutes (bundle)', qty: checkout.monthly?.minutes ?? 250, unit: 'min' },
    ];

    const debitOrder = {
      accountName:  checkout.debit?.accountName,
      bank:         checkout.debit?.bank,
      branchCode:   checkout.debit?.branchCode,
      accountNumber:checkout.debit?.accountNumber,
      accountType:  checkout.debit?.accountType,
      dayOfMonth:   checkout.debit?.dayOfMonth,
      mandateDateISO: new Date().toISOString().slice(0,10),
    };

    const pdf = await buildSlaPdfBuffer({
      company: {
        name: 'VoIP Shop',
        reg: '2025/406791/07',
        vat: '***',
        address: '23 Lombardy Road, Broadacres, Johannesburg',
        phone: '+27 68 351 0074',
        email: 'sales@voipshop.co.za',
        website: 'https://voipshop.co.za',
        logoUrl: 'https://voipshop.co.za/Assets/Group%201642logo%20(1).png'
      },
      customer: {
        name:    checkout.customer?.company || checkout.customer?.name,
        contact: checkout.customer?.contact,
        email:   checkout.customer?.email,
        phone:   checkout.customer?.phone,
        address: checkout.customer?.address,
        reg:     checkout.customer?.reg,
        vat:     checkout.customer?.vat
      },
      slaNumber:        checkout.slaNumber,
      effectiveDateISO: checkout.effectiveDate,
      noticeDays: 30,
      monthlyExVat:   checkout.monthly?.totals?.exVat,
      monthlyInclVat: checkout.monthly?.totals?.inclVat,
      vatRate: 0.15,
      services,
      debitOrder,
      serviceDescription: 'Hosted PBX (incl. porting, device provisioning, remote support)'
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${checkout.slaNumber || 'SLA'}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating SLA PDF');
  }
}
