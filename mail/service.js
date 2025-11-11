import { ChannelRepository } from '../channel/repository.js';
import { UnknownFromEamilException } from '../common/exceptions.js';
import { SlackAPI } from '../common/slack_api.js';
import { MailRepository } from './repository.js';
import { NewsLetterRepository } from '../newsletter/repository.js';
import { UserRepository } from '../user/repository.js';

export class MailService {
  constructor() {
    this.mailRepository = new MailRepository();
    this.userRepository = UserRepository;
    this.channelRepository = ChannelRepository;
    this.newsletterRepository = NewsLetterRepository;
    this.slackApi = new SlackAPI();
  }

  async recv(s3_object_key) {
    const mail = await this.mailRepository.readMailDataByS3ObjectKey(s3_object_key);
    await mail.parserEmail();
    await this.slackApi.loging(mail);
    
    const newsletter = await new this.newsletterRepository.LoadNewsLetterByFromEmail(mail.from_email).run();
    if (!newsletter) {
      await this.slackApi.logingUnknownEmailAddress(mail);
      throw new UnknownFromEamilException(mail.from_email);
    }
    mail.setNewsletterId(newsletter.id);

    await mail.summary();
    await new MailRepository.CreateMail(mail).run();
    await new this.newsletterRepository.UpdateNewsletterLastRecvDateTime(newsletter).run();

    const channels = await new this.channelRepository.ReadChannelsByNewsletter(newsletter).run();
    const notifiedSlackChannelIdList = [];
    if (channels) {
      for (const channel of channels) {
        if (notifiedSlackChannelIdList.includes(channel.slack_channel_id)) {
          continue;
        }
        await this.slackApi.sendingMailRecvNotification(channel, mail, newsletter);
        notifiedSlackChannelIdList.push(channel.slack_channel_id);
      }
    }
  }

  async read(s3_object_key) {
    const mail = await this.mailRepository.readMailDataByS3ObjectKey(s3_object_key);
    await new MailRepository.LoadMail(mail).run();
    await mail.parserEmail();
    return mail;
  }

  async getLastMailOfNewsletterByNewsletterId(newsletter_id) {
    const mail = await new MailRepository.ReadLastMailOfNewsletterByNewsletterID(newsletter_id).run();
    await this.mailRepository.loadMailDataByS3ObjectKey(mail);
    await mail.parserEmail();
    return mail;
  }

  async summaryAgain(s3_object_key) {
    const mail = await new MailRepository.ReadMailByS3ObjectKey(s3_object_key).run();
    await this.mailRepository.loadMailDataByS3ObjectKey(mail);
    await mail.parserEmail();
    await mail.summary();
    await new MailRepository.UpdateMailSummaryList(mail).run();
  }

  async getMailList() {
    const mailList = await this.mailRepository.readMailList();
    return mailList;
  }

  async getMailDetail(mail_id) {
    const mail = await this.mailRepository.readMailDataByS3ObjectKey(mail_id);
    await mail.parserEmail();
    return mail.html_body;
  }
}

