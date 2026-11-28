const mongoose = require('mongoose');

// One document per WhatsApp number per Shopify store.
// Every order from the same number updates this document instead of creating a new one.
const shopifyCustomerSchema = new mongoose.Schema(
  {
    shop: { type: String, default: '' },

    // Digits only, with country code (example: 919876543210). Same format as Message.waId.
    phone: { type: String, required: true },

    // Shopify customer id. Empty for guest checkouts.
    customerId: { type: String, default: '' },

    name: { type: String, default: '' },
    email: { type: String, default: '' },

    // Latest order
    lastOrderId: { type: String, default: '' },
    lastOrderNumber: { type: String, default: '' },
    productName: { type: String, default: '' },
    totalAmount: { type: Number, default: 0 },
    currency: { type: String, default: '' },
    paymentStatus: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    pincode: { type: String, default: '' },
    lastOrderDate: { type: Date },
    firstOrderDate: { type: Date },

    orderCount: { type: Number, default: 1 },
    // Webhook retries must not increase orderCount twice for the same order.
    processedOrderIds: { type: [String], default: [] },

    // Shopify's marketing consent from checkout (latest order wins).
    acceptsMarketing: { type: Boolean, default: false },
    // Only customers with whatsappOptIn = true can receive a template from the Shopify Customers page.
    whatsappOptIn: { type: Boolean, default: false },

    // Template sent from the Shopify Customers page (not the automatic order confirmation).
    templateStatus: {
      type: String,
      enum: ['Pending', 'Processing', 'Sent', 'Failed'],
      default: 'Pending',
    },
    templateName: { type: String, default: '' },
    templateError: { type: String, default: '' },
    messageSentAt: { type: Date },
    whatsappMessageId: { type: String, default: '' },
  },
  { timestamps: true }
);

shopifyCustomerSchema.index({ shop: 1, phone: 1 }, { unique: true });
shopifyCustomerSchema.index({ templateStatus: 1, createdAt: -1 });

module.exports = mongoose.model('ShopifyCustomer', shopifyCustomerSchema);