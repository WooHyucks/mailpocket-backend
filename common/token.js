import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { TokenIsMissingException, InvalidTokenException } from './exceptions.js';

dotenv.config();

const secretKey = process.env.JWT_SECRET_KEY || 'default-secret-key';

export class Token {
  static createTokenByUser(user) {
    const payload = {
      id: user.id,
      is_member: user.is_member,
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
    };
    return jwt.sign(payload, secretKey);
  }

  static getUserIdByToken(token) {
    if (!token) {
      throw new TokenIsMissingException();
    }
    
    try {
      // Remove 'Bearer ' prefix if present
      const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const tokenInfo = jwt.verify(cleanToken, secretKey);
      return tokenInfo.id;
    } catch (error) {
      throw new InvalidTokenException();
    }
  }
}


