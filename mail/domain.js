import { mailSummary } from '../common/gpt_prompt.js';
import { simpleParser } from 'mailparser';

export class Mail {
  constructor({ id, mail_content = null, s3_object_key = null, subject = null, summary_list = null, newsletter_id = null, recv_at = null }) {
    this.id = id;
    this.mail_content = mail_content;
    this.s3_object_key = s3_object_key;
    this.subject = subject;
    this.read_link = `https://mailpocket.shop/read?mail=${this.s3_object_key}`;
    this.summary_list = summary_list;
    if (this.summary_list) {
      this.share_text = this._makeShareText();
    }
    this.newsletter_id = newsletter_id;
    this.recv_at = recv_at;
  }

  _makeShareText() {
    let text = '';
    text += this.subject + '\n\n';
    for (const [k, v] of Object.entries(this.summary_list)) {
      text += '#' + k + '\n';
      text += v + '\n\n';
    }
    text = text.replace(/\n\n$/, '');
    return text;
  }

  async parserEmail() {
    if (this.mail_content) {
      try {
        const parsed = await simpleParser(this.mail_content);
        
        // Format date
        if (parsed.date) {
          const date = new Date(parsed.date);
          this.date = date.toISOString().slice(0, 19).replace('T', ' ');
        } else {
          this.date = null;
        }

        // Parse from email
        const fromEmail = parsed.from?.text || '';
        const fromMatch = fromEmail.match(/^(.+?)\s*<(.+?)>$/);
        if (fromMatch) {
          this.from_name = fromMatch[1].replace(/"/g, '');
          this.from_email = fromMatch[2];
        } else {
          this.from_name = fromEmail;
          this.from_email = fromEmail;
        }

        this.subject = parsed.subject || '';
        this.html_body = parsed.html || parsed.textAsHtml || '';

        delete this.mail_content;
      } catch (error) {
        console.error('Error parsing email:', error);
        this.date = null;
        this.from_name = null;
        this.from_email = null;
        this.subject = null;
        this.html_body = null;
      }
    } else {
      this.date = null;
      this.from_name = null;
      this.from_email = null;
      this.subject = null;
      this.html_body = null;
    }
  }

  async summary() {
    this.summary_list = await mailSummary(this.from_email, this.subject, this.html_body);
  }

  setNewsletterId(newsletter_id) {
    this.newsletter_id = newsletter_id;
  }
}


