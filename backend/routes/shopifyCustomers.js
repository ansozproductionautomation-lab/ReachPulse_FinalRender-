const crypto = require('crypto');
const express = require('express');
const ShopifyCustomer = require('../models/ShopifyCustomer');
const { generateCustomerExcel } = require('../services/excelService');

const NEW_CUSTOMER_DAYS = 7;
const MAX_SEND_PER_REQUEST = 100;
const MAX_EXPORT_ROWS = 50000;
const STALE_PROCESSING_MS = 10 * 60 * 1000;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The app has no user login, so these endpoints (customer names, phones, emails)
// are protected with one admin key. Set SHOPIFY_CUSTOMERS_API_KEY in backend/.env.
// The browser sends it as:  Authorization: Bearer <key>
function requireAdminKey(req, res, next) {
  const secret = String(process.env.SHOPIFY_CUSTOMERS_API_KEY || '');

  if (!secret) {
    return res.status(503).json({
      success: false,
      error: 'Add SHOPIFY_CUSTOMERS_API_KEY to backend/.env first.',
    });
  }

  const given = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, error: 'Invalid admin key.' });
  }

  next();
}

function buildFilter(query) {
  const filter = {};

  if (query.shop) filter.shop = String(query.shop);

  const status = String(query.status || 'all').toLowerCase();
  if (status === 'new') {
    const days = Math.min(Math.max(Number(query.days) || NEW_CUSTOMER_DAYS, 1), 365);
    filter.createdAt = { $gte: new Date(Date.now() - days * 86400000) };
  } else if (status === 'pending') filter.templateStatus = 'Pending';
  else if (status === 'sent') filter.templateStatus = 'Sent';
  else if (status === 'failed') filter.templateStatus = 'Failed';

  const search = String(query.search || '').trim().slice(0, 80);
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }, { lastOrderNumber: rx }];
  }

  return filter;
}

// Fills the template variables for one customer.
// A variable can be plain text or a token: {{name}} {{orderNumber}} {{total}} {{product}} {{city}}
function fillVariable(raw, customer) {
  const values = {
    name: customer.name || 'there',
    orderNumber: customer.lastOrderNumber || '-',
    total: `${customer.totalAmount ?? 0} ${customer.currency || ''}`.trim(),
    product: customer.productName || '-',
    city: customer.city || '-',
  };

  return String(raw ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => values[key] ?? '');
}

// sendAutomationTemplate comes from server.js (the same sender the automatic
// order confirmation uses), so every message is stored in Message and shown in the Inbox.
module.exports = function createShopifyCustomersRouter({ sendAutomationTemplate, recordFailedMessage }) {
  const router = express.Router();

  router.use(requireAdminKey);

  // GET /api/shopify-customers?status=all|new|pending|sent|failed&search=&page=1&limit=50
  // /new and /pending are shortcuts for status=new and status=pending.
  const listCustomers = (forcedStatus) => async (req, res) => {
    try {
      const query = forcedStatus ? { ...req.query, status: forcedStatus } : req.query;
      const filter = buildFilter(query);
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
      const page = Math.max(Number(query.page) || 1, 1);

      const [customers, total] = await Promise.all([
        ShopifyCustomer.find(filter)
          .select('-processedOrderIds')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        ShopifyCustomer.countDocuments(filter),
      ]);

      res.json({ success: true, customers, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  };

  router.get('/', listCustomers());
  router.get('/new', listCustomers('new'));
  router.get('/pending', listCustomers('pending'));

  // GET /api/shopify-customers/stats
  router.get('/stats', async (req, res) => {
    try {
      const base = req.query.shop ? { shop: String(req.query.shop) } : {};
      const since = new Date(Date.now() - NEW_CUSTOMER_DAYS * 86400000);

      const [total, newCustomers, pending, sent, failed, optedIn] = await Promise.all([
        ShopifyCustomer.countDocuments(base),
        ShopifyCustomer.countDocuments({ ...base, createdAt: { $gte: since } }),
        ShopifyCustomer.countDocuments({ ...base, templateStatus: 'Pending' }),
        ShopifyCustomer.countDocuments({ ...base, templateStatus: 'Sent' }),
        ShopifyCustomer.countDocuments({ ...base, templateStatus: 'Failed' }),
        ShopifyCustomer.countDocuments({ ...base, whatsappOptIn: true }),
      ]);

      res.json({ success: true, stats: { total, new: newCustomers, pending, sent, failed, optedIn }, newDays: NEW_CUSTOMER_DAYS });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/shopify-customers/export?status=...&search=...  -> .xlsx download
  router.get('/export', async (req, res) => {
    try {
      const customers = await ShopifyCustomer.find(buildFilter(req.query))
        .select('-processedOrderIds')
        .sort({ createdAt: -1 })
        .limit(MAX_EXPORT_ROWS)
        .lean();

      const buffer = await generateCustomerExcel(customers);
      const stamp = new Date().toISOString().slice(0, 10);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="shopify-customers-${stamp}.xlsx"`);
      res.send(Buffer.from(buffer));
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/shopify-customers/send-template
  // Body: { ids: ["<customer _id>", ...], templateName: "welcome_offer", language: "en_US",
  //         variables: ["{{name}}", "{{orderNumber}}"] }
  router.post('/send-template', async (req, res) => {
    const { ids, templateName, language, variables } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_SEND_PER_REQUEST) {
      return res.status(400).json({
        success: false,
        error: `Select between 1 and ${MAX_SEND_PER_REQUEST} customers per send.`,
      });
    }

    if (typeof templateName !== 'string' || !/^[a-z0-9_]+$/.test(templateName)) {
      return res.status(400).json({ success: false, error: 'Choose a valid approved template.' });
    }

    if (language !== undefined && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(String(language))) {
      return res.status(400).json({ success: false, error: 'Invalid template language.' });
    }

    // These two templates are already sent automatically by the Shopify webhook.
    const automatic = [
      process.env.SHOPIFY_ORDER_TEMPLATE || 'order_confirmation',
      process.env.SHOPIFY_ABANDONED_TEMPLATE || 'abandoned_cart',
    ];
    if (automatic.includes(templateName)) {
      return res.status(400).json({
        success: false,
        error: `"${templateName}" is sent automatically on Shopify events. Choose another template to avoid double messages.`,
      });
    }

    const vars = Array.isArray(variables) && variables.length
      ? variables.slice(0, 10)
      : ['{{name}}', '{{orderNumber}}', '{{total}}', '{{product}}', '{{city}}'];

    const results = [];

    for (const id of ids) {
      // Claim the customer so two clicks (or two admins) cannot send twice at once.
      const customer = await ShopifyCustomer.findOneAndUpdate(
        {
          _id: id,
          whatsappOptIn: true,
          $or: [
            { templateStatus: { $ne: 'Processing' } },
            { updatedAt: { $lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
          ],
        },
        { $set: { templateStatus: 'Processing', templateName, templateError: '' } },
        { new: true }
      ).catch(() => null);

      if (!customer) {
        const existing = await ShopifyCustomer.findById(id).select('whatsappOptIn templateStatus').lean().catch(() => null);
        results.push({
          id,
          status: 'Skipped',
          error: !existing
            ? 'Customer not found.'
            : !existing.whatsappOptIn
              ? 'Customer has not opted in.'
              : 'A send is already in progress.',
        });
        continue;
      }

      try {
        const outcome = await sendAutomationTemplate({
          phone: customer.phone,
          name: customer.name,
          templateName,
          language,
          params: vars.map((v) => fillVariable(v, customer)),
          campaignName: 'Shopify Customers',
          // Same template to the same number is never sent twice.
          externalRef: `shopify:customer-template:${templateName}:${customer.phone}`,
          resolveHeaderImage: async () => '', // falls back to SHOPIFY_FALLBACK_IMAGE_URL
        });

        await ShopifyCustomer.updateOne(
          { _id: customer._id },
          {
            $set: {
              templateStatus: 'Sent',
              templateName,
              templateError: outcome.duplicate ? 'Already sent earlier' : '',
              messageSentAt: new Date(),
              whatsappMessageId: outcome.waMessageId || '',
            },
          }
        );
        results.push({ id, status: 'Sent', duplicate: Boolean(outcome.duplicate) });
      } catch (error) {
        await ShopifyCustomer.updateOne(
          { _id: customer._id },
          { $set: { templateStatus: 'Failed', templateError: String(error.message).slice(0, 300) } }
        );
        // Shows the failure in the Inbox/Dashboard like the automatic messages do.
        if (recordFailedMessage) {
          await recordFailedMessage({
            waId: customer.phone,
            contactName: customer.name,
            templateName,
            campaignName: 'Shopify Customers',
            error: error.message,
          }).catch(() => {});
        }
        results.push({ id, status: 'Failed', error: error.message });
      }
    }

    const count = (s) => results.filter((r) => r.status === s).length;
    res.json({ success: true, sent: count('Sent'), failed: count('Failed'), skipped: count('Skipped'), results });
  });

  return router;
};