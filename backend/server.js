require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const Message = require('./models/Message');
const Audience = require('./models/Audience');
const ScheduledJob = require('./models/ScheduledJob');
const ShopifyEvent = require('./models/ShopifyEvent');
const ShopifyActivity = require('./models/ShopifyActivity');
const ConversationState = require('./models/ConversationState');
const createAutomationRouter = require('./routes/automation');
const { maybeAutoReply } = require('./services/autoReply');
const { getOrderImageUrl, isHttps } = require('./services/shopifyImage');

const app = express();

// Render terminates TLS in front of the app.
app.set('trust proxy', 1);
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

// --------------------------------------------------
// CORS CONFIGURATION
// FRONTEND_ORIGIN (env) can contain comma-separated origins.
// --------------------------------------------------

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';

// Normalise: trim, drop trailing slashes, ignore empties.
const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');

const ALLOWED_ORIGINS = [
  ...new Set(
    [
      ...FRONTEND_ORIGIN.split(','),
      'https://reachpulse-finalrender-1.onrender.com',
     // old frontend (remove if no longer used)
      'http://localhost:5173',
    ]
      .map(normalizeOrigin)
      .filter(Boolean)
  ),
];

const WHATSAPP_API_VERSION =
  process.env.WHATSAPP_API_VERSION || 'v25.0';

// Allow only the configured frontend origins (plus local development).
// Used by both Express (REST API) and Socket.IO.
function corsOrigin(origin, callback) {
  // Requests with no Origin header (Meta webhooks, Shopify, curl, server-to-server).
  if (!origin || ALLOWED_ORIGINS.includes(normalizeOrigin(origin))) {
    return callback(null, true);
  }

  const isLocalDev =
    process.env.NODE_ENV !== 'production' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  return callback(null, isLocalDev);
}

const corsOptions = {
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

// Apply CORS once, before all API routes.
app.use(cors(corsOptions));

// Handle preflight requests (uses the SAME restricted options).
app.options(/.*/, cors(corsOptions));


// --------------------------------------------------
// SOCKET.IO
// --------------------------------------------------

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

// Preserve raw webhook body for Meta signature verification.
app.use(
  express.json({
    limit: '15mb',
    verify: (req, res, buffer) => {
      req.rawBody = Buffer.from(buffer);
    },
  })
);

// --------------------------------------------------
// AI AUTO-REPLY SETTINGS (Automation tab)
// --------------------------------------------------

app.use('/api/automation', createAutomationRouter(io));

// --------------------------------------------------
// WHATSAPP CONFIGURATION CHECK
// --------------------------------------------------

function requireWhatsAppConfig(res) {
  const missing = [
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
  ].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    res.status(503).json({
      success: false,
      error: `WhatsApp is not configured. Add ${missing.join(
        ' and '
      )} to src/server/.env.`,
    });

    return false;
  }

  return true;
}

// --------------------------------------------------
// COMMON WHATSAPP API REQUEST
// --------------------------------------------------

async function callWhatsAppApi(payload) {
  if (
    !process.env.WHATSAPP_ACCESS_TOKEN ||
    !process.env.WHATSAPP_PHONE_NUMBER_ID
  ) {
    const error = new Error(
      'WhatsApp API credentials are missing in .env'
    );
    error.status = 503;
    throw error;
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    console.error('WhatsApp Network Error:', {
      message: error.message,
      cause: error.cause?.message,
      code: error.cause?.code,
      name: error.name,
    });

    const networkError = new Error(
      error.name === 'TimeoutError' || error.name === 'AbortError'
        ? 'WhatsApp API request timed out after 30 seconds.'
        : 'Unable to connect to WhatsApp Graph API. Check your internet connection or network settings.'
    );

    networkError.status = 502;
    networkError.details = {
      message: error.message,
      cause: error.cause?.message || null,
      code: error.cause?.code || null,
    };

    throw networkError;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiError = new Error(
      data?.error?.message || 'WhatsApp Cloud API request failed'
    );

    apiError.status = response.status;
    apiError.details = data;

    throw apiError;
  }

  return data;
}


async function callMetaGraphApi(method, endpoint, body = null) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!token) {
    const error = new Error("WhatsApp access token is missing.");
    error.status = 503;
    throw error;
  }

  const url =
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${endpoint}`;

  let response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    const networkError = new Error(
      "Unable to connect to Meta Graph API."
    );
    networkError.status = 502;
    throw networkError;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiError = new Error(
      data?.error?.message || "Meta Graph API request failed."
    );
    apiError.status = response.status;
    apiError.details = data;
    throw apiError;
  }

  return data;
}

function requireWabaConfig(res) {
  if (!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    res.status(503).json({
      success: false,
      message: "WHATSAPP_BUSINESS_ACCOUNT_ID is missing in .env",
    });
    return false;
  }

  if (!requireWhatsAppConfig(res)) return false;

  return true;
}


// --------------------------------------------------
// SEND TEXT MESSAGE
// --------------------------------------------------

async function sendCloudApiText(to, body) {
  return callWhatsAppApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body,
    },
  });
}

// --------------------------------------------------
// SEND TEMPLATE MESSAGE
// --------------------------------------------------

async function sendCloudApiTemplate(
  to,
  templateName,
  language,
  parameters = [],
  headerMedia = null
) {
  const components = [];

  // Add media header when provided
  if ((headerMedia?.id || headerMedia?.link) && headerMedia?.kind) {
    const kind = headerMedia.kind.toLowerCase();

    if (!['image', 'video', 'document'].includes(kind)) {
      throw new Error('Invalid media type.');
    }

    // Uploaded media uses an ID; Shopify Flow passes a public https link.
    const mediaObject = headerMedia.id
      ? { id: headerMedia.id }
      : { link: headerMedia.link };

    if (kind === 'document' && headerMedia.filename) {
      mediaObject.filename = headerMedia.filename;
    }

    components.push({
      type: 'header',
      parameters: [
        {
          type: kind,
          [kind]: mediaObject,
        },
      ],
    });
  }

  // Add body parameters only when available
  if (parameters.length > 0) {
    components.push({
      type: 'body',
      parameters: parameters.map((value) => ({
        type: 'text',
        text: String(value),
      })),
    });
  }

  const template = {
    name: templateName,
    language: {
      code: language,
    },
    ...(components.length > 0 ? { components } : {}),
  };

  return callWhatsAppApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template,
  });
}




// --------------------------------------------------
// MEDIA UPLOAD HELPERS (raw binary body, no extra dependency)
// Frontend sends the file as the request body with its own Content-Type.
// --------------------------------------------------

const rawFileParser = express.raw({
  type: () => true,
  limit: '20mb',
});

const MEDIA_LIMITS = {
  image: { max: 5 * 1024 * 1024, types: ['image/jpeg', 'image/png'] },
  video: { max: 16 * 1024 * 1024, types: ['video/mp4', 'video/3gpp'] },
  document: { max: 20 * 1024 * 1024, types: ['application/pdf'] },
};

function validateUpload(req) {
  const kind = String(req.query.kind || '').toLowerCase();
  const limit = MEDIA_LIMITS[kind];

  if (!limit) return { error: 'kind must be image, video or document.' };

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return { error: 'File body is empty.' };
  }

  const mime = String(req.get('content-type') || '').split(';')[0].trim();

  if (!limit.types.includes(mime)) {
    return {
      error: `Unsupported ${kind} type "${mime}". Allowed: ${limit.types.join(', ')}.`,
    };
  }

  if (req.body.length > limit.max) {
    return { error: `${kind} is too large (max ${limit.max / 1024 / 1024} MB).` };
  }

  return { kind, mime, buffer: req.body };
}

// Upload media to WhatsApp Cloud API -> returns media ID (used when SENDING).
app.post('/api/media/upload', rawFileParser, async (req, res) => {
  if (!requireWhatsAppConfig(res)) return;

  const check = validateUpload(req);
  if (check.error) {
    return res.status(400).json({ success: false, message: check.error });
  }

  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', check.mime);
    form.append(
      'file',
      new Blob([check.buffer], { type: check.mime }),
      String(req.query.filename || `upload.${check.mime.split('/')[1]}`)
    );

    const response = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
        body: form,
        signal: AbortSignal.timeout(60000),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.id) {
      return res.status(response.status || 500).json({
        success: false,
        message: data?.error?.message || 'Media upload to WhatsApp failed.',
        details: data,
      });
    }

    return res.status(201).json({ success: true, mediaId: data.id });
  } catch (error) {
    console.error('Media upload error:', error.message);
    return res.status(502).json({ success: false, message: error.message });
  }
});

// Upload a SAMPLE file with Meta Resumable Upload API -> returns header handle.
// This handle is what Meta needs inside header_handle when CREATING an
// IMAGE / VIDEO / DOCUMENT header template. A filename or media ID will NOT work.
app.post('/api/templates/upload-sample', rawFileParser, async (req, res) => {
  const appId = process.env.WHATSAPP_APP_ID;

  if (!process.env.WHATSAPP_ACCESS_TOKEN || !appId) {
    return res.status(503).json({
      success: false,
      message:
        'Add WHATSAPP_APP_ID (Meta App ID) and WHATSAPP_ACCESS_TOKEN to src/server/.env.',
    });
  }

  const check = validateUpload(req);
  if (check.error) {
    return res.status(400).json({ success: false, message: check.error });
  }

  try {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;

    // Step 1: start an upload session
    const sessionUrl =
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${appId}/uploads` +
      `?file_length=${check.buffer.length}` +
      `&file_type=${encodeURIComponent(check.mime)}` +
      `&file_name=${encodeURIComponent(String(req.query.filename || 'sample'))}`;

    const sessionRes = await fetch(sessionUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    const session = await sessionRes.json().catch(() => ({}));

    if (!sessionRes.ok || !session.id) {
      return res.status(sessionRes.status || 500).json({
        success: false,
        message: session?.error?.message || 'Could not start upload session.',
        details: session,
      });
    }

    // Step 2: upload the bytes (note: "OAuth" prefix, not "Bearer")
    const uploadRes = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${session.id}`,
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${token}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
        body: check.buffer,
        signal: AbortSignal.timeout(90000),
      }
    );
    const uploaded = await uploadRes.json().catch(() => ({}));

    if (!uploadRes.ok || !uploaded.h) {
      return res.status(uploadRes.status || 500).json({
        success: false,
        message: uploaded?.error?.message || 'Sample upload failed.',
        details: uploaded,
      });
    }

    return res.status(201).json({ success: true, headerHandle: uploaded.h });
  } catch (error) {
    console.error('Sample upload error:', error.message);
    return res.status(502).json({ success: false, message: error.message });
  }
});

/* =========================================
   TEMPLATE BUILDING (shared by create + edit)
========================================= */

const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY'];

// Accepts buttons as plain strings (quick reply) or objects:
//   { type: 'QUICK_REPLY', text }
//   { type: 'URL', text, url }              (fixed https link, no {{variables}})
//   { type: 'PHONE_NUMBER', text, phone }   (number with country code)
// Meta wants call-to-action buttons first and quick replies grouped after them.
function buildTemplateButtons(rawButtons) {
  if (rawButtons === undefined || rawButtons === null) return { buttons: [] };

  if (!Array.isArray(rawButtons) || rawButtons.length > 10) {
    return { error: 'Provide up to 10 buttons.' };
  }

  const cta = [];
  const quick = [];
  let urlCount = 0;
  let phoneCount = 0;

  for (const item of rawButtons) {
    const button = typeof item === 'string' ? { type: 'QUICK_REPLY', text: item } : item || {};
    const type = String(button.type || 'QUICK_REPLY').toUpperCase();
    const text = String(button.text || '').trim();

    if (!text || text.length > 25) {
      return { error: 'Every button needs a label of 1–25 characters.' };
    }

    if (type === 'QUICK_REPLY') {
      quick.push({ type: 'QUICK_REPLY', text });
    } else if (type === 'URL') {
      const url = String(button.url || '').trim();

      if (!/^https:\/\/[^\s{}]+$/i.test(url) || url.length > 2000) {
        return {
          error: `Button "${text}": enter a full https:// link without variables (dynamic {{1}} links are not supported by the sender).`,
        };
      }

      urlCount += 1;
      cta.push({ type: 'URL', text, url });
    } else if (type === 'PHONE_NUMBER') {
      const digits = String(button.phone || button.phone_number || '').replace(/\D/g, '');

      if (digits.length < 8 || digits.length > 15) {
        return { error: `Button "${text}": enter the phone number with country code, e.g. +919876543210.` };
      }

      phoneCount += 1;
      cta.push({ type: 'PHONE_NUMBER', text, phone_number: `+${digits}` });
    } else {
      return { error: `Unsupported button type "${type}".` };
    }
  }

  if (urlCount > 2) return { error: 'A template can have at most 2 website buttons.' };
  if (phoneCount > 1) return { error: 'A template can have at most 1 call button.' };

  return { buttons: [...cta, ...quick] };
}

// Returns { components } or { error }.
function buildTemplateComponents(input = {}) {
  const {
    header,
    headerFormat = 'TEXT',
    headerHandle,
    body,
    footer,
    buttons,
    bodyExamples,
  } = input;

  const components = [];

  if (typeof body !== 'string' || !body.trim() || body.length > 1024) {
    return { error: 'Template body is required (maximum 1024 characters).' };
  }

  // HEADER
  if (header !== undefined && header !== null && typeof header !== 'string') {
    return { error: 'Header must be text.' };
  }

  const format = String(headerFormat || 'TEXT').toUpperCase();

  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
    if (typeof headerHandle !== 'string' || !headerHandle.trim()) {
      return {
        error: `${format} header needs a sample file. Upload one first (headerHandle missing).`,
      };
    }

    components.push({
      type: 'HEADER',
      format,
      example: { header_handle: [headerHandle.trim()] },
    });
  } else if (header?.trim()) {
    if (header.length > 60) return { error: 'Text header cannot exceed 60 characters.' };
    if (/\{\{/.test(header)) return { error: 'Text headers cannot contain variables here.' };

    components.push({ type: 'HEADER', format: 'TEXT', text: header.trim() });
  }

  // BODY
  const bodyText = body.trim();
  const numbers = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const unique = [...new Set(numbers)].sort((a, b) => a - b);

  if (unique.some((number, index) => number !== index + 1)) {
    return { error: 'Body variables must be sequential, starting from {{1}}.' };
  }

  if (/^\s*\{\{\d+\}\}/.test(bodyText) || /\{\{\d+\}\}\s*$/.test(bodyText)) {
    return { error: 'Meta does not allow the body to start or end with a variable. Add some text before/after it.' };
  }

  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(bodyText)) {
    return { error: 'Two variables cannot sit side by side. Put text between them.' };
  }

  const bodyComponent = { type: 'BODY', text: bodyText };

  if (unique.length > 0) {
    if (
      !Array.isArray(bodyExamples) ||
      bodyExamples.length !== unique.length ||
      bodyExamples.some((value) => typeof value !== 'string' || !value.trim())
    ) {
      return { error: `Provide ${unique.length} body example values in bodyExamples.` };
    }

    bodyComponent.example = { body_text: [bodyExamples.map((value) => value.trim())] };
  }

  components.push(bodyComponent);

  // FOOTER
  if (footer !== undefined && footer !== null && typeof footer !== 'string') {
    return { error: 'Footer must be text.' };
  }

  if (footer?.trim()) {
    if (footer.length > 60) return { error: 'Footer cannot exceed 60 characters.' };
    components.push({ type: 'FOOTER', text: footer.trim() });
  }

  // BUTTONS
  const built = buildTemplateButtons(buttons);
  if (built.error) return { error: built.error };

  if (built.buttons.length > 0) {
    components.push({ type: 'BUTTONS', buttons: built.buttons });
  }

  return { components };
}

/* =========================================
   CREATE WHATSAPP TEMPLATE ON META
   POST /api/templates
========================================= */

app.post('/api/templates', async (req, res) => {
  if (!requireWabaConfig(res)) return;

  const { name, category, language } = req.body || {};

  if (typeof name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(name)) {
    return res.status(400).json({
      success: false,
      message: 'Template name must contain lowercase letters, numbers and underscores.',
    });
  }

  if (!TEMPLATE_CATEGORIES.includes(category)) {
    return res.status(400).json({ success: false, message: 'Invalid template category.' });
  }

  if (typeof language !== 'string' || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) {
    return res.status(400).json({ success: false, message: 'Invalid language code.' });
  }

  const built = buildTemplateComponents(req.body);
  if (built.error) {
    return res.status(400).json({ success: false, message: built.error });
  }

  try {
    const result = await callMetaGraphApi(
      'POST',
      `${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`,
      { name, category, language, components: built.components }
    );

    return res.status(201).json({
      success: true,
      message: 'Template submitted to Meta successfully.',
      template: {
        id: result.id,
        name,
        language,
        category: result.category || category,
        status: result.status || 'PENDING',
      },
      metaResponse: result,
    });
  } catch (error) {
    console.error('Meta template creation error:', error.details || error.message);

    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      details: error.details || null,
    });
  }
});

/* =========================================
   EDIT A TEMPLATE AND SEND IT BACK TO META REVIEW
   POST /api/templates/:id/edit
   Name, language and category cannot change. Meta allows editing
   APPROVED / REJECTED / PAUSED templates (approved ones: once per
   24 hours, max 10 edits in 30 days). Meta's own error is passed on.
========================================= */

app.post('/api/templates/:id/edit', async (req, res) => {
  if (!requireWabaConfig(res)) return;

  const templateId = String(req.params.id || '');

  if (!/^\d+$/.test(templateId)) {
    return res.status(400).json({ success: false, message: 'Invalid template id.' });
  }

  const built = buildTemplateComponents(req.body);
  if (built.error) {
    return res.status(400).json({ success: false, message: built.error });
  }

  try {
    const result = await callMetaGraphApi('POST', templateId, {
      components: built.components,
    });

    // The edited template is reviewed again: any cached copy is now stale.
    flowTemplateCache.clear();

    return res.json({
      success: true,
      message: 'Template updated and sent to Meta for review.',
      template: { id: templateId, status: 'PENDING' },
      metaResponse: result,
    });
  } catch (error) {
    console.error('Meta template edit error:', error.details || error.message);

    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      details: error.details || null,
    });
  }
});

/* =========================================
   DELETE A TEMPLATE FROM META
   DELETE /api/templates/:name?hsm_id=<template id>
   With hsm_id only that language version is deleted.
========================================= */

app.delete('/api/templates/:name', async (req, res) => {
  if (!requireWabaConfig(res)) return;

  const name = String(req.params.name || '');
  const hsmId = String(req.query.hsm_id || '');

  if (!/^[a-z0-9_]{1,512}$/.test(name) || (hsmId && !/^\d+$/.test(hsmId))) {
    return res.status(400).json({ success: false, message: 'Invalid template name or id.' });
  }

  try {
    await callMetaGraphApi(
      'DELETE',
      `${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates` +
        `?name=${encodeURIComponent(name)}` +
        (hsmId ? `&hsm_id=${hsmId}` : '')
    );

    flowTemplateCache.clear();

    return res.json({ success: true, message: 'Template deleted from Meta.' });
  } catch (error) {
    console.error('Meta template delete error:', error.details || error.message);

    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      details: error.details || null,
    });
  }
});


// --------------------------------------------------
// HEALTH CHECK API
// --------------------------------------------------

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'wati-clone-backend' });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    ok: true,
    service: 'wati-clone-backend',
    database:
      mongoose.connection.readyState === 1
        ? 'connected'
        : 'disconnected',
    whatsappConfigured: Boolean(
      process.env.WHATSAPP_ACCESS_TOKEN &&
        process.env.WHATSAPP_PHONE_NUMBER_ID
    ),
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null,
    apiVersion: WHATSAPP_API_VERSION,
    webhookConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
  });
});

// --------------------------------------------------
// GET ALL CONVERSATIONS
// --------------------------------------------------

app.get('/api/conversations', async (req, res, next) => {
  try {
    const conversations = await Message.aggregate([
      {
        $sort: {
          timestamp: -1,
        },
      },
      {
        $group: {
          _id: '$waId',
          waId: {
            $first: '$waId',
          },
          contactName: {
            $first: '$contactName',
          },
          lastMessage: {
            $first: '$text',
          },
          lastMessageType: {
            $first: '$type',
          },
          lastMessageAt: {
            $first: '$timestamp',
          },
          lastDirection: {
            $first: '$direction',
          },
          lastStatus: {
            $first: '$status',
          },
        },
      },
      {
        $sort: {
          lastMessageAt: -1,
        },
      },
      {
        $limit: 200,
      },
    ]);

    res.json({
      success: true,
      conversations,
    });
  } catch (error) {
    next(error);
  }
});

// --------------------------------------------------
// GET MESSAGES BY CUSTOMER NUMBER
// --------------------------------------------------

app.get('/api/messages/:waId', async (req, res, next) => {
  try {
    const waId = String(req.params.waId).replace(/[^0-9]/g, '');

    if (!waId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid WhatsApp number',
      });
    }

    const messages = await Message.find({
      waId,
    })
      .sort({
        timestamp: 1,
      })
      .limit(500)
      .lean();

    res.json({
      success: true,
      messages,
    });
  } catch (error) {
    next(error);
  }
});

// --------------------------------------------------
// SEND TEXT MESSAGE API
// POST /api/messages
// --------------------------------------------------

app.post('/api/messages', async (req, res) => {
  if (!requireWhatsAppConfig(res)) return;

  const waId = String(req.body?.to || '').replace(/[^0-9]/g, '');
  const text = String(req.body?.text || '').trim();

  if (
    !waId ||
    waId.length < 8 ||
    waId.length > 15 ||
    !text ||
    text.length > 4096
  ) {
    return res.status(400).json({
      success: false,
      error:
        'Provide a valid customer number (country code, digits only) and message text (1–4096 characters).',
    });
  }

  try {
    const apiResult = await sendCloudApiText(waId, text);

    const saved = await Message.create({
      waMessageId: apiResult.messages?.[0]?.id,
      waId,
      direction: 'outbound',
      type: 'text',
      text,
      status: 'sent',
      timestamp: new Date(),
      raw: apiResult,
    });

    io.emit('message:new', saved.toObject());

    // A human replied from the inbox: the AI bot stays quiet in this chat until someone resumes it.
    try {
      await ConversationState.findOneAndUpdate(
        { waId },
        { botPaused: true, pausedReason: 'agent', pausedAt: new Date() },
        { upsert: true, setDefaultsOnInsert: true }
      );
      io.emit('bot:state', { waId, botPaused: true });
    } catch (stateError) {
      console.error('Could not pause bot for chat:', stateError.message);
    }

    res.status(201).json({
      success: true,
      message: saved,
      whatsapp: apiResult,
    });
  } catch (error) {
    console.error(
      'WhatsApp text send error:',
      error.details || error.message
    );

    res.status(error.status || 500).json({
      success: false,
      error: error.message,
      details: error.details,
    });
  }
});

// --------------------------------------------------
// SEND TEMPLATE MESSAGE API
// POST /api/messages/template
// --------------------------------------------------

app.post('/api/messages/template', async (req, res) => {
  if (!requireWhatsAppConfig(res)) return;

  const {
    to,
    templateName,
    language,
    parameters = [],
  } = req.body || {};

  const waId = String(to || '').replace(/[^0-9]/g, '');

  if (
    !waId ||
    waId.length < 8 ||
    waId.length > 15
  ) {
    return res.status(400).json({
      success: false,
      message: 'Provide a valid customer WhatsApp number.',
    });
  }

  if (
    typeof templateName !== 'string' ||
    !/^[a-z0-9_]+$/.test(templateName)
  ) {
    return res.status(400).json({
      success: false,
      message:
        'Invalid template name. Use lowercase letters, numbers, and underscores.',
    });
  }

  if (
    typeof language !== 'string' ||
    !/^(?:[a-z]{2,3}(?:_[A-Z]{2})?)$/.test(language)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Provide a valid template language code, such as en_US.',
    });
  }

  if (
    !Array.isArray(parameters) ||
    parameters.length > 100 ||
    parameters.some(
      (value) =>
        value === null ||
        value === undefined ||
        typeof value === 'object'
    )
  ) {
    return res.status(400).json({
      success: false,
      message: 'Template parameters must be an array of text values.',
    });
  }

  try {
    const result = await sendCloudApiTemplate(
      waId,
      templateName,
      language,
      parameters
    );

    const waMessageId = result.messages?.[0]?.id;

    // Save the accepted template message in MongoDB.
    const saved = await Message.create({
      waMessageId,
      waId,
      direction: 'outbound',
      type: 'template',
      text: `[Template: ${templateName}]`,
      status: 'sent',
      timestamp: new Date(),
      raw: result,
    });

    io.emit('message:new', saved.toObject());

    return res.status(201).json({
      success: true,
      message: 'Template message accepted by WhatsApp.',
      data: result,
      savedMessage: saved,
    });
  } catch (error) {
    console.error(
      'Template message error:',
      error.details || error.message
    );

    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      details: error.details,
    });
  }
});




/* =========================================
   GET TEMPLATES FROM META
   GET /api/templates
========================================= */

app.get("/api/templates", async (req, res) => {
  if (!requireWabaConfig(res)) return;

  try {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    const fields =
      "id,name,status,category,language,components,quality_score,rejected_reason";

    let nextUrl =
      `${WHATSAPP_API_VERSION}/${wabaId}/message_templates` +
      `?limit=100&fields=${encodeURIComponent(fields)}`;

    const templates = [];

    // Read all pages so the frontend gets the complete template list.
    while (nextUrl) {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;

      const response = await fetch(
        nextUrl.startsWith("https://")
          ? nextUrl
          : `https://graph.facebook.com/${nextUrl}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(30000),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(
          data?.error?.message || "Unable to fetch Meta templates."
        );
        error.details = data;
        throw error;
      }

      templates.push(...(data.data || []));
      nextUrl = data.paging?.next || null;
    }

    return res.json({
      success: true,
      total: templates.length,
      templates,
    });
  } catch (error) {
    console.error(
      "Meta template fetch error:",
      error.details || error.message
    );

    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      details: error.details || null,
    });
  }
});


/* =========================================
   CHECK TEMPLATE APPROVAL STATUS
   GET /api/templates/:name/status
========================================= */

app.get("/api/templates/:name/status", async (req, res) => {
  if (!requireWabaConfig(res)) return;

  try {
    const name = String(req.params.name || "");
    const language = String(req.query.language || "en_US");

    if (!/^[a-z0-9_]{1,512}$/.test(name)) {
      return res.status(400).json({
        success: false,
        message: "Invalid template name.",
      });
    }

    const result = await callMetaGraphApi(
      "GET",
      `${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates` +
        `?name=${encodeURIComponent(name)}` +
        `&fields=id,name,status,category,language,components`
    );

    const template = (result.data || []).find(
      (item) =>
        item.name === name &&
        item.language === language
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        message: "Template not found in Meta.",
      });
    }

    return res.json({
      success: true,
      template,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      details: error.details || null,
    });
  }
});


// --------------------------------------------------
// META WEBHOOK VERIFICATION
// GET /webhook
// --------------------------------------------------

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (
    mode === 'subscribe' &&
    token &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return res
      .status(200)
      .type('text/plain')
      .send(String(challenge));
  }

  return res.sendStatus(403);
});


// --------------------------------------------------
// SEND CAMPAIGN TO AUDIENCE
// POST /api/campaign/send
// --------------------------------------------------

app.post('/api/campaign/send', async (req, res) => {
  if (!requireWhatsAppConfig(res)) return;

const { template, contacts, headerMedia, campaignName } = req.body || {};

  // Validate template
  if (
    !template ||
    typeof template.name !== 'string' ||
    !/^[a-z0-9_]+$/.test(template.name) ||
    typeof (template.language || 'en_US') !== 'string' ||
    !/^(?:[a-z]{2,3}(?:_[A-Z]{2})?)$/.test(template.language || 'en_US')
  ) {
    return res.status(400).json({
      success: false,
      message: 'Provide a valid approved template name and language code.',
    });
  }

  // Validate audience
  if (
    !Array.isArray(contacts) ||
    contacts.length === 0 ||
    contacts.length > 500
  ) {
    return res.status(400).json({
      success: false,
      message: 'Provide between 1 and 500 audience contacts per request.',
    });
  }
  // Verify template approval directly from Meta
let templateHeaderFormat = "NONE";
let templateBodyVars = 0;
try {
  const language = template.language || "en_US";

  const templateResult = await callMetaGraphApi(
    "GET",
    `${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates` +
      `?name=${encodeURIComponent(template.name)}` +
      `&fields=id,name,status,language,components`
  );

  const approvedTemplate = (templateResult.data || []).find(
    (item) =>
      item.name === template.name &&
      item.language === language &&
      item.status === "APPROVED"
  );

  if (!approvedTemplate) {
    return res.status(400).json({
      success: false,
      message: "This template is not approved by Meta. Campaign cannot be sent.",
    });
  }

  // Use the REAL structure of the approved template, not what the frontend guesses.
  const metaHeader = (approvedTemplate.components || []).find(
    (part) => part.type === "HEADER"
  );
  const metaBody = (approvedTemplate.components || []).find(
    (part) => part.type === "BODY"
  );

  templateHeaderFormat = metaHeader?.format || "NONE";
  templateBodyVars = new Set(
    [...String(metaBody?.text || "").matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])
  ).size;

  const dynamicButton = (approvedTemplate.components || [])
    .filter((part) => part.type === "BUTTONS")
    .flatMap((part) => part.buttons || [])
    .find((button) => button.type === "URL" && /\{\{\d+\}\}/.test(button.url || ""));

  if (dynamicButton) {
    return res.status(400).json({
      success: false,
      message: `Template button "${dynamicButton.text}" uses a dynamic link ({{1}}). Campaigns support fixed links only.`,
    });
  }

  if (
    ["IMAGE", "VIDEO", "DOCUMENT"].includes(templateHeaderFormat) &&
    !(headerMedia?.id && headerMedia?.kind)
  ) {
    return res.status(400).json({
      success: false,
      message: `This template has a ${templateHeaderFormat} header. Upload a ${templateHeaderFormat.toLowerCase()} before sending.`,
    });
  }
} catch (error) {
  console.error(
    "Template approval verification failed:",
    error.details || error.message
  );

  return res.status(error.status || 500).json({
    success: false,
    message: "Unable to verify template approval with Meta.",
    details: error.details || null,
  });
}

  const results = [];

  const campaign = {
    id: crypto.randomUUID(),
    name: String(campaignName || template.name).slice(0, 80),
    templateName: template.name,
    total: contacts.length,
    done: 0,
    sent: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
  };
  activeCampaigns.set(campaign.id, campaign);
  emitCampaignProgress(campaign, results);

  // Send messages one by one
  for (const contact of contacts) {
    emitCampaignProgress(campaign, results);
    const waId = String(contact?.phone || '').replace(/[^0-9]/g, '');

    const rawParameters = Array.isArray(contact?.parameters)
      ? contact.parameters
      : Array.isArray(req.body.parameters)
      ? req.body.parameters
      : [];

    // Meta rejects the message (#132000) if the count differs from the template.
    const parameters = rawParameters.slice(0, templateBodyVars);

    if (parameters.length < templateBodyVars) {
      results.push({
        phone: contact?.phone || '',
        status: 'failed',
        error: `Template needs ${templateBodyVars} variable(s) but ${parameters.length} provided.`,
      });

      await recordFailedMessage({
        waId,
        contactName: contact?.name,
        templateName: template.name,
        campaignName: campaign.name,
        error: `Template needs ${templateBodyVars} variable(s) but ${parameters.length} provided.`,
      });

      continue;
    }

    // Validate phone and parameters
    if (
      waId.length < 8 ||
      waId.length > 15 ||
      parameters.length > 100 ||
      parameters.some(
        (value) =>
          value === null ||
          value === undefined ||
          typeof value === 'object'
      )
    ) {
      results.push({
        phone: contact?.phone || '',
        status: 'failed',
        error: 'Invalid phone number or template parameters.',
      });

      continue;
    }

    try {
      // Send approved WhatsApp template
const apiResult = await sendCloudApiTemplate(
  waId,
  template.name,
  template.language || 'en_US',
  parameters,
  ["IMAGE", "VIDEO", "DOCUMENT"].includes(templateHeaderFormat)
    ? headerMedia
    : null
);

      const waMessageId = apiResult.messages?.[0]?.id;

      // Save message in MongoDB
      const saved = await Message.create({
        waMessageId,
        waId,
        contactName: contact.name || '',
        direction: 'outbound',
        type: 'template',
        text: `[Template: ${template.name}]`,
        status: 'sent',
        templateName: template.name,
        campaignName: campaign.name,
        timestamp: new Date(),
        raw: apiResult,
      });

      // Notify frontend through Socket.IO
      io.emit('message:new', saved.toObject());

      results.push({
        phone: contact.phone,
        status: 'sent',
        messageId: waMessageId,
      });

    } catch (error) {
      console.error(
        `Campaign send failed for ${waId}:`,
        error.details || error.message
      );

      results.push({
        phone: contact.phone,
        status: 'failed',
        error: error.message,
        details: error.details,
      });

      await recordFailedMessage({
        waId,
        contactName: contact?.name,
        templateName: template.name,
        campaignName: campaign.name,
        error: error.message,
      });
    }
  }

  emitCampaignProgress(campaign, results);
  activeCampaigns.delete(campaign.id);
  io.emit('campaign:done', publicCampaign(campaign));

  // Calculate final results
  const sent = results.filter(
    (item) => item.status === 'sent'
  ).length;

  const failed = results.length - sent;

  return res.status(200).json({
    success: true,
    message: 'Campaign processing completed.',
    total: results.length,
    sent,
    failed,
    results,
  });
});



// --------------------------------------------------
// SAVED AUDIENCE (contacts survive page refresh)
// GET /api/audience  -> { fileName, contacts }
// PUT /api/audience  -> replaces the saved list
// --------------------------------------------------

const MAX_AUDIENCE_CONTACTS = 50000;

function cleanAudienceContact(item, index) {
  const text = (value, fallback = '') =>
    String(value ?? fallback).slice(0, 200);

  return {
    id: item?.id ?? Date.now() + index,
    initials: text(item?.initials),
    name: text(item?.name),
    company: text(item?.company),
    phone: text(item?.phone),
    email: text(item?.email, '—'),
    country: text(item?.country, 'Unknown'),
    status: ['Valid', 'Invalid', 'Duplicate'].includes(item?.status)
      ? item.status
      : 'Valid',
    selected: Boolean(item?.selected),
  };
}

app.get('/api/audience', async (req, res) => {
  try {
    const doc = await Audience.findOne({ key: 'default' }).lean();

    return res.json({
      success: true,
      saved: Boolean(doc),
      fileName: doc?.fileName || '',
      contacts: doc?.contacts || [],
      updatedAt: doc?.updatedAt || null,
    });
  } catch (error) {
    console.error('Audience load error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/audience', async (req, res) => {
  const { contacts, fileName } = req.body || {};

  if (!Array.isArray(contacts)) {
    return res
      .status(400)
      .json({ success: false, message: 'contacts must be an array.' });
  }

  if (contacts.length > MAX_AUDIENCE_CONTACTS) {
    return res.status(400).json({
      success: false,
      message: `Too many contacts (max ${MAX_AUDIENCE_CONTACTS}).`,
    });
  }

  try {
    await Audience.findOneAndUpdate(
      { key: 'default' },
      {
        $set: {
          fileName: String(fileName || '').slice(0, 200),
          contacts: contacts.map(cleanAudienceContact),
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, count: contacts.length });
  } catch (error) {
    console.error('Audience save error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// --------------------------------------------------
// SHOPIFY FLOW INTEGRATION
// Shopify Flow -> "Send HTTP request" action -> this endpoint -> WhatsApp template.
// POST /api/integrations/shopify-flow/send
// Header: x-flow-secret: <SHOPIFY_FLOW_SECRET from .env>
// Every message is stored, so it shows up on the Dashboard like any other send.
// --------------------------------------------------

const flowTemplateCache = new Map(); // "name|lang" -> { at, info }

function normalizeFlowPhone(raw) {
  const countryCode =
    String(process.env.DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '') || '91';

  let digits = String(raw || '').replace(/\D/g, '');

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = countryCode + digits;

  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

function flowAuthorized(req) {
  const secret = String(process.env.SHOPIFY_FLOW_SECRET || '');
  const given = String(
    req.get('x-flow-secret') ||
      String(req.get('authorization') || '').replace(/^Bearer\s+/i, '')
  );

  const a = Buffer.from(given);
  const b = Buffer.from(secret);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Reads the real approved template from Meta (cached for 60 seconds).
async function getFlowTemplateInfo(name, language) {
  const key = `${name}|${language}`;
  const cached = flowTemplateCache.get(key);

  if (cached && Date.now() - cached.at < 60000) return cached.info;

  const result = await callMetaGraphApi(
    'GET',
    `${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates` +
      `?name=${encodeURIComponent(name)}` +
      `&fields=id,name,status,language,components`
  );

  const approved = (result.data || []).find(
    (item) =>
      item.name === name &&
      item.language === language &&
      item.status === 'APPROVED'
  );

  let info = null;

  if (approved) {
    const header = (approved.components || []).find((c) => c.type === 'HEADER');
    const body = (approved.components || []).find((c) => c.type === 'BODY');

    info = {
      headerFormat: header?.format || 'NONE',
      bodyVars: new Set(
        [...String(body?.text || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])
      ).size,
    };
  }

  flowTemplateCache.set(key, { at: Date.now(), info });
  return info;
}

// Meta rejects empty values, new lines, tabs and long runs of spaces in variables.
function cleanTemplateParam(value) {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {5,}/g, '    ')
    .trim()
    .slice(0, 1000);

  return text || '-';
}

app.post('/api/integrations/shopify-flow/send', async (req, res) => {
  if (!process.env.SHOPIFY_FLOW_SECRET) {
    return res.status(503).json({
      success: false,
      message: 'Add SHOPIFY_FLOW_SECRET to src/server/.env first.',
    });
  }

  if (!flowAuthorized(req)) {
    return res
      .status(401)
      .json({ success: false, message: 'Invalid or missing x-flow-secret.' });
  }

  return flowSendCore(req, res);
});

// Shared by the "Send HTTP request" route above and the custom Flow action below.
async function flowSendCore(req, res) {
  if (!requireWabaConfig(res)) return;

  const {
    phone,
    name,
    template,
    language,
    parameters,
    headerImageUrl,
    headerMediaUrl,
    headerFilename,
    reference,
    flowName,
    dryRun,
  } = req.body || {};

  const templateName = String(template || '').trim();
  const templateLanguage = String(language || 'en_US').trim();
  const waId = normalizeFlowPhone(phone);

  if (!templateName) {
    return res
      .status(400)
      .json({ success: false, message: 'template is required.' });
  }

  if (!waId) {
    return res.status(400).json({
      success: false,
      message: `Invalid phone number "${phone || ''}". Use full number or 10 digits.`,
    });
  }

  const dbReady = mongoose.connection.readyState === 1;
  const externalRef = reference ? `shopify:${reference}:${templateName}` : '';
  const campaignName = `Shopify Flow${flowName ? `: ${String(flowName).slice(0, 60)}` : ''}`;

  try {
    // Flow retries on errors, so the same order must never message the client twice.
    if (externalRef && dbReady && !dryRun) {
      const duplicate = await Message.findOne({
        externalRef,
        status: { $ne: 'failed' },
      }).lean();

      if (duplicate) {
        return res.json({
          success: true,
          duplicate: true,
          waMessageId: duplicate.waMessageId || null,
        });
      }
    }

    const info = await getFlowTemplateInfo(templateName, templateLanguage);

    if (!info) {
      return res.status(400).json({
        success: false,
        message: `Template "${templateName}" (${templateLanguage}) is not approved in Meta.`,
      });
    }

    const rawParams = Array.isArray(parameters) ? parameters : [];

    if (rawParams.length < info.bodyVars) {
      return res.status(400).json({
        success: false,
        message: `Template needs ${info.bodyVars} variable(s) but ${rawParams.length} sent.`,
      });
    }

    const params = rawParams.slice(0, info.bodyVars).map(cleanTemplateParam);

    let headerMedia = null;

    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(info.headerFormat)) {
      const link = String(headerMediaUrl || headerImageUrl || '').trim();

      if (!/^https:\/\/\S+$/i.test(link)) {
        return res.status(400).json({
          success: false,
          message: `Template has a ${info.headerFormat} header. Send a public https link in headerMediaUrl.`,
        });
      }

      headerMedia = {
        kind: info.headerFormat.toLowerCase(),
        link,
        filename: headerFilename || undefined,
      };
    }

    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        to: waId,
        template: templateName,
        parameters: params,
        headerFormat: info.headerFormat,
      });
    }

    const apiResult = await sendCloudApiTemplate(
      waId,
      templateName,
      templateLanguage,
      params,
      headerMedia
    );

    const waMessageId = apiResult?.messages?.[0]?.id || null;

    if (dbReady) {
      const saved = await Message.create({
        waMessageId,
        waId,
        contactName: String(name || '').slice(0, 100),
        direction: 'outbound',
        type: 'template',
        text: `[Template: ${templateName}]`,
        status: 'sent',
        templateName,
        campaignName,
        externalRef,
        timestamp: new Date(),
        raw: apiResult,
      });

      io.emit('message:new', saved.toObject());
    }

    return res.json({ success: true, waMessageId, to: waId });
  } catch (error) {
    // 429 / 5xx / network problems: tell Flow to retry later (it retries for 24h).
    const retryable =
      !error.status || error.status >= 500 || error.status === 429;

    console.error('Shopify Flow send error:', error.message);

    if (!retryable && dbReady && !dryRun) {
      await recordFailedMessage({
        waId,
        contactName: name,
        templateName,
        campaignName,
        error: error.message,
        externalRef,
      });
    }

    return res.status(retryable ? 503 : 422).json({
      success: false,
      message: error.message,
      code: error.details?.error?.code || null,
    });
  }
}

// --------------------------------------------------
// SHOPIFY FLOW CUSTOM ACTION ("Send WhatsApp message")
// Used by the Flow action extension in the Shopify app (shopify.extension.toml).
// Shopify signs every request: x-shopify-hmac-sha256 = base64(HMAC-SHA256(rawBody, app client secret)).
// --------------------------------------------------

const FLOW_ACTION_HANDLE = 'send-whatsapp-message';

function verifyShopifyHmac(rawBody, headerValue, secret) {
  if (!Buffer.isBuffer(rawBody) || !headerValue || !secret) {
    console.log('[HMAC DEBUG] Missing verification data', {
      rawBodyAvailable: Buffer.isBuffer(rawBody),
      headerAvailable: Boolean(headerValue),
      secretAvailable: Boolean(secret),
    });

    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  const received = String(headerValue).trim();

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');

  const valid =
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

  console.log('[HMAC DEBUG]', {
    rawBodyLength: rawBody.length,
    expectedLength: expectedBuffer.length,
    receivedLength: receivedBuffer.length,
    secretHasWhitespace: secret !== secret.trim(),
    signatureValid: valid,
  });

  return valid;
}

app.post('/api/integrations/shopify-flow/action', async (req, res) => {
 console.log('[FLOW REQUEST DEBUG]', {
  contentType: req.get('content-type'),
  rawBodyAvailable: Buffer.isBuffer(req.rawBody),
  hmacHeader: Boolean(req.get('x-shopify-hmac-sha256')),
  alternateHmacHeader: Boolean(
    req.get('http-x-shopify-hmac-sha256')
  ),
  headerNames: Object.keys(req.headers),
});

  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientSecret) {
    return res.status(503).json({
      success: false,
      message: 'Add SHOPIFY_CLIENT_SECRET (Dev Dashboard > app > Settings) to src/server/.env.',
    });
  }

  const signature =
    req.get('x-shopify-hmac-sha256') || req.get('http-x-shopify-hmac-sha256');

  if (!verifyShopifyHmac(req.rawBody, signature, clientSecret)) {
    return res
      .status(401)
      .json({ success: false, message: 'Invalid Shopify signature.' });
  }

 const payload = req.body || {};

const props =
  payload.properties ||
  payload['shopify::properties'] ||
  payload;



  if (payload.handle && payload.handle !== FLOW_ACTION_HANDLE) {
    return res
      .status(400)
      .json({ success: false, message: `Unknown action "${payload.handle}".` });
  }

  // Map Flow fields to the same format the HTTP-request route uses.
  req.body = {
    phone: props.phone,
    name: props.customer_name,
    template: props.template_name,
    language: props.language || 'en_US',
    parameters: [1, 2, 3, 4, 5].map((n) => props[`variable_${n}`] ?? ''),
    headerMediaUrl: props.header_media_url,
    reference: props.reference || payload.action_run_id,
    flowName: payload.shopify_domain || 'Shopify Flow action',
  };

  return flowSendCore(req, res);
});

// --------------------------------------------------
// SHOPIFY AUTOMATIONS (webhooks -> WhatsApp)
//   orders/create    -> "order_confirmation" template, sent immediately
//   checkouts/create + checkouts/update -> "abandoned_cart" template after a delay,
//                       skipped if the customer completes the order first
// Jobs are stored in MongoDB (ScheduledJob) and run by a small timer below.
// Every sent message is saved in Message, so the Dashboard and Inbox show it.
// --------------------------------------------------

const SHOPIFY_ORDER_TEMPLATE = () =>
  process.env.SHOPIFY_ORDER_TEMPLATE || 'order_confirmation';
const SHOPIFY_ABANDONED_TEMPLATE = () =>
  process.env.SHOPIFY_ABANDONED_TEMPLATE || 'abandoned_cart';
const SHOPIFY_TEMPLATE_LANGUAGE = () =>
  process.env.SHOPIFY_TEMPLATE_LANGUAGE || 'en_US';
const SHOPIFY_ABANDONED_DELAY_MIN = () =>
  Number(process.env.SHOPIFY_ABANDONED_DELAY_MIN) > 0
    ? Number(process.env.SHOPIFY_ABANDONED_DELAY_MIN)
    : 45;
const SHOPIFY_MAX_ATTEMPTS = 3;

function pickShopifyPhone(data) {
  const candidates = [
    data?.phone,
    data?.customer?.phone,
    data?.shipping_address?.phone,
    data?.billing_address?.phone,
    data?.customer?.default_address?.phone,
  ];

  return candidates.find((value) => String(value || '').replace(/\D/g, '').length >= 10) || '';
}

function pickShopifyName(data) {
  return (
    data?.customer?.first_name ||
    data?.shipping_address?.first_name ||
    data?.billing_address?.first_name ||
    'there'
  );
}

// Sends one approved template to one customer and stores the result.
// Errors get .permanent = true when retrying cannot help.
async function sendAutomationTemplate({
  phone,
  name,
  templateName,
  params,
  campaignName,
  externalRef,
  resolveHeaderImage, // optional async () => public https image link (order picture)
}) {
  const fail = (message) => {
    const error = new Error(message);
    error.permanent = true;
    return error;
  };

  const language = SHOPIFY_TEMPLATE_LANGUAGE();
  const waId = normalizeFlowPhone(phone);

  if (!waId) throw fail(`Invalid phone number "${phone || ''}".`);

  const dbReady = mongoose.connection.readyState === 1;

  if (externalRef && dbReady) {
    const duplicate = await Message.findOne({
      externalRef,
      status: { $ne: 'failed' },
    }).lean();

    if (duplicate) return { duplicate: true, waId };
  }

  const info = await getFlowTemplateInfo(templateName, language);

  if (!info) {
    throw fail(`Template "${templateName}" (${language}) is not approved in Meta.`);
  }

  let headerMedia = null;

  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(info.headerFormat)) {
    if (info.headerFormat !== 'IMAGE') {
      throw fail(
        `Template "${templateName}" has a ${info.headerFormat} header. Automations support text or IMAGE headers only.`
      );
    }

    // The picture comes from the order (first product). Fallback: SHOPIFY_FALLBACK_IMAGE_URL.
    let link = resolveHeaderImage ? await resolveHeaderImage() : '';
    if (!isHttps(link)) link = process.env.SHOPIFY_FALLBACK_IMAGE_URL || '';

    if (!isHttps(link)) {
      throw fail(
        `Template "${templateName}" has an IMAGE header but no picture was found for this order. ` +
          'Set SHOPIFY_ADMIN_ACCESS_TOKEN (read_products) or SHOPIFY_FALLBACK_IMAGE_URL in .env.'
      );
    }

    headerMedia = { kind: 'image', link };
  }

  if (params.length < info.bodyVars) {
    throw fail(
      `Template "${templateName}" needs ${info.bodyVars} variable(s) but only ${params.length} available.`
    );
  }

  const cleaned = params.slice(0, info.bodyVars).map(cleanTemplateParam);

  const apiResult = await sendCloudApiTemplate(waId, templateName, language, cleaned, headerMedia);
  const waMessageId = apiResult?.messages?.[0]?.id || null;

  if (dbReady) {
    const saved = await Message.create({
      waMessageId,
      waId,
      contactName: String(name || '').slice(0, 100),
      direction: 'outbound',
      type: 'template',
      text: `[Template: ${templateName}]`,
      status: 'sent',
      templateName,
      campaignName,
      externalRef: externalRef || '',
      timestamp: new Date(),
      raw: apiResult,
    });

    io.emit('message:new', saved.toObject());
  }

  return { waId, waMessageId };
}

async function executeScheduledJob(job) {
  const p = job.payload || {};

  try {
    let result;

    if (job.type === 'abandoned') {
      const converted = await ShopifyEvent.exists({ key: `converted:${p.token}` });

      if (converted) {
        await ScheduledJob.updateOne(
          { _id: job._id },
          { $set: { status: 'skipped', error: 'Order was placed' } }
        );
        return;
      }

      if (!p.url) {
        const error = new Error('Checkout link missing.');
        error.permanent = true;
        throw error;
      }

      result = await sendAutomationTemplate({
        phone: p.phone,
        name: p.name,
        templateName: SHOPIFY_ABANDONED_TEMPLATE(),
        params: [p.name || 'there', p.url],
        campaignName: 'Shopify: Abandoned cart',
        externalRef: `shopify:abandoned:${p.token}`,
      });
    } else if (job.type === 'order_confirmation') {
      result = await sendAutomationTemplate({
        phone: p.phone,
        name: p.name,
        templateName: SHOPIFY_ORDER_TEMPLATE(),
        params: [p.name || 'there', p.orderNumber, p.total],
        campaignName: 'Shopify: Order confirmation',
        externalRef: `shopify:order:${p.orderId}`,
        // Only called when the template has an IMAGE header.
        resolveHeaderImage: () => getOrderImageUrl(job.shop, p.lineItems),
      });
    } else {
      const error = new Error(`Unknown job type "${job.type}".`);
      error.permanent = true;
      throw error;
    }

    await ScheduledJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'done',
          error: result.duplicate ? 'Already sent earlier' : '',
          waMessageId: result.waMessageId || '',
        },
      }
    );

    console.log(`Shopify job ${job.key}: ${result.duplicate ? 'duplicate skipped' : 'sent'}`);
  } catch (error) {
    const retryable =
      !error.permanent && (!error.status || error.status >= 500 || error.status === 429);

    if (retryable && job.attempts < SHOPIFY_MAX_ATTEMPTS) {
      await ScheduledJob.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'pending',
            runAt: new Date(Date.now() + 5 * 60000),
            error: String(error.message).slice(0, 300),
          },
        }
      );
      console.error(`Shopify job ${job.key} will retry in 5 min:`, error.message);
      return;
    }

    await ScheduledJob.updateOne(
      { _id: job._id },
      { $set: { status: 'failed', error: String(error.message).slice(0, 300) } }
    );

    console.error(`Shopify job ${job.key} failed:`, error.message);

    await recordFailedMessage({
      waId: normalizeFlowPhone(p.phone) || String(p.phone || ''),
      contactName: p.name,
      templateName:
        job.type === 'abandoned' ? SHOPIFY_ABANDONED_TEMPLATE() : SHOPIFY_ORDER_TEMPLATE(),
      campaignName:
        job.type === 'abandoned' ? 'Shopify: Abandoned cart' : 'Shopify: Order confirmation',
      error: error.message,
    });
  }
}

let shopifyRunnerBusy = false;
let shopifyStuckJobsReset = false;

async function runDueJobs() {
  if (shopifyRunnerBusy || mongoose.connection.readyState !== 1) return;

  shopifyRunnerBusy = true;

  try {
    // A job left in "running" means the server stopped in the middle of it.
    if (!shopifyStuckJobsReset) {
      await ScheduledJob.updateMany({ status: 'running' }, { $set: { status: 'pending' } });
      shopifyStuckJobsReset = true;
    }

    for (let i = 0; i < 50; i += 1) {
      const job = await ScheduledJob.findOneAndUpdate(
        { status: 'pending', runAt: { $lte: new Date() } },
        { $set: { status: 'running' }, $inc: { attempts: 1 } },
        { sort: { runAt: 1 }, new: true }
      );

      if (!job) break;

      await executeScheduledJob(job);
    }
  } catch (error) {
    console.error('Shopify job runner error:', error.message);
  } finally {
    shopifyRunnerBusy = false;
  }
}

setInterval(runDueJobs, 30000);

// Saves a Shopify buyer into the shared contact list (the one the Contacts page
// and its CSV download use), so every new customer is added automatically.
// Skips numbers that are already in the list. Never throws: a problem here
// must not stop the order-confirmation message.
async function addCustomerToAudience(data) {
  try {
    const waId = normalizeFlowPhone(pickShopifyPhone(data));
    if (!waId) return { added: false, reason: 'no valid phone' };

    const customer = data.customer || {};
    const address = data.shipping_address || data.billing_address || customer.default_address || {};

    const fullName =
      [customer.first_name || address.first_name, customer.last_name || address.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || address.name || 'Shopify Customer';

    const existing = await Audience.findOne({ key: 'default' }, { contacts: 1 }).lean();
    const list = existing?.contacts || [];

    if (list.length >= MAX_AUDIENCE_CONTACTS) {
      return { added: false, reason: 'contact list is full' };
    }

    const alreadySaved = list.some(
      (contact) => String(contact?.phone || '').replace(/\D/g, '') === waId
    );
    if (alreadySaved) return { added: false, reason: 'already in contact list' };

    const contact = cleanAudienceContact(
      {
        id: Date.now(),
        initials: fullName
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0] || '')
          .join('')
          .toUpperCase(),
        name: fullName,
        company: 'Shopify',
        phone: `+${waId}`,
        email: data.email || customer.email || '—',
        country: address.country || 'Unknown',
        status: 'Valid',
        // Only pre-select people who agreed to marketing, so a bulk campaign
        // does not go to customers who never opted in.
        selected: data.buyer_accepts_marketing === true,
      },
      0
    );

    await Audience.updateOne(
      { key: 'default' },
      {
        $push: { contacts: { $each: [contact], $position: 0 } },
        $setOnInsert: { fileName: 'Shopify customers' },
      },
      { upsert: true }
    );

    console.log(`Shopify buyer ...${waId.slice(-4)} added to contact list.`);
    return { added: true };
  } catch (error) {
    console.error('Could not add Shopify buyer to contact list:', error.message);
    return { added: false, reason: error.message };
  }
}

// Turns one Shopify webhook into queued jobs.
async function processShopifyEvent(topic, data, options = {}) {
  const shop = options.shop || '';
  const phone = pickShopifyPhone(data);
  const name = pickShopifyName(data);

  if (topic === 'orders/create') {
    const checkoutToken = data.checkout_token;

    // The customer bought: cancel the abandoned-cart message for this checkout.
    if (checkoutToken) {
      await ShopifyEvent.updateOne(
        { key: `converted:${checkoutToken}` },
        { $set: { topic, shop } },
        { upsert: true }
      );

      await ScheduledJob.updateMany(
        { key: `abandoned:${checkoutToken}`, status: 'pending' },
        { $set: { status: 'skipped', error: 'Order was placed' } }
      );
    }

    if (!phone) {
      console.log(`Shopify order ${data.order_number || data.id}: no phone number, message skipped.`);
      return { queued: false, reason: 'no phone number on the order' };
    }

    await addCustomerToAudience(data); // save the buyer in the contact list

    const orderId = data.id ?? data.order_number;

    await ScheduledJob.updateOne(
      { key: `order:${orderId}` },
      {
        $setOnInsert: {
          type: 'order_confirmation',
          status: 'pending',
          runAt: new Date(),
          attempts: 0,
          shop,
          payload: {
            phone,
            name,
            orderId,
            orderNumber: data.order_number ?? data.name,
            total: `${data.total_price} ${data.currency}`,
            // First items of the order, used to pick the picture for an IMAGE header template.
            lineItems: (Array.isArray(data.line_items) ? data.line_items : [])
              .slice(0, 5)
              .map((item) => ({
                productId: item.product_id || null,
                variantId: item.variant_id || null,
                title: String(item.title || item.name || '').slice(0, 120),
                imageUrl: item.image?.src || item.image?.url || item.image_url || '',
              })),
          },
        },
      },
      { upsert: true }
    );

    runDueJobs(); // send now, do not wait for the 30 second timer
    return { queued: true };
  }

  if (topic === 'checkouts/create' || topic === 'checkouts/update') {
    const token = data.token;

    if (!token || !phone) {
      return { queued: false, reason: 'checkout has no phone number yet' };
    }

    if (
      process.env.SHOPIFY_REQUIRE_MARKETING_CONSENT === 'true' &&
      data.buyer_accepts_marketing !== true
    ) {
      return { queued: false, reason: 'customer did not accept marketing' };
    }

    const delayMinutes =
      typeof options.delayMinutes === 'number' && options.delayMinutes >= 0
        ? options.delayMinutes
        : SHOPIFY_ABANDONED_DELAY_MIN();

    // One job per checkout: later "update" webhooks only refresh phone/link/name.
    await ScheduledJob.updateOne(
      { key: `abandoned:${token}` },
      {
        $set: {
          'payload.phone': phone,
          'payload.name': name,
          'payload.token': token,
          'payload.url': data.abandoned_checkout_url || '',
          shop,
        },
        $setOnInsert: {
          type: 'abandoned',
          status: 'pending',
          runAt: new Date(Date.now() + delayMinutes * 60000),
          attempts: 0,
        },
      },
      { upsert: true }
    );

    return { queued: true, delayMinutes };
  }

  if (topic === 'customers/create') {
    if (!pickShopifyPhone({ customer: data })) {
      return { queued: false, reason: 'customer has no phone number yet' };
    }

    // addCustomerToAudience expects an order-like object, so wrap the customer.
    const saved = await addCustomerToAudience({ customer: data });
    return {
      queued: false,
      contactAdded: Boolean(saved.added),
      reason: saved.added ? 'added to contact list' : saved.reason,
    };
  }

  return { queued: false, reason: `topic "${topic}" is not used` };
}

// Real Shopify webhook: POST /webhooks/shopify
app.post('/webhooks/shopify', async (req, res) => {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET;

  if (!secret) {
    return res.status(503).json({
      success: false,
      message: 'Add SHOPIFY_WEBHOOK_SECRET to src/server/.env.',
    });
  }

  if (!verifyShopifyHmac(req.rawBody, req.get('x-shopify-hmac-sha256'), secret)) {
    return res.sendStatus(401);
  }

  // 503 makes Shopify retry later, so nothing is lost while MongoDB is down.
  if (mongoose.connection.readyState !== 1) {
    return res.sendStatus(503);
  }

  const topic = req.get('x-shopify-topic') || '';
  const webhookId = req.get('x-shopify-webhook-id') || '';
  const shop = req.get('x-shopify-shop-domain') || '';

  try {
    // Shopify can send the same webhook twice: process only the first one.
    if (webhookId) {
      try {
        await ShopifyEvent.create({ key: `wh:${webhookId}`, topic, shop });
      } catch (error) {
        if (error.code === 11000) return res.sendStatus(200);
        throw error;
      }
    }

    const result = await processShopifyEvent(topic, req.body || {}, { shop });
    console.log(`Shopify webhook ${topic}:`, JSON.stringify(result));

    await logShopifyActivity(topic, req.body || {}, result, shop);

    return res.sendStatus(200);
  } catch (error) {
    console.error('Shopify webhook error:', error.message);
    await logShopifyActivity(topic, req.body || {}, { error: error.message }, shop);
    return res.sendStatus(500); // Shopify will retry
  }
});

// Test without Shopify:  POST /api/integrations/shopify/simulate
// Header x-flow-secret: <SHOPIFY_FLOW_SECRET>   Body: { "topic": "...", "data": {...}, "delayMinutes": 0 }
app.post('/api/integrations/shopify/simulate', async (req, res) => {
  if (!process.env.SHOPIFY_FLOW_SECRET) {
    return res.status(503).json({
      success: false,
      message: 'Add SHOPIFY_FLOW_SECRET to src/server/.env first.',
    });
  }

  if (!flowAuthorized(req)) {
    return res.status(401).json({ success: false, message: 'Invalid or missing x-flow-secret.' });
  }

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'MongoDB is not connected.' });
  }

  const { topic, data, delayMinutes } = req.body || {};

  if (!topic || typeof data !== 'object' || !data) {
    return res.status(400).json({ success: false, message: 'topic and data are required.' });
  }

  try {
    const result = await processShopifyEvent(topic, data, { shop: 'simulated', delayMinutes });
    await logShopifyActivity(topic, data, result, 'simulated');
    await runDueJobs();
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// SHOPIFY ACTIVITY LOG START
// Every Shopify customer / checkout / order webhook is recorded here, so the ReachPulse
// dashboard can show what arrived from Shopify and what the automation did with it.
function maskPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : '';
}

function buildShopifyActivity(topic, data, result) {
  const d = data || {};
  const person = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(' ');
  const money = (amount, currency) => (amount ? `${amount} ${currency || ''}`.trim() : '');
  const customer = d.customer || {};
  let a;

  if (topic === 'customers/create') {
    if (!d.id) return null;
    a = {
      kind: 'customer',
      key: `customer:${d.id}`,
      ref: String(d.id),
      name: person(d),
      phone: pickShopifyPhone({ customer: d }),
      amount: '',
      itemCount: 0,
    };
  } else if (topic === 'checkouts/create' || topic === 'checkouts/update') {
    if (!d.token) return null;
    a = {
      kind: 'checkout',
      key: `checkout:${d.token}`,
      ref: String(d.token).slice(0, 8),
      name: person(customer) || person(d.shipping_address) || person(d.billing_address),
      phone: pickShopifyPhone(d),
      amount: money(d.total_price, d.currency || d.presentment_currency),
      itemCount: Array.isArray(d.line_items) ? d.line_items.length : 0,
    };
  } else if (topic === 'orders/create') {
    const id = d.id ?? d.order_number;
    if (!id) return null;
    a = {
      kind: 'order',
      key: `order:${id}`,
      ref: `#${d.order_number ?? id}`,
      name: person(customer) || person(d.shipping_address) || person(d.billing_address),
      phone: pickShopifyPhone(d),
      amount: money(d.total_price, d.currency),
      itemCount: Array.isArray(d.line_items) ? d.line_items.length : 0,
    };
  } else {
    return null;
  }

  let outcome = 'skipped';
  let note = result?.reason || '';

  if (result?.error) {
    outcome = 'error';
    note = result.error;
  } else if (result?.queued) {
    outcome = 'queued';
    note =
      a.kind === 'checkout'
        ? `Abandoned-cart message in ${result.delayMinutes ?? '?'} min`
        : 'Order confirmation queued';
  } else if (result?.contactAdded) {
    outcome = 'added';
    note = 'Added to contact list';
  } else if (result?.reason === 'already in contact list') {
    outcome = 'exists';
    note = 'Already in contact list';
  }

  const { phone, ...rest } = a;
  return {
    ...rest,
    name: String(a.name || '').slice(0, 100),
    phoneMasked: maskPhone(phone),
    hasPhone: Boolean(phone),
    outcome,
    note: String(note || '').slice(0, 300),
  };
}

function publicShopifyActivity(item) {
  return {
    id: String(item._id),
    kind: item.kind,
    topic: item.topic,
    name: item.name,
    phoneMasked: item.phoneMasked,
    hasPhone: item.hasPhone,
    ref: item.ref,
    amount: item.amount,
    itemCount: item.itemCount,
    outcome: item.outcome,
    note: item.note,
    events: item.events,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// Never throws: a logging problem must not stop the real automation.
async function logShopifyActivity(topic, data, result, shop) {
  try {
    if (mongoose.connection.readyState !== 1) return;

    const activity = buildShopifyActivity(topic, data, result);
    if (!activity) return;

    const { key, ...fields } = activity;
    const saved = await ShopifyActivity.findOneAndUpdate(
      { key },
      { $set: { ...fields, topic, shop: shop || '' }, $inc: { events: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // The customer bought: mark the matching checkout as converted.
    if (activity.kind === 'order' && data?.checkout_token) {
      await ShopifyActivity.updateOne(
        { key: `checkout:${data.checkout_token}` },
        { $set: { outcome: 'converted', note: 'Order placed' } }
      );
    }

    io.emit('shopify:event', publicShopifyActivity(saved));
  } catch (error) {
    console.error('Could not log Shopify activity:', error.message);
  }
}

// GET /api/integrations/shopify/events?limit=30
app.get('/api/integrations/shopify/events', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'MongoDB is not connected.' });
  }

  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [events, customers, checkouts, orders] = await Promise.all([
      ShopifyActivity.find().sort({ updatedAt: -1 }).limit(limit).lean(),
      ShopifyActivity.countDocuments({ kind: 'customer', createdAt: { $gte: since } }),
      ShopifyActivity.countDocuments({ kind: 'checkout', createdAt: { $gte: since } }),
      ShopifyActivity.countDocuments({ kind: 'order', createdAt: { $gte: since } }),
    ]);

    return res.json({
      success: true,
      counts: { customers, checkouts, orders }, // last 24 hours
      events: events.map(publicShopifyActivity),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});
// SHOPIFY ACTIVITY LOG END

// SHOPIFY TEMPLATE VERIFICATION START
// GET /api/integrations/shopify/templates/verify
// Checks, live in Meta, that the templates used by the Shopify automations exist, are
// APPROVED and match what the automation sends. Optional: ?name=my_template&language=en_US
// adds one more template (for example one used in a Shopify Flow action).
const SHOPIFY_TEMPLATE_RULES = () => [
  {
    key: 'order_confirmation',
    label: 'Order confirmation',
    templateName: SHOPIFY_ORDER_TEMPLATE(),
    expectedVars: 3, // {{1}} name, {{2}} order number, {{3}} total
    allowedHeaders: ['NONE', 'TEXT', 'IMAGE'],
  },
  {
    key: 'abandoned_cart',
    label: 'Abandoned cart',
    templateName: SHOPIFY_ABANDONED_TEMPLATE(),
    expectedVars: 2, // {{1}} name, {{2}} checkout link
    allowedHeaders: ['NONE', 'TEXT'],
  },
];

async function verifyShopifyTemplate({ key, label, templateName, language, expectedVars, allowedHeaders }) {
  const issues = [];
  const warnings = [];

  const result = await callMetaGraphApi(
    'GET',
    `${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates` +
      `?name=${encodeURIComponent(templateName)}` +
      `&fields=id,name,status,language,category,components,rejected_reason`
  );

  const sameName = (result.data || []).filter((item) => item.name === templateName);
  const template = sameName.find((item) => item.language === language);

  const base = {
    key,
    label,
    templateName,
    language,
    found: Boolean(template),
    status: template?.status || 'NOT_FOUND',
    category: template?.category || '',
    rejectedReason: template?.rejected_reason && template.rejected_reason !== 'NONE'
      ? template.rejected_reason
      : '',
    headerFormat: 'NONE',
    bodyVars: 0,
    expectedVars: expectedVars ?? null,
  };

  if (!template) {
    issues.push(
      sameName.length
        ? `Template exists only in: ${sameName.map((item) => item.language).join(', ')}. Create it in ${language} or change SHOPIFY_TEMPLATE_LANGUAGE.`
        : `Template "${templateName}" does not exist in Meta. Create it in Your Templates.`
    );
    return { ...base, issues, warnings, ready: false };
  }

  const header = (template.components || []).find((c) => c.type === 'HEADER');
  const body = (template.components || []).find((c) => c.type === 'BODY');
  base.headerFormat = header?.format || 'NONE';
  base.bodyVars = new Set(
    [...String(body?.text || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])
  ).size;

  if (template.status === 'PENDING') {
    issues.push('Still waiting for Meta approval. Messages cannot be sent yet.');
  } else if (template.status === 'REJECTED') {
    issues.push(`Rejected by Meta${base.rejectedReason ? ` (${base.rejectedReason})` : ''}. Edit and resubmit it.`);
  } else if (template.status !== 'APPROVED') {
    issues.push(`Status is ${template.status}. Only APPROVED templates can be sent.`);
  }

  if (!allowedHeaders.includes(base.headerFormat)) {
    issues.push(`${base.headerFormat} header is not supported for this automation.`);
  }

  if (expectedVars !== null) {
    if (base.bodyVars > expectedVars) {
      issues.push(`Template has ${base.bodyVars} variables but this automation sends only ${expectedVars}.`);
    } else if (base.bodyVars < expectedVars) {
      warnings.push(`Template uses ${base.bodyVars} of the ${expectedVars} values the automation sends. Extra values are ignored.`);
    }
  }

  if (key === 'order_confirmation' && base.headerFormat === 'IMAGE') {
    const hasToken = Boolean(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN);
    const hasFallback = isHttps(process.env.SHOPIFY_FALLBACK_IMAGE_URL);
    if (!hasToken && !hasFallback) {
      issues.push('IMAGE header needs SHOPIFY_ADMIN_ACCESS_TOKEN (order picture) or SHOPIFY_FALLBACK_IMAGE_URL in .env.');
    } else if (!hasToken) {
      warnings.push('No SHOPIFY_ADMIN_ACCESS_TOKEN: every order will use the fallback picture.');
    }
  }

  return { ...base, issues, warnings, ready: issues.length === 0 };
}

app.get('/api/integrations/shopify/templates/verify', async (req, res) => {
  if (!requireWabaConfig(res)) return;

  try {
    const language = String(req.query.language || SHOPIFY_TEMPLATE_LANGUAGE());
    const checks = SHOPIFY_TEMPLATE_RULES().map((rule) => ({ ...rule, language }));

    const extraName = String(req.query.name || '').trim();
    if (extraName) {
      checks.push({
        key: 'custom',
        label: 'Flow template',
        templateName: extraName,
        language,
        expectedVars: null,
        allowedHeaders: ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'],
      });
    }

    flowTemplateCache.clear(); // next automation send also sees the fresh status

    const templates = [];
    for (const check of checks) {
      templates.push(await verifyShopifyTemplate(check));
    }

    return res.json({
      success: true,
      checkedAt: new Date().toISOString(),
      language,
      allReady: templates.every((item) => item.ready),
      templates,
    });
  } catch (error) {
    console.error('Shopify template verification error:', error.message);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});
// SHOPIFY TEMPLATE VERIFICATION END

// Recent automation jobs (to see what is waiting / sent / failed).
app.get('/api/integrations/shopify/jobs', async (req, res) => {
  if (!process.env.SHOPIFY_FLOW_SECRET || !flowAuthorized(req)) {
    return res.status(401).json({ success: false, message: 'Invalid or missing x-flow-secret.' });
  }

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'MongoDB is not connected.' });
  }

  const jobs = await ScheduledJob.find({}).sort({ createdAt: -1 }).limit(50).lean();

  return res.json({
    success: true,
    jobs: jobs.map((job) => ({
      key: job.key,
      type: job.type,
      status: job.status,
      runAt: job.runAt,
      attempts: job.attempts,
      error: job.error,
      phone: job.payload?.phone ? `…${String(job.payload.phone).slice(-4)}` : '',
    })),
  });
});

// --------------------------------------------------
// DASHBOARD LIVE STATS
// GET /api/dashboard/stats?days=7
// Everything is computed from real messages stored in MongoDB, so any
// message sent to a client (campaign, template, chat reply) shows up here.
// --------------------------------------------------

const activeCampaigns = new Map();

function publicCampaign(campaign) {
  return {
    id: campaign.id,
    name: campaign.name,
    templateName: campaign.templateName,
    total: campaign.total,
    done: campaign.done,
    sent: campaign.sent,
    failed: campaign.failed,
    startedAt: campaign.startedAt,
  };
}

function emitCampaignProgress(campaign, results) {
  campaign.done = results.length;
  campaign.sent = results.filter((item) => item.status === 'sent').length;
  campaign.failed = results.length - campaign.sent;
  io.emit('campaign:progress', publicCampaign(campaign));
}

// Store a failed send so it is visible in dashboard numbers.
async function recordFailedMessage({ waId, contactName, templateName, campaignName, error, externalRef }) {
  try {
    const saved = await Message.create({
      waId,
      contactName: contactName || '',
      direction: 'outbound',
      type: 'template',
      text: `[Template: ${templateName}]`,
      status: 'failed',
      templateName,
      campaignName: campaignName || '',
      externalRef: externalRef || '',
      errorMessage: String(error || '').slice(0, 500),
      timestamp: new Date(),
    });
    io.emit('message:new', saved.toObject());
  } catch (saveError) {
    console.error('Could not store failed message:', saveError.message);
  }
}

app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const days = [7, 30, 90].includes(Number(req.query.days))
      ? Number(req.query.days)
      : 7;

    const now = Date.now();
    const start = new Date(now - days * 86400000);
    const prevStart = new Date(now - 2 * days * 86400000);
    const queueSince = new Date(now - 15 * 60000);

    const countsPipeline = [
      { $group: { _id: { d: '$direction', s: '$status' }, n: { $sum: 1 } } },
    ];

    const [facet] = await Message.aggregate([
      { $match: { timestamp: { $gte: prevStart } } },
      {
        $facet: {
          cur: [{ $match: { timestamp: { $gte: start } } }, ...countsPipeline],
          prev: [{ $match: { timestamp: { $lt: start } } }, ...countsPipeline],
          outContacts: [
            { $match: { timestamp: { $gte: start }, direction: 'outbound' } },
            { $group: { _id: '$waId' } },
          ],
          inContacts: [
            { $match: { timestamp: { $gte: start }, direction: 'inbound' } },
            { $group: { _id: '$waId' } },
          ],
          queue: [
            { $match: { direction: 'outbound', status: 'sent', timestamp: { $gte: queueSince } } },
            { $count: 'n' },
          ],
          recentFailures: [
            { $match: { direction: 'outbound', status: 'failed', timestamp: { $gte: start } } },
            { $sort: { timestamp: -1 } },
            { $limit: 5 },
            { $project: { _id: 0, waId: 1, templateName: 1, errorMessage: 1, timestamp: 1 } },
          ],
        },
      },
    ]);

    const summarize = (rows) => {
      const out = { sent: 0, delivered: 0, read: 0, failed: 0, inbound: 0 };
      for (const row of rows || []) {
        const { d, s } = row._id;
        if (d === 'inbound') {
          out.inbound += row.n;
        } else if (s === 'failed') {
          out.failed += row.n;
        } else {
          out.sent += row.n; // accepted by WhatsApp (sent / delivered / read)
          if (s === 'delivered' || s === 'read') out.delivered += row.n;
          if (s === 'read') out.read += row.n;
        }
      }
      return out;
    };

    const cur = summarize(facet.cur);
    const prev = summarize(facet.prev);

    const outIds = new Set(facet.outContacts.map((item) => item._id));
    const inIds = facet.inContacts.map((item) => item._id);
    const replied = inIds.filter((id) => outIds.has(id)).length;

    const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
    const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

    return res.json({
      success: true,
      days,
      generatedAt: new Date().toISOString(),
      sent: cur.sent,
      sentChangePct: pct(cur.sent, prev.sent),
      delivered: cur.delivered,
      read: cur.read,
      readRate: ratio(cur.read, cur.delivered),
      failed: cur.failed,
      failRate: ratio(cur.failed, cur.sent + cur.failed),
      conversations: inIds.length,
      recipients: outIds.size,
      replied,
      replyRate: ratio(replied, outIds.size),
      queued: facet.queue[0]?.n || 0,
      activeCampaigns: [...activeCampaigns.values()].map(publicCampaign),
      recentFailures: facet.recentFailures,
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// --------------------------------------------------
// META WEBHOOK SIGNATURE VALIDATION
// --------------------------------------------------

function validMetaSignature(req) {
  if (!process.env.WHATSAPP_APP_SECRET) {
    // Allow local development without an App Secret.
    // Production must have WHATSAPP_APP_SECRET configured.
    return process.env.NODE_ENV !== 'production';
  }

  const signature = req.get('x-hub-signature-256');

  if (!signature || !req.rawBody) {
    return false;
  }

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
      .update(req.rawBody)
      .digest('hex');

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

// --------------------------------------------------
// META WEBHOOK
// POST /webhook
// --------------------------------------------------

app.post('/webhook', async (req, res) => {
  if (!validMetaSignature(req)) {
    return res.status(401).send('Invalid webhook signature');
  }

  // Acknowledge Meta quickly.
  res.sendStatus(200);

  try {
    const entries = req.body?.entry || [];

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        if (change.field !== 'messages') {
          continue;
        }

        const contacts = value.contacts || [];

        // ------------------------------------------
        // INBOUND MESSAGES
        // ------------------------------------------

        for (const item of value.messages || []) {
          const waId = String(item.from || '');

          const contact = contacts.find(
            (c) => c.wa_id === waId
          );

          const text =
            item.text?.body ||
            item.button?.text ||
            item.interactive?.button_reply?.title ||
            item.interactive?.list_reply?.title ||
            (item.type === 'image'
              ? '[Image]'
              : item.type === 'document'
                ? '[Document]'
                : item.type === 'audio'
                  ? '[Audio]'
                  : item.type === 'video'
                    ? '[Video]'
                    : `[${item.type || 'message'}]`);

          // Meta retries webhooks: only auto-reply the first time we see a message.
          const alreadySeen = await Message.exists({
            waMessageId: item.id,
          });

          // Avoid inserting duplicate messages when Meta retries.
          const saved = await Message.findOneAndUpdate(
            {
              waMessageId: item.id,
            },
            {
              $setOnInsert: {
                waMessageId: item.id,
                waId,
                contactName: contact?.profile?.name || '',
                direction: 'inbound',
                type: item.type || 'text',
                text,
                status: 'received',
                timestamp: item.timestamp
                  ? new Date(Number(item.timestamp) * 1000)
                  : new Date(),
                raw: item,
              },
            },
            {
              upsert: true,
              new: true,
              setDefaultsOnInsert: true,
            }
          );

          io.emit('message:new', saved.toObject());

          // AI auto-reply (runs in the background so the webhook loop is not blocked).
          if (!alreadySeen) {
            maybeAutoReply(saved.toObject(), {
              sendText: sendCloudApiText,
              io,
            }).catch((autoReplyError) => {
              console.error('AI auto-reply error:', autoReplyError.message);
            });
          }
        }

        // ------------------------------------------
        // MESSAGE STATUS UPDATES
        // sent / delivered / read / failed
        // ------------------------------------------

        const STATUS_RANK = { sent: 1, delivered: 2, read: 3 };

        for (const status of value.statuses || []) {
          const existing = await Message.findOne({
            waMessageId: status.id,
          });

          if (!existing) continue;

          const next = status.status || 'unknown';
          const update = {};

          if (next === 'failed') {
            update.status = 'failed';
            update.errorMessage = String(
              status.errors?.[0]?.error_data?.details ||
                status.errors?.[0]?.message ||
                status.errors?.[0]?.title ||
                'Delivery failed'
            ).slice(0, 500);
          } else if (
            (STATUS_RANK[next] || 0) > (STATUS_RANK[existing.status] || 0)
          ) {
            // Webhooks can arrive out of order: never go from read back to delivered.
            update.status = next;
          }

          if (Object.keys(update).length === 0) continue;

          await Message.updateOne({ _id: existing._id }, { $set: update });

          io.emit('message:status', {
            waMessageId: status.id,
            waId: existing.waId,
            status: update.status,
          });
        }
      }
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
  }
});

// --------------------------------------------------
// GLOBAL ERROR HANDLER
// --------------------------------------------------

app.use((error, req, res, next) => {
  console.error('Backend error:', error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// --------------------------------------------------
// SOCKET.IO CONNECTION
// --------------------------------------------------

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.emit('inbox:connected', {
    connected: true,
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// --------------------------------------------------
// DATABASE CONNECTION & SERVER START
// --------------------------------------------------

async function start() {
  try {
    if (process.env.MONGODB_URI) {
      try {
        await mongoose.connect(process.env.MONGODB_URI, {
          serverSelectionTimeoutMS: 3000,
        });

        console.log('MongoDB connected');
      } catch (error) {
        console.log(
          'MongoDB unavailable. Running without database.'
        );

        console.error(error.message);
      }
    } else {
      console.log('MONGODB_URI is not configured.');
    }

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend listening on port ${PORT}`);
      console.log('Allowed CORS origins:', ALLOWED_ORIGINS.join(', '));
    });
  } catch (error) {
    console.error('Backend startup failed:', error.message);
    process.exit(1);
  }
}

start();