const ShopifyCustomer = require('../models/ShopifyCustomer');

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

// Reads the fields we store from a Shopify order payload.
function extractOrderFields(data, shop) {
  const customer = data.customer || {};
  const address = data.shipping_address || data.billing_address || customer.default_address || {};

  const name =
    [customer.first_name || address.first_name, customer.last_name || address.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    address.name ||
    'Shopify Customer';

  const items = Array.isArray(data.line_items) ? data.line_items : [];
  const productName = items
    .slice(0, 3)
    .map((item) => item.title || item.name)
    .filter(Boolean)
    .join(', ');

  const orderDate = data.created_at ? new Date(data.created_at) : new Date();
  const total = Number(data.total_price);

  return {
    orderId: text(data.id ?? data.order_number, 60),
    fields: {
      shop: text(shop, 120).toLowerCase(),
      customerId: customer.id ? String(customer.id) : '',
      name: text(name, 120),
      email: text(data.email || customer.email, 160),
      lastOrderId: text(data.id ?? '', 60),
      lastOrderNumber: text(data.order_number ?? data.name ?? '', 40),
      productName: text(productName, 250),
      totalAmount: Number.isFinite(total) ? total : 0,
      currency: text(data.currency, 10),
      paymentStatus: text(data.financial_status, 40),
      city: text(address.city, 80),
      state: text(address.province || address.province_code, 80),
      pincode: text(address.zip, 20),
      lastOrderDate: Number.isNaN(orderDate.getTime()) ? new Date() : orderDate,
      acceptsMarketing: data.buyer_accepts_marketing === true,
      whatsappOptIn: data.buyer_accepts_marketing === true,
    },
  };
}

// Saves or updates the buyer. Safe to call twice for the same order (webhook retry).
// Never throws: a problem here must not stop the order-confirmation message.
async function saveShopifyCustomer({ data, shop, waId }) {
  try {
    if (!waId) return { saved: false, reason: 'no valid phone' };

    const { orderId, fields } = extractOrderFields(data || {}, shop);
    if (!orderId) return { saved: false, reason: 'order has no id' };

    const filter = { shop: fields.shop, phone: waId };

    // 1) Existing customer + this order not counted yet -> update and count it.
    const updated = await ShopifyCustomer.updateOne(
      { ...filter, processedOrderIds: { $ne: orderId } },
      {
        $set: fields,
        $min: { firstOrderDate: fields.lastOrderDate },
        $inc: { orderCount: 1 },
        $addToSet: { processedOrderIds: orderId },
      }
    );
    if (updated.matchedCount > 0) return { saved: true, created: false };

    // 2) Existing customer and this order was already counted -> webhook retry.
    if (await ShopifyCustomer.exists(filter)) return { saved: false, reason: 'order already saved' };

    // 3) New customer.
    try {
      await ShopifyCustomer.create({
        ...fields,
        phone: waId,
        orderCount: 1,
        processedOrderIds: [orderId],
        firstOrderDate: fields.lastOrderDate,
      });
      return { saved: true, created: true };
    } catch (error) {
      if (error.code !== 11000) throw error;

      // Two webhooks created the same customer at the same moment: count this order on the winner.
      await ShopifyCustomer.updateOne(
        { ...filter, processedOrderIds: { $ne: orderId } },
        {
          $set: fields,
          $min: { firstOrderDate: fields.lastOrderDate },
          $inc: { orderCount: 1 },
          $addToSet: { processedOrderIds: orderId },
        }
      );
      return { saved: true, created: false };
    }
  } catch (error) {
    console.error('Could not save Shopify customer:', error.message);
    return { saved: false, reason: error.message };
  }
}

// Customer without an order: Shopify Flow "customer created" action and the customers/create webhook.
// Creates the customer if missing, otherwise only fills fields that have a value.
// `template` (optional) records a template that was already sent to this number.
// `acceptsMarketing` must be true/false only when Shopify really told us; leave it undefined otherwise.
// Never throws.
async function saveCustomerProfile({
  shop,
  waId,
  name,
  email,
  customerId,
  city,
  state,
  pincode,
  acceptsMarketing,
  template,
}) {
  try {
    if (!waId) return { saved: false, reason: 'no valid phone' };

    const set = {};
    if (text(name, 120)) set.name = text(name, 120);
    if (text(email, 160)) set.email = text(email, 160);
    if (customerId) set.customerId = String(customerId);
    if (text(city, 80)) set.city = text(city, 80);
    if (text(state, 80)) set.state = text(state, 80);
    if (text(pincode, 20)) set.pincode = text(pincode, 20);

    if (typeof acceptsMarketing === 'boolean') {
      set.acceptsMarketing = acceptsMarketing;
      set.whatsappOptIn = acceptsMarketing;
    }

    if (template?.name) {
      set.templateStatus = 'Sent';
      set.templateName = text(template.name, 80);
      set.templateError = '';
      set.messageSentAt = new Date();
      set.whatsappMessageId = text(template.waMessageId, 120);
    }

    const update = {
      $setOnInsert: { orderCount: 0, processedOrderIds: [] },
    };
    if (Object.keys(set).length) update.$set = set;

    await ShopifyCustomer.updateOne(
      { shop: text(shop, 120).toLowerCase(), phone: waId },
      update,
      { upsert: true }
    );

    return { saved: true };
  } catch (error) {
    // 11000 = two requests created the same customer at once; the data is already there.
    if (error.code !== 11000) console.error('Could not save Shopify customer profile:', error.message);
    return { saved: false, reason: error.message };
  }
}

module.exports = { saveShopifyCustomer, saveCustomerProfile };