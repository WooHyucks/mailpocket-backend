import { ChannelUserMismatchException } from '../common/exceptions.js';

export class Channel {
  constructor({ id = null, webhook_url = null, slack_channel_id = null, team_name = null, team_icon = null, name = null, user_id = null }) {
    this.id = id;
    this.webhook_url = webhook_url;
    this.slack_channel_id = slack_channel_id;
    this.team_name = team_name;
    this.team_icon = team_icon;
    this.name = name;
    this.user_id = user_id;
  }

  isUserOfChannel(user_id) {
    if (this.user_id !== user_id) {
      throw new ChannelUserMismatchException(this.id, user_id);
    }
  }
}


