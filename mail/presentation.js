import express from 'express';
import { catchException } from '../common/exceptions.js';
import { MailService } from './service.js';

const router = express.Router();
const mailService = new MailService();

/**
 * @swagger
 * /mail/recv:
 *   post:
 *     summary: Receive email and process summary
 *     tags: [Mail]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               s3_object_key:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email received and processing started
 */
router.post('/recv', async (req, res, next) => {
  try {
    const { s3_object_key } = req.body;
    // Run in background (fire and forget)
    mailService.recv(s3_object_key).catch(error => {
      console.error('Background task error:', error);
    });
    res.status(200).json({ message: 'I received an email. Summary tasks run in the background.' });
  } catch (error) {
    catchException(error, req, next);
  }
});

/**
 * @swagger
 * /mail:
 *   get:
 *     summary: Get mail by s3 object key
 *     tags: [Mail]
 *     parameters:
 *       - in: query
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Mail data
 */
router.get('', async (req, res, next) => {
  try {
    const { key } = req.query;
    const mail = await mailService.read(key);
    res.status(200).json(mail);
  } catch (error) {
    catchException(error, req, next);
  }
});

/**
 * @swagger
 * /mail/summary-again:
 *   patch:
 *     summary: Re-summarize mail
 *     tags: [Mail]
 *     parameters:
 *       - in: query
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Summary updated successfully
 */
router.patch('/summary-again', async (req, res, next) => {
  try {
    const { key } = req.query;
    await mailService.summaryAgain(key);
    res.status(204).send();
  } catch (error) {
    catchException(error, req, next);
  }
});

export { router as mailRouter };

