import express from 'express';
import { catchException } from '../common/exceptions.js';
import { Oauth } from '../common/oauth.js';
import { Token } from '../common/token.js';
import { UserService } from './service.js';

const router = express.Router();
const userService = new UserService();

router.get('', async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;
    const user_id = Token.getUserIdByToken(authorization);
    const user = await userService.read(user_id);
    res.status(200).json(user);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.post('', async (req, res, next) => {
  try {
    const user = await userService.createNonMemberUser();
    const token = Token.createTokenByUser(user);
    res.status(201).send(token);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.post('/sign-up', async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    const authorization = req.headers.authorization;
    
    let user;
    if (authorization) {
      const user_id = Token.getUserIdByToken(authorization);
      user = await userService.upgradeNonMemberUserToMember(user_id, identifier, password);
    } else {
      user = await userService.signUp(identifier, password);
    }
    const token = Token.createTokenByUser(user);
    res.status(201).send(token);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.post('/sign-in', async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    const user = await userService.signIn(identifier, password);
    const token = Token.createTokenByUser(user);
    res.status(201).send(token);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.post('/google-login', async (req, res, next) => {
  try {
    const { token } = req.body;
    const authorization = req.headers.authorization;
    const platform = 'google';
    const platform_id = await Oauth.getUserPlatformIdByGoogleOauth(token);
    
    let user;
    if (authorization) {
      const user_id = Token.getUserIdByToken(authorization);
      user = await userService.upgradeNonMemberUserToMember(user_id, null, null, platform_id, platform);
    } else {
      user = await userService.oauthLogin(platform_id, platform);
    }
    const tokenResponse = Token.createTokenByUser(user);
    res.status(201).send(tokenResponse);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.post('/kakao-login', async (req, res, next) => {
  try {
    const { token } = req.body;
    const authorization = req.headers.authorization;
    const platform = 'kakao';
    const platform_id = await Oauth.getUserPlatformIdByKakaoOauth(token);
    
    let user;
    if (authorization) {
      const user_id = Token.getUserIdByToken(authorization);
      user = await userService.upgradeNonMemberUserToMember(user_id, null, null, platform_id, platform);
    } else {
      user = await userService.oauthLogin(platform_id, platform);
    }
    const tokenResponse = Token.createTokenByUser(user);
    res.status(201).send(tokenResponse);
  } catch (error) {
    catchException(error, req, next);
  }
});

router.post('/naver-login', async (req, res, next) => {
  try {
    const { token } = req.body;
    const authorization = req.headers.authorization;
    const platform = 'naver';
    const platform_id = await Oauth.getUserPlatformIdByNaverOauth(token);
    
    let user;
    if (authorization) {
      const user_id = Token.getUserIdByToken(authorization);
      user = await userService.upgradeNonMemberUserToMember(user_id, null, null, platform_id, platform);
    } else {
      user = await userService.oauthLogin(platform_id, platform);
    }
    const tokenResponse = Token.createTokenByUser(user);
    res.status(201).send(tokenResponse);
  } catch (error) {
    catchException(error, req, next);
  }
});

export { router as userRouter };

