import { MailRepository } from '../mail/repository.js';
import { NewsLetterRepository } from './repository.js';
import { UserRepository } from '../user/repository.js';

export class NewsLetterDTO {
  constructor(newsletter) {
    this.id = newsletter.id;
    this.name = newsletter.name;
    this.category_id = newsletter.category_id;
    this.mail = newsletter.mail;
    this.mails = newsletter.mails;
  }
}

export class NewsLetterService {
  constructor() {
    this.newsletterRepository = NewsLetterRepository;
    this.userRepository = UserRepository;
    this.mailRepository = new MailRepository();
  }

  async newsletterSubscribe(user_id, newsletter_id) {
    const user = await new this.userRepository.ReadByID(user_id).run();
    await new this.userRepository.CreateUserNewsletterMapping(user, newsletter_id).run();
  }

  async newsletterSubscribeCancel(user_id, newsletter_id) {
    const user = await new this.userRepository.ReadByID(user_id).run();
    await new this.userRepository.DeleteUserNewsletterMapping(user, newsletter_id).run();
  }

  async newslettersSubscribe(user_id, newsletter_ids) {
    const user = await new this.userRepository.ReadByID(user_id).run();
    await new this.userRepository.DeleteUserNewslettersMapping(user).run();
    await new this.userRepository.CreateUserNewslettersMapping(user, newsletter_ids).run();
  }

  async getNewsletters(user_id, subscribe_status, sort_type, in_mail, cursor, category_id) {
    const newsletterList = [];
    const user = await new this.userRepository.ReadByID(user_id).run();
    const newsletters = await new this.newsletterRepository.ReadFilteredNewsletters(
      user,
      subscribe_status,
      sort_type,
      in_mail,
      cursor,
      category_id
    ).run();
    if (newsletters) {
      for (const newsletter of newsletters) {
        newsletterList.push(new NewsLetterDTO(newsletter));
      }
    }
    return newsletterList;
  }

  async getNewsletterWithPreviousMailListByNewsletterId(newsletter_id) {
    const newsletter = await new this.newsletterRepository.LoadNewsLetterByIDWithMails(newsletter_id).run();
    return new NewsLetterDTO(newsletter);
  }

  async getCategoryList() {
    const categoryList = await new this.newsletterRepository.ReadCategoriesOfNewsletter().run();
    const newsletterList = await new this.newsletterRepository.ReadAllNewsletters().run();
    for (const category of categoryList) {
      category.checkNewsletterValid(newsletterList);
    }
    return categoryList;
  }
}


