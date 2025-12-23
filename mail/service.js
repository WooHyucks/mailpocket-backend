import { ChannelRepository } from '../channel/repository.js';
import { UnknownFromEamilException } from '../common/exceptions.js';
import { SlackAPI } from '../common/slack_api.js';
import { MailRepository } from './repository.js';
import { NewsLetterRepository } from '../newsletter/repository.js';
import { UserRepository } from '../user/repository.js';
import { mailTranslateToKorean } from '../common/gpt_prompt.js';

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
    
    // Resolve newsletter using 4-step matching strategy
    // 0. From header name matching (highest priority)
    // 1. HTML body name matching
    // 2. Email address exact matching
    // 3. Domain matching (last resort, blacklist excluded, single match only)
    const matchResult = await new this.newsletterRepository.ResolveNewsletter(mail.from_name, mail.from_email, mail.html_body).run();
    if (!matchResult || !matchResult.newsletter) {
      await this.slackApi.logingUnknownEmailAddress(mail);
      throw new UnknownFromEamilException('Unable to resolve newsletter (name/email/domain match failed)');
    }
    
    // Get full newsletter data including language
    const newsletter = await new this.newsletterRepository.LoadNewsLetterByID(matchResult.newsletter.id).run();
    if (!newsletter) {
      await this.slackApi.logingUnknownEmailAddress(mail);
      throw new UnknownFromEamilException('Failed to load newsletter data');
    }
    
    mail.setNewsletterId(newsletter.id);

    await mail.summary(newsletter.language || 'ko');

    if (newsletter.language === 'en') {
      mail.translated_body = await mailTranslateToKorean(mail.html_body);
    } else {
      mail.translated_body = null;
    }

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

