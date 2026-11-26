const express = require('express');
const BotConfig = require('../models/BotConfig');
const KnowledgeItem = require('../models/KnowledgeItem');
const ConversationState = require('../models/ConversationState');
const { generateReply } = require('../services/autoReply');

module.exports = function createAutomationRouter(io) {
  const router = express.Router();

  // ---- Bot settings -------------------------------------------------------

  router.get('/config', async (req, res) => {
    res.json(await BotConfig.getSingleton());
  });

  router.put('/config', async (req, res) => {
    const body = req.body || {};
    const update = {};

    if (typeof body.enabled === 'boolean') update.enabled = body.enabled;
    if (typeof body.strictMode === 'boolean') update.strictMode = body.strictMode;
    if (typeof body.instructions === 'string') update.instructions = body.instructions.slice(0, 4000);
    if (typeof body.fallbackMessage === 'string') update.fallbackMessage = body.fallbackMessage.slice(0, 1000);
    if (BotConfig.TONES.includes(body.tone)) update.tone = body.tone;

    await BotConfig.getSingleton(); // make sure the document exists
    const config = await BotConfig.findOneAndUpdate({ key: 'default' }, { $set: update }, { new: true });
    res.json(config);
  });

  // ---- Knowledge base -----------------------------------------------------

  router.get('/knowledge', async (req, res) => {
    res.json(await KnowledgeItem.find().sort({ createdAt: -1 }));
  });

  router.post('/knowledge', async (req, res) => {
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Content is required.' });
    const item = await KnowledgeItem.create({
      title: String(req.body?.title || '').slice(0, 200),
      content: content.slice(0, 4000),
    });
    res.status(201).json(item);
  });

  router.put('/knowledge/:id', async (req, res) => {
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Content is required.' });
    const item = await KnowledgeItem.findByIdAndUpdate(
      req.params.id,
      { title: String(req.body?.title || '').slice(0, 200), content: content.slice(0, 4000) },
      { new: true }
    );
    if (!item) return res.status(404).json({ error: 'Entry not found.' });
    res.json(item);
  });

  router.delete('/knowledge/:id', async (req, res) => {
    await KnowledgeItem.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  });

  // ---- Test playground (nothing is sent to WhatsApp) -----------------------

  router.post('/test', async (req, res) => {
    try {
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-30) : [];
      res.json(await generateReply(history));
    } catch (error) {
      console.error('Automation test error:', error.message);
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  // ---- Per-conversation bot state ----------------------------------------

  router.get('/state/:waId', async (req, res) => {
    const state = await ConversationState.findOne({ waId: req.params.waId }).lean();
    res.json({
      botPaused: Boolean(state?.botPaused),
      pausedReason: state?.pausedReason || '',
    });
  });

  router.post('/state/:waId/resume', async (req, res) => {
    await ConversationState.findOneAndUpdate(
      { waId: req.params.waId },
      { botPaused: false, pausedReason: '' },
      { upsert: true, setDefaultsOnInsert: true }
    );
    io.emit('bot:state', { waId: req.params.waId, botPaused: false });
    res.json({ botPaused: false });
  });

  return router;
};
