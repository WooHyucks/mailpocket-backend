import { SupabaseCRUDTemplate } from '../common/database/connector.js';
import { UserModel, SubscribeModel } from '../common/database/model.js';
import { AlreadySubscribedException, NotSubscribedNewsletterException } from '../common/exceptions.js';
import { User } from './domain.js';

export class UserRepository {
  static Create = class extends SupabaseCRUDTemplate {
    constructor({ identifier = null, password = null, platform = null, platform_id = null, is_member = null }) {
      super();
      this.identifier = identifier;
      this.password = password;
      this.platform = platform;
      this.platform_id = platform_id;
      this.is_member = is_member;
    }

    async execute() {
      const { data, error } = await this.client
        .from(UserModel.tableName)
        .insert({
          identifier: this.identifier,
          password: this.password,
          platform: this.platform,
          platform_id: this.platform_id,
          is_member: this.is_member
        })
        .select()
        .single();
      
      if (error) throw error;
      
      return new User({
        id: data.id,
        identifier: data.identifier,
        password: data.password,
        platform: data.platform,
        platform_id: data.platform_id,
        is_member: data.is_member
      });
    }
  };

  static Update = class extends SupabaseCRUDTemplate {
    constructor({ id, identifier = null, password = null, platform = null, platform_id = null }) {
      super();
      this.id = id;
      this.identifier = identifier;
      this.password = password;
      this.platform = platform;
      this.platform_id = platform_id;
      this.is_member = true;
    }

    async execute() {
      const updateData = {};
      if (this.identifier !== null) updateData.identifier = this.identifier;
      if (this.password !== null) updateData.password = this.password;
      if (this.platform !== null) updateData.platform = this.platform;
      if (this.platform_id !== null) updateData.platform_id = this.platform_id;
      updateData.is_member = this.is_member;

      const { data, error } = await this.client
        .from(UserModel.tableName)
        .update(updateData)
        .eq('id', this.id)
        .select()
        .single();
      
      if (error) throw error;
      
      return new User({
        id: data.id,
        identifier: data.identifier,
        password: data.password,
        platform: data.platform,
        platform_id: data.platform_id,
        is_member: data.is_member
      });
    }
  };

  static ReadByIdentifier = class extends SupabaseCRUDTemplate {
    constructor(identifier) {
      super();
      this.identifier = identifier;
    }

    async execute() {
      const { data, error } = await this.client
        .from(UserModel.tableName)
        .select('*')
        .eq('identifier', this.identifier)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return new User({
        id: data.id,
        identifier: data.identifier,
        password: data.password
      });
    }
  };

  static ReadUserByPlatformID = class extends SupabaseCRUDTemplate {
    constructor(platform_id, platform) {
      super();
      this.platform_id = platform_id;
      this.platform = platform;
    }

    async execute() {
      const { data, error } = await this.client
        .from(UserModel.tableName)
        .select('*')
        .eq('platform', this.platform)
        .eq('platform_id', this.platform_id)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return new User({
        id: data.id,
        platform_id: data.platform_id,
        platform: data.platform,
        is_member: data.is_member
      });
    }
  };

  static ReadByID = class extends SupabaseCRUDTemplate {
    constructor(id) {
      super();
      this.id = id;
    }

    async execute() {
      const { data, error } = await this.client
        .from(UserModel.tableName)
        .select('*')
        .eq('id', this.id)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return new User({
        id: data.id,
        identifier: data.identifier,
        password: data.password,
        platform_id: data.platform_id,
        platform: data.platform,
        is_member: data.is_member
      });
    }
  };

  static CreateUserNewsletterMapping = class extends SupabaseCRUDTemplate {
    constructor(user, newsletter_id) {
      super();
      this.user = user;
      this.newsletter_id = newsletter_id;
    }

    async execute() {
      const { data: existing, error: checkError } = await this.client
        .from(SubscribeModel.tableName)
        .select('*')
        .eq('user_id', this.user.id)
        .eq('newsletter_id', this.newsletter_id);
      
      if (checkError) throw checkError;
      if (existing && existing.length > 0) {
        throw new AlreadySubscribedException();
      }
      
      const { error } = await this.client
        .from(SubscribeModel.tableName)
        .insert({
          newsletter_id: this.newsletter_id,
          user_id: this.user.id
        });
      
      if (error) throw error;
    }
  };

  static DeleteUserNewsletterMapping = class extends SupabaseCRUDTemplate {
    constructor(user, newsletter_id) {
      super();
      this.user = user;
      this.newsletter_id = newsletter_id;
    }

    async execute() {
      const { data: existing, error: checkError } = await this.client
        .from(SubscribeModel.tableName)
        .select('*')
        .eq('user_id', this.user.id)
        .eq('newsletter_id', this.newsletter_id);
      
      if (checkError) throw checkError;
      if (!existing || existing.length === 0) {
        throw new NotSubscribedNewsletterException();
      }
      
      const { error } = await this.client
        .from(SubscribeModel.tableName)
        .delete()
        .eq('user_id', this.user.id)
        .eq('newsletter_id', this.newsletter_id);
      
      if (error) throw error;
    }
  };

  static CreateUserNewslettersMapping = class extends SupabaseCRUDTemplate {
    constructor(user, newsletter_ids) {
      super();
      this.user = user;
      this.newsletter_ids = newsletter_ids;
    }

    async execute() {
      const insertData = this.newsletter_ids.map(newsletter_id => ({
        newsletter_id,
        user_id: this.user.id
      }));
      
      const { error } = await this.client
        .from(SubscribeModel.tableName)
        .insert(insertData);
      
      if (error) throw error;
    }
  };

  static DeleteUserNewslettersMapping = class extends SupabaseCRUDTemplate {
    constructor(user) {
      super();
      this.user = user;
    }

    async execute() {
      const { error } = await this.client
        .from(SubscribeModel.tableName)
        .delete()
        .eq('user_id', this.user.id);
      
      if (error) throw error;
    }
  };
}


