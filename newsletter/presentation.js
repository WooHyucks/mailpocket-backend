import express from 'express';
import { catchException } from '../common/exceptions.js';
import { Token } from '../common/token.js';
import { MailService } from '../mail/service.js';
import { NewsLetterService } from './service.js';

const router = express.Router();
const newsletterService = new NewsLetterService();
const mailService = new MailService();

router.get('', async (req, res, next) => {
  try {
    const { subscribe_status, sort_type, in_mail, cursor, category_id } = req.query;
    const authorization = req.headers.authorization;
    const user_id = Token.getUserIdByToken(authorization);
    const newsletters = await newsletterService.getNewsletters(
      user_id,
      subscribe_status,
      sort_type,
      in_mail === 'true',
      cursor ? parseInt(cursor) : null,
      category_id ? parseInt(category_id) : null
    );
    res.status(200).json(newsletters);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.put('/subscribe', async (req, res, next) => {
  try {
    const { ids } = req.body;
    const authorization = req.headers.authorization;
    const user_id = Token.getUserIdByToken(authorization);
    await newsletterService.newslettersSubscribe(user_id, ids);
    res.status(201).send();
  } catch (error) {
    catchException(error, req, next);
  }
});

router.post('/:newsletter_id/subscribe', async (req, res, next) => {
  try {
    const { newsletter_id } = req.params;
    const authorization = req.headers.authorization;
    const user_id = Token.getUserIdByToken(authorization);
    await newsletterService.newsletterSubscribe(user_id, parseInt(newsletter_id));
    res.status(201).send();
  } catch (error) {
    catchException(error, req, next);
  }
});

router.delete('/:newsletter_id/subscribe', async (req, res, next) => {
  try {
    const { newsletter_id } = req.params;
    const authorization = req.headers.authorization;
    const user_id = Token.getUserIdByToken(authorization);
    await newsletterService.newsletterSubscribeCancel(user_id, parseInt(newsletter_id));
    res.status(204).send();
  } catch (error) {
    catchException(error, req, next);
  }
});

router.get('/:newsletter_id/mail', async (req, res, next) => {
  try {
    const { newsletter_id } = req.params;
    const authorization = req.headers.authorization;
    Token.getUserIdByToken(authorization);
    const newsletter = await newsletterService.getNewsletterWithPreviousMailListByNewsletterId(parseInt(newsletter_id));
    res.status(200).json(newsletter);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.get('/:newsletter_id/last-mail', async (req, res, next) => {
  try {
    const { newsletter_id } = req.params;
    const authorization = req.headers.authorization;
    Token.getUserIdByToken(authorization);
    const mail = await mailService.getLastMailOfNewsletterByNewsletterId(parseInt(newsletter_id));
    res.status(200).json(mail);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.get('/categories', async (req, res, next) => {
  try {
    const categoryList = await newsletterService.getCategoryList();
    res.status(200).json(categoryList);
  } catch (error) {
    catchException(error, req, next);
  }
});

export { router as newsletterRouter };

