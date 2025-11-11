import axios from 'axios';
import dotenv from 'dotenv';
import { InvalidOauthException } from './exceptions.js';

dotenv.config();

const kakaoClientId = process.env.KAKAO_CLIENT_ID;
const kakaoRedirectUrl = process.env.KAKAO_REDIRECT_URL;
const naverClientId = process.env.NAVER_CLIENT_ID;
const naverClientSecret = process.env.NAVER_CLIENT_SECRET;
const naverState = process.env.NAVER_STATE;

export class Oauth {
  static async getUserPlatformIdByGoogleOauth(token) {
    try {
      const response = await axios.get(
        `https://www.googleapis.com/oauth2/v1/userinfo?access_token=${token}`
      );
      const platformId = response.data.id;
      if (platformId) {
        return platformId;
      } else {
        throw new InvalidOauthException();
      }
    } catch (error) {
      throw new InvalidOauthException();
    }
  }

  static async getUserPlatformIdByKakaoOauth(token) {
    try {
      const accessToken = await this._getUserAccessTokenByKakaoOauth(token);
      const response = await axios.get('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const platformId = response.data.id;
      if (platformId) {
        return platformId;
      } else {
        throw new InvalidOauthException();
      }
    } catch (error) {
      throw new InvalidOauthException();
    }
  }

  static async _getUserAccessTokenByKakaoOauth(token) {
    const data = {
      grant_type: 'authorization_code',
      client_id: kakaoClientId,
      redirect_uri: kakaoRedirectUrl,
      code: token
    };
    const response = await axios.post('https://kauth.kakao.com/oauth/token', data);
    return response.data.access_token;
  }

  static async getUserPlatformIdByNaverOauth(token) {
    try {
      const accessToken = await this._getUserAccessTokenByNaverOauth(token);
      const response = await axios.get('https://openapi.naver.com/v1/nid/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const platformId = response.data.response.id;
      if (platformId) {
        return platformId;
      } else {
        throw new InvalidOauthException();
      }
    } catch (error) {
      throw new InvalidOauthException();
    }
  }

  static async _getUserAccessTokenByNaverOauth(token) {
    const response = await axios.post(
      `https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id=${naverClientId}&client_secret=${naverClientSecret}&code=${token}&state=${naverState}`
    );
    return response.data.access_token;
  }
}


