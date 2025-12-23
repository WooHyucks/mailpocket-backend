import { Mail } from '../mail/domain.js';

export class NewsLetter {
  constructor({ id, name, category_id, send_date, mail = null, mails = null, operating_status = null, language = null }) {
    this.id = id;
    this.name = name;
    this.category_id = category_id;
    this.send_date = send_date;
    this.mail = mail;
    this.mails = mails;
    this.operating_status = operating_status;
    this.language = language;
  }
}

export class Category {
  constructor(id, name, operating_status = false) {
    this.id = id;
    this.name = name;
    this.operating_status = operating_status;
  }

  checkNewsletterValid(newsletterList) {
    // 전체카테고리 정상처리를 위한 하드코딩
    if (!this.id) {
      this.operating_status = true;
      return true;
    }
    for (const newsletter of newsletterList) {
      if (newsletter.category_id === this.id) {
        if (newsletter.operating_status) {
          this.operating_status = true;
          return true;
        }
      }
    }
    return false;
  }
}


