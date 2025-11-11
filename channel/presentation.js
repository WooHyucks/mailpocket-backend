import express from 'express';
import { catchException } from '../common/exceptions.js';
import { Token } from '../common/token.js';
import { ChannelService } from './service.js';

const router = express.Router();
const channelService = new ChannelService();

router.get('', async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;
    const user_id = Token.getUserIdByToken(authorization);
    const channels = await channelService.getChannels(user_id);
    res.status(200).json(channels);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.post('', async (req, res, next) => {
  try {
    const { code } = req.body;
    const authorization = req.headers.authorization;
    const user_id = Token.getUserIdByToken(authorization);
    const channel_id = await channelService.addChannel(code, user_id);
    res.setHeader('Location', `channel/${channel_id}`);
    res.status(201).send();
  } catch (error) {
    catchException(error, req, next);
  }
});

router.get('/:channel_id', async (req, res, next) => {
  try {
    const { channel_id } = req.params;
    const authorization = req.headers.authorization;
    const user_id = Token.getUserIdByToken(authorization);
    const channel = await channelService.getChannel(user_id, parseInt(channel_id));
    res.status(200).json(channel);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.delete('/:channel_id', async (req, res, next) => {
  try {
    const { channel_id } = req.params;
    const authorization = req.headers.authorization;
    const user_id = Token.getUserIdByToken(authorization);
    await channelService.removeChannel(user_id, parseInt(channel_id));
    res.status(204).send();
  } catch (error) {
    catchException(error, req, next);
  }
});

export { router as channelRouter };

