import { ChannelRepository } from './repository.js';
import { SlackAPI } from '../common/slack_api.js';
import { MailRepository } from '../mail/repository.js';
import { NewsLetterRepository } from '../newsletter/repository.js';
import { UserRepository } from '../user/repository.js';

export class ChannelDTO {
  constructor(channel) {
    this.id = channel.id;
    this.team_name = channel.team_name;
    this.team_icon = channel.team_icon;
    this.name = channel.name;
  }
}

export class ChannelService {
  constructor() {
    this.mailRepository = new MailRepository();
    this.userRepository = UserRepository;
    this.channelRepository = ChannelRepository;
    this.newsletterRepository = NewsLetterRepository;
    this.slackApi = new SlackAPI();
  }

  async addChannel(code, user_id) {
    const user = await new this.userRepository.ReadByID(user_id).run();
    const channel = await this.slackApi.connectWorkspace(code, user_id);
    await new this.channelRepository.Create(channel).run();
    
    if (channel.id) {
      await this.slackApi.sendingWelcomeMessage(channel);
      const subscribedNewsletterList = await new this.newsletterRepository.ReadFilteredNewsletters(
        user,
        'subscribed',
        'recent',
        true,
        null,
        null,
        3
      ).run();
      
      for (const subscribedNewsletter of subscribedNewsletterList) {
        await this.mailRepository.loadMailDataByS3ObjectKey(subscribedNewsletter.mail);
        await this.slackApi.sendingMailRecvNotification(
          channel,
          subscribedNewsletter.mail,
          subscribedNewsletter
        );
      }
      return channel.id;
    }
  }

  async getChannels(user_id) {
    const channelList = [];
    const channels = await new this.channelRepository.ReadChannelsByUserID(user_id).run();
    for (const channel of channels) {
      channelList.push(new ChannelDTO(channel));
    }
    return channelList;
  }

  async getChannel(user_id, channel_id) {
    const channel = await new this.channelRepository.ReadChannelByID(channel_id).run();
    return new ChannelDTO(channel);
  }

  async removeChannel(user_id, channel_id) {
    const channel = await new this.channelRepository.ReadChannelByID(channel_id).run();
    channel.isUserOfChannel(user_id);
    await new this.channelRepository.Delete(channel).run();
  }
}


