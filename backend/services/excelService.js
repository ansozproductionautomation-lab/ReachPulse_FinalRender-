const ExcelJS = require('exceljs');

// Cells starting with = or @ could be read as a formula by some spreadsheet tools.
function safe(value) {
  const textValue = String(value ?? '');
  return /^[=@]/.test(textValue) ? `'${textValue}` : textValue;
}

// customers: plain objects (use .lean() on the Mongoose query).
async function generateCustomerExcel(customers) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ReachPulse';

  const sheet = workbook.addWorksheet('Shopify Customers');

  sheet.columns = [
    { header: 'Customer Name', key: 'name', width: 25 },
    { header: 'Phone Number', key: 'phone', width: 18 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Last Order No.', key: 'lastOrderNumber', width: 16 },
    { header: 'Product', key: 'productName', width: 32 },
    { header: 'Amount', key: 'totalAmount', width: 12 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Payment Status', key: 'paymentStatus', width: 16 },
    { header: 'City', key: 'city', width: 18 },
    { header: 'State', key: 'state', width: 18 },
    { header: 'Pincode', key: 'pincode', width: 12 },
    { header: 'Last Order Date', key: 'lastOrderDate', width: 20 },
    { header: 'First Order Date', key: 'firstOrderDate', width: 20 },
    { header: 'Order Count', key: 'orderCount', width: 12 },
    { header: 'WhatsApp Opt-in', key: 'whatsappOptIn', width: 16 },
    { header: 'Template Status', key: 'templateStatus', width: 16 },
    { header: 'Template Name', key: 'templateName', width: 24 },
    { header: 'Message Sent At', key: 'messageSentAt', width: 20 },
  ];

  for (const c of customers) {
    sheet.addRow({
      name: safe(c.name),
      phone: c.phone ? `+${c.phone}` : '',
      email: safe(c.email),
      lastOrderNumber: safe(c.lastOrderNumber),
      productName: safe(c.productName),
      totalAmount: c.totalAmount ?? 0,
      currency: c.currency || '',
      paymentStatus: c.paymentStatus || '',
      city: safe(c.city),
      state: safe(c.state),
      pincode: c.pincode || '',
      lastOrderDate: c.lastOrderDate ? new Date(c.lastOrderDate) : null,
      firstOrderDate: c.firstOrderDate ? new Date(c.firstOrderDate) : null,
      orderCount: c.orderCount ?? 1,
      whatsappOptIn: c.whatsappOptIn ? 'Yes' : 'No',
      templateStatus: c.templateStatus || 'Pending',
      templateName: safe(c.templateName),
      messageSentAt: c.messageSentAt ? new Date(c.messageSentAt) : null,
    });
  }

  sheet.getColumn('phone').numFmt = '@';
  sheet.getColumn('pincode').numFmt = '@';
  for (const key of ['lastOrderDate', 'firstOrderDate', 'messageSentAt']) {
    sheet.getColumn(key).numFmt = 'dd-mmm-yyyy hh:mm';
  }

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'R1' };

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateCustomerExcel };