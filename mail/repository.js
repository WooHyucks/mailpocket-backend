import { GetObjectCommand } from '@aws-sdk/client-s3';
import { S3Connector } from '../common/s3.js';
import { SupabaseCRUDTemplate } from '../common/database/connector.js';
import { MailModel } from '../common/database/model.js';
import { Mail } from './domain.js';

export class MailRepository extends S3Connector {
  async readMailDataByS3ObjectKey(s3_object_key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3_object_key
      });
      const response = await this.s3Client.send(command);
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      const mail_content = Buffer.concat(chunks);
      return new Mail({ id: null, mail_content, s3_object_key });
    } catch (error) {
      console.error('Error reading from S3:', error);
      return new Mail({ id: null, mail_content: null, s3_object_key });
    }
  }

  async loadMailDataByS3ObjectKey(mail) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: mail.s3_object_key
      });
      const response = await this.s3Client.send(command);
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      mail.mail_content = Buffer.concat(chunks);
    } catch (error) {
      console.error('Error loading from S3:', error);
      mail.mail_content = null;
    }
  }

  async readMailList() {
    const mailList = [];
    try {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName
      });
      const response = await this.s3Client.send(command);
      if (response.Contents) {
        for (const obj of response.Contents) {
          mailList.push(obj.Key);
        }
      }
    } catch (error) {
      console.error(`Error fetching mail list: ${error}`);
    }
    return mailList;
  }

  static ReadMailListFromNewsletter = class extends SupabaseCRUDTemplate {
    constructor(newsletter) {
      super();
      this.newsletter = newsletter;
    }

    async execute() {
      const { data: rows, error } = await this.client
        .from(MailModel.tableName)
        .select('*')
        .eq('newsletter_id', this.newsletter.id);
      
      if (error) throw error;
      if (!rows || rows.length === 0) {
        return null;
      }
      
      return rows.map(mailModel => new Mail({
        id: mailModel.id,
        s3_object_key: mailModel.s3_object_key,
        subject: mailModel.subject,
        summary_list: typeof mailModel.summary_list === 'string' ? JSON.parse(mailModel.summary_list) : mailModel.summary_list
      }));
    }
  };

  static CreateMail = class extends SupabaseCRUDTemplate {
    constructor(mail) {
      super();
      this.mail = mail;
    }

    async execute() {
      const { data, error } = await this.client
        .from(MailModel.tableName)
        .insert({
          s3_object_key: this.mail.s3_object_key,
          subject: this.mail.subject,
          summary_list: this.mail.summary_list ? JSON.stringify(this.mail.summary_list) : null,
          newsletter_id: this.mail.newsletter_id,
          recv_at: this.mail.date
        })
        .select()
        .single();
      
      if (error) throw error;
      this.mail.id = data.id;
    }
  };

  static ReadMailByS3ObjectKey = class extends SupabaseCRUDTemplate {
    constructor(s3_object_key) {
      super();
      this.s3_object_key = s3_object_key;
    }

    async execute() {
      const { data, error } = await this.client
        .from(MailModel.tableName)
        .select('*')
        .eq('s3_object_key', this.s3_object_key)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return new Mail({
        id: data.id,
        s3_object_key: data.s3_object_key,
        subject: data.subject,
        summary_list: typeof data.summary_list === 'string' ? JSON.parse(data.summary_list) : data.summary_list,
        newsletter_id: data.newsletter_id
      });
    }
  };

  static LoadMail = class extends SupabaseCRUDTemplate {
    constructor(mail) {
      super();
      this.mail = mail;
    }

    async execute() {
      const { data, error } = await this.client
        .from(MailModel.tableName)
        .select('*')
        .eq('s3_object_key', this.mail.s3_object_key)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      this.mail.id = data.id;
      this.mail.subject = data.subject;
      this.mail.summary_list = typeof data.summary_list === 'string' ? JSON.parse(data.summary_list) : data.summary_list;
      this.mail.share_text = this.mail._makeShareText();
      this.mail.newsletter_id = data.newsletter_id;
      return true;
    }
  };

  static UpdateMailSummaryList = class extends SupabaseCRUDTemplate {
    constructor(mail) {
      super();
      this.mail = mail;
    }

    async execute() {
      const { data: existing, error: checkError } = await this.client
        .from(MailModel.tableName)
        .select('id')
        .eq('id', this.mail.id)
        .single();
      
      if (checkError || !existing) {
        return null;
      }
      
      const { error } = await this.client
        .from(MailModel.tableName)
        .update({ summary_list: JSON.stringify(this.mail.summary_list) })
        .eq('id', this.mail.id);
      
      if (error) throw error;
    }
  };

  static DeleteMail = class extends SupabaseCRUDTemplate {
    constructor(mail) {
      super();
      this.mail = mail;
    }

    async execute() {
      const { data: existing, error: checkError } = await this.client
        .from(MailModel.tableName)
        .select('id')
        .eq('s3_object_key', this.mail.s3_object_key)
        .single();
      
      if (checkError || !existing) {
        return false;
      }
      
      const { error } = await this.client
        .from(MailModel.tableName)
        .delete()
        .eq('s3_object_key', this.mail.s3_object_key);
      
      if (error) throw error;
      return true;
    }
  };

  static ReadLastMailOfNewsletterByNewsletterID = class extends SupabaseCRUDTemplate {
    constructor(newsletter_id) {
      super();
      this.newsletter_id = newsletter_id;
    }

    async execute() {
      const { data, error } = await this.client
        .from(MailModel.tableName)
        .select('*')
        .eq('newsletter_id', this.newsletter_id)
        .order('recv_at', { ascending: false })
        .limit(1)
        .single();
      
      if (error || !data) {
        return false;
      }
      
      return new Mail({
        id: data.id,
        s3_object_key: data.s3_object_key,
        subject: data.subject,
        summary_list: typeof data.summary_list === 'string' ? JSON.parse(data.summary_list) : data.summary_list,
        newsletter_id: data.newsletter_id
      });
    }
  };
}

