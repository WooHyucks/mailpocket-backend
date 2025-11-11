import bcrypt from 'bcrypt';
import {
  IdentifierAlreadyException,
  IdentifierNotFoundException,
  PasswordNotMatchException
} from '../common/exceptions.js';
import { UserRepository } from './repository.js';

export class UserService {
  constructor() {
    this.userRepository = UserRepository;
  }

  async signUp(identifier, password) {
    const existingUser = await new this.userRepository.ReadByIdentifier(identifier).run();
    if (existingUser) {
      throw new IdentifierAlreadyException(identifier);
    }

    const encryptedPassword = await bcrypt.hash(password, 10);

    const user = await new this.userRepository.Create({
      identifier,
      password: encryptedPassword,
      is_member: true
    }).run();
    return user;
  }

  async signIn(identifier, password) {
    const user = await new this.userRepository.ReadByIdentifier(identifier).run();
    if (!user) {
      throw new IdentifierNotFoundException(identifier);
    }
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      throw new PasswordNotMatchException(identifier, password);
    }
    return user;
  }

  async read(user_id) {
    const user = await new this.userRepository.ReadByID(user_id).run();
    if (user) {
      delete user.password;
    }
    return user;
  }

  async createNonMemberUser() {
    const user = await new this.userRepository.Create({ is_member: false }).run();
    return user;
  }

  async oauthLogin(platform_id, platform) {
    const existingUser = await new this.userRepository.ReadUserByPlatformID(platform_id, platform).run();
    if (existingUser) {
      return existingUser;
    }

    const user = await new this.userRepository.Create({
      platform_id,
      platform,
      is_member: true
    }).run();
    return user;
  }

  async upgradeNonMemberUserToMember(user_id, identifier = null, password = null, platform_id = null, platform = null) {
    if (identifier && password) {
      const existingUser = await new this.userRepository.ReadByIdentifier(identifier).run();
      if (existingUser) {
        throw new IdentifierAlreadyException(identifier);
      }

      const encryptedPassword = await bcrypt.hash(password, 10);

      const user = await new this.userRepository.Update({
        id: user_id,
        identifier,
        password: encryptedPassword
      }).run();
      return user;
    } else if (platform_id && platform) {
      const existingUser = await new this.userRepository.ReadUserByPlatformID(platform_id, platform).run();
      if (existingUser) {
        return existingUser;
      }

      const user = await new this.userRepository.Update({
        id: user_id,
        platform_id,
        platform
      }).run();
      return user;
    }
  }
}


