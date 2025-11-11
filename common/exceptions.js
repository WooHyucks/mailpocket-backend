import fs from 'fs';

const logFile = './backend_error.log';

function logError(message) {
  const logMessage = `${new Date().toISOString()} - ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.error(logMessage);
}

export function catchException(error, req, next) {
  const date = new Date();
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection?.remoteAddress;
  const requestPath = req.path || req.url;

  if (error instanceof CustomException) {
    const logMessage = `\n===\ndate:${date}, ip:${clientIp}, request path:${requestPath}\nA custom error occurred. : ${error.message}\n===`;
    logError(logMessage);
    console.log(logMessage);
    
    const httpError = new HttpException(error.statusCode, error.detail);
    if (next) {
      next(httpError);
    } else {
      throw httpError;
    }
    return;
  }

  const logMessage = `\n===\ndate:${date}, ip:${clientIp}, request path:${requestPath}\nAn unexpected error occurred. : ${error.message}\ndetail : ${error.stack}===\n`;
  logError(logMessage);
  console.log(logMessage);
  
  const httpError = new HttpException(500, 'An internal server error occurred. If the problem persists, please contact our support team.');
  if (next) {
    next(httpError);
  } else {
    throw httpError;
  }
}

export class CustomException extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = 500;
    this.detail = message;
  }
}

export class HttpException extends Error {
  constructor(statusCode, detail) {
    super(detail);
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export class IdentifierAlreadyException extends CustomException {
  constructor(identifier) {
    super(`sign-up ${identifier} this identifier is already`);
    this.statusCode = 409;
    this.detail = 'this identifier is already.';
  }
}

export class TokenIsMissingException extends CustomException {
  constructor() {
    super('authorization token is missing.');
    this.statusCode = 401;
    this.detail = 'authorization token is missing.';
  }
}

export class InvalidTokenException extends CustomException {
  constructor() {
    super('invalid authorization token.');
    this.statusCode = 401;
    this.detail = 'invalid authorization token.';
  }
}

export class PasswordNotMatchException extends CustomException {
  constructor(identifier, password) {
    super(`sign-in password(${password}) is not match to identifier(${identifier}).`);
    this.statusCode = 401;
    this.detail = 'incorrect identifier or password.';
  }
}

export class IdentifierNotFoundException extends CustomException {
  constructor(identifier) {
    super(`sign-in identifier(${identifier}) is not found.`);
    this.statusCode = 401;
    this.detail = 'incorrect identifier or password.';
  }
}

export class UnknownFromEamilException extends CustomException {
  constructor(from_email) {
    super(`${from_email} is unknown.`);
    this.statusCode = 401;
    this.detail = 'unknown from email';
  }
}

export class ChannelUserMismatchException extends CustomException {
  constructor(channel_id, user_id) {
    super(`this user:${user_id} does not own the channel:${channel_id}.`);
    this.statusCode = 401;
    this.detail = 'this user does not own the channel';
  }
}

export class InvalidOauthException extends CustomException {
  constructor() {
    super('invalid Oauth Information');
    this.statusCode = 401;
    this.detail = 'invalid Oauth Information';
  }
}

export class AlreadySubscribedException extends CustomException {
  constructor() {
    super('You are already subscribed to that newsletter');
    this.statusCode = 409;
    this.detail = 'You are already subscribed to that newsletter';
  }
}

export class NotSubscribedNewsletterException extends CustomException {
  constructor() {
    super('You cannot unsubscribe from newsletters you are not subscribed to.');
    this.statusCode = 409;
    this.detail = 'You cannot unsubscribe from newsletters you are not subscribed to.';
  }
}

