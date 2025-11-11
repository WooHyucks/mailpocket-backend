import { SupabaseCRUDTemplate } from '../common/database/connector.js';
import { ChannelModel, SubscribeModel } from '../common/database/model.js';
import { Channel } from './domain.js';

export class ChannelRepository {
  static ReadChannelsByUserID = class extends SupabaseCRUDTemplate {
    constructor(user_id) {
      super();
      this.user_id = user_id;
    }

    async execute() {
      const { data: rows, error } = await this.client
        .from(ChannelModel.tableName)
        .select('*')
        .eq('user_id', this.user_id);
      
      if (error) throw error;
      if (!rows || rows.length === 0) {
        return [];
      }
      
      return rows.map(channelModel => new Channel({
        id: channelModel.id,
        webhook_url: channelModel.webhook_url,
        slack_channel_id: channelModel.slack_channel_id,
        name: channelModel.name,
        team_name: channelModel.team_name,
        team_icon: channelModel.team_icon,
        user_id: channelModel.user_id
      }));
    }
  };

  static ReadChannelByID = class extends SupabaseCRUDTemplate {
    constructor(id) {
      super();
      this.id = id;
    }

    async execute() {
      const { data: rows, error } = await this.client
        .from(ChannelModel.tableName)
        .select('*')
        .eq('id', this.id)
        .single();
      
      if (error || !rows) {
        return null;
      }
      
      return new Channel({
        id: rows.id,
        webhook_url: rows.webhook_url,
        slack_channel_id: rows.slack_channel_id,
        name: rows.name,
        team_name: rows.team_name,
        team_icon: rows.team_icon,
        user_id: rows.user_id
      });
    }
  };

  static Create = class extends SupabaseCRUDTemplate {
    constructor(channel) {
      super();
      this.channel = channel;
    }

    async execute() {
      const { data, error } = await this.client
        .from(ChannelModel.tableName)
        .insert({
          webhook_url: this.channel.webhook_url,
          slack_channel_id: this.channel.slack_channel_id,
          name: this.channel.name,
          team_name: this.channel.team_name,
          team_icon: this.channel.team_icon,
          user_id: this.channel.user_id
        })
        .select()
        .single();
      
      if (error) throw error;
      this.channel.id = data.id;
    }
  };

  static ReadChannelsByNewsletter = class extends SupabaseCRUDTemplate {
    constructor(newsletter) {
      super();
      this.newsletter = newsletter;
    }

    async execute() {
      const { data: subscribeRows, error: subscribeError } = await this.client
        .from(SubscribeModel.tableName)
        .select('user_id')
        .eq('newsletter_id', this.newsletter.id);
      
      if (subscribeError) throw subscribeError;
      if (!subscribeRows || subscribeRows.length === 0) {
        return null;
      }
      
      const userIds = subscribeRows.map(row => row.user_id);
      const channels = [];
      
      const { data: channelRows, error: channelError } = await this.client
        .from(ChannelModel.tableName)
        .select('*')
        .in('user_id', userIds);
      
      if (channelError) throw channelError;
      
      if (channelRows) {
        for (const channelModel of channelRows) {
          channels.push(new Channel({
            id: channelModel.id,
            webhook_url: channelModel.webhook_url,
            slack_channel_id: channelModel.slack_channel_id,
            name: channelModel.name,
            team_name: channelModel.team_name,
            team_icon: channelModel.team_icon,
            user_id: channelModel.user_id
          }));
        }
      }
      
      return channels;
    }
  };

  static Delete = class extends SupabaseCRUDTemplate {
    constructor(channel) {
      super();
      this.channel = channel;
    }

    async execute() {
      const { error } = await this.client
        .from(ChannelModel.tableName)
        .delete()
        .eq('id', this.channel.id);
      
      if (error) throw error;
    }
  };
}


