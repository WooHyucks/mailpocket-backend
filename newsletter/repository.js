import { SupabaseCRUDTemplate } from '../common/database/connector.js';
import {
  CategoryModel,
  MailModel,
  NewsletterEmailAddressesModel,
  NewsLetterModel,
  SubscribeModel,
  SubscribeRankingModel
} from '../common/database/model.js';
import { NewsLetter, Category } from './domain.js';
import { Mail } from '../mail/domain.js';

export class NewsLetterRepository {
  static LoadNewsLetterByFromEmail = class extends SupabaseCRUDTemplate {
    constructor(from_email) {
      super();
      this.from_email = from_email;
    }

    async execute() {
      // First find newsletter_id from email addresses
      const { data: emailRows, error: emailError } = await this.client
        .from(NewsletterEmailAddressesModel.tableName)
        .select('newsletter_id')
        .eq('email_address', this.from_email)
        .limit(1);
      
      if (emailError) throw emailError;
      if (!emailRows || emailRows.length === 0) {
        return false;
      }
      
      const newsletterId = emailRows[0].newsletter_id;
      
      // Then get newsletter details
      const { data, error } = await this.client
        .from(NewsLetterModel.tableName)
        .select('*')
        .eq('id', newsletterId)
        .single();
      
      if (error || !data) {
        return false;
      }
      
      return new NewsLetter({
        id: data.id,
        name: data.name,
        category_id: data.category_id,
        send_date: data.send_date
      });
    }
  };

  static LoadNewsLetterByIDWithMails = class extends SupabaseCRUDTemplate {
    constructor(id) {
      super();
      this.id = id;
    }

    async execute() {
      const { data: newsletterData, error: newsletterError } = await this.client
        .from(NewsLetterModel.tableName)
        .select('*')
        .eq('id', this.id)
        .single();
      
      if (newsletterError || !newsletterData) {
        return null;
      }
      
      const { data: mailRows, error: mailError } = await this.client
        .from(MailModel.tableName)
        .select('*')
        .eq('newsletter_id', newsletterData.id)
        .order('recv_at', { ascending: false });
      
      if (mailError) throw mailError;
      
      const mailList = (mailRows || []).map(mailModel => new Mail({
          id: mailModel.id,
          s3_object_key: mailModel.s3_object_key,
          subject: mailModel.subject,
          recv_at: mailModel.recv_at
        }));
      
      return new NewsLetter({
        id: newsletterData.id,
        name: newsletterData.name,
        category_id: newsletterData.category_id,
        send_date: newsletterData.send_date,
        mails: mailList
      });
    }
  };

  static ReadAllNewsletters = class extends SupabaseCRUDTemplate {
    async execute() {
      const { data: rows, error } = await this.client
        .from(NewsLetterModel.tableName)
        .select('*');
      
      if (error) throw error;
      
      return (rows || []).map(newsletterModel => new NewsLetter({
          id: newsletterModel.id,
          name: newsletterModel.name,
          category_id: newsletterModel.category_id,
          send_date: newsletterModel.send_date,
          operating_status: newsletterModel.operating_status
        }));
    }
  };

  static ReadFilteredNewsletters = class extends SupabaseCRUDTemplate {
    constructor(user, subscribe_status, sort_type, in_mail, cursor, category_id, size = null) {
      super();
      this.user = user;
      this.subscribe_status = subscribe_status;
      this.sort_type = sort_type;
      this.in_mail = in_mail;
      this.cursor = cursor;
      this.category_id = category_id;
      this.size = size;
    }

    async execute() {
      // Get subscribed newsletter IDs
      const { data: subscribeRows, error: subscribeError } = await this.client
        .from(SubscribeModel.tableName)
        .select('newsletter_id')
        .eq('user_id', this.user.id);
      
      if (subscribeError) throw subscribeError;
      const subscribedNewsletterIds = (subscribeRows || []).map(row => row.newsletter_id);

      // Build query based on sort_type
      if (this.sort_type === 'ranking') {
        if (!(await this.__checkIfSubscribeRankingIsToday())) {
          await this.__updateSubscribeRanking();
        }
      }

      // Build Supabase query
      let query = this.client.from(NewsLetterModel.tableName).select('*');

      // Filter by category
      if (this.category_id) {
        query = query.eq('category_id', this.category_id);
      }

      // Filter by subscribe status
      if (this.subscribe_status === 'subscribed') {
        if (subscribedNewsletterIds.length === 0) {
          return [];
        }
        query = query.in('id', subscribedNewsletterIds);
      } else if (this.subscribe_status === 'subscribable') {
        if (subscribedNewsletterIds.length > 0) {
          // Use .not() with .in() for NOT IN operation
          query = query.not('id', 'in', `(${subscribedNewsletterIds.join(',')})`);
        }
      }

      // Handle cursor for ranking sort
      if (this.sort_type === 'ranking' && this.in_mail && this.cursor) {
        const { data: cursorRow, error: cursorError } = await this.client
          .from(SubscribeRankingModel.tableName)
          .select('id')
          .eq('newsletter_id', this.cursor)
          .single();
        
        if (!cursorError && cursorRow) {
          // Note: Supabase doesn't support complex JOIN filtering easily
          // This would need to be handled differently or use RPC
        }
      }

      // Add ORDER BY
      if (this.sort_type === 'recent') {
        query = query.order('last_recv_at', { ascending: false });
      } else if (this.sort_type === 'ranking') {
        // For ranking, we need to join with SubscribeRankingModel
        // This is complex in Supabase, so we'll fetch ranking separately
        const { data: rankingRows, error: rankingError } = await this.client
          .from(SubscribeRankingModel.tableName)
          .select('newsletter_id, id')
          .order('id', { ascending: true });
        
        if (rankingError) throw rankingError;
        
        const rankingIds = (rankingRows || []).map(r => r.newsletter_id);
        if (rankingIds.length > 0) {
          query = query.in('id', rankingIds);
        }
      }

      // Handle limits
      let limit = null;
      if (this.in_mail && this.subscribe_status === 'subscribable') {
        limit = 8;
      } else if (this.size) {
        limit = this.size;
      }
      
      if (limit) {
        query = query.limit(limit);
      }

      const { data: newsletterRows, error: newsletterError } = await query;
      if (newsletterError) throw newsletterError;

      const newsletterList = [];
      for (const newsletterModel of (newsletterRows || [])) {
        let mail = null;
        if (this.in_mail) {
          const { data: mailRows, error: mailError } = await this.client
            .from(MailModel.tableName)
            .select('*')
            .eq('newsletter_id', newsletterModel.id)
            .order('id', { ascending: false })
            .limit(1);
          
          if (!mailError && mailRows && mailRows.length > 0) {
            const mailModel = mailRows[0];
            mail = new Mail({
              id: mailModel.id,
              s3_object_key: mailModel.s3_object_key,
              subject: mailModel.subject,
              summary_list: typeof mailModel.summary_list === 'string' ? JSON.parse(mailModel.summary_list) : mailModel.summary_list,
              newsletter_id: mailModel.newsletter_id
            });
          }
        }
        newsletterList.push(new NewsLetter({
          id: newsletterModel.id,
          name: newsletterModel.name,
          category_id: newsletterModel.category_id,
          send_date: newsletterModel.send_date,
          mail: mail
        }));
      }

      return newsletterList;
    }

    async __checkIfSubscribeRankingIsToday() {
      const { data: rows, error } = await this.client
        .from(SubscribeRankingModel.tableName)
        .select('snapshot_at')
        .limit(1);
      
      if (error || !rows || rows.length === 0) {
        return false;
      }
      const today = new Date().toISOString().split('T')[0];
      const snapshotAt = new Date(rows[0].snapshot_at).toISOString().split('T')[0];
      return snapshotAt === today;
    }

    async __updateSubscribeRanking() {
      // Delete all existing rankings
      await this.client.from(SubscribeRankingModel.tableName).delete().neq('id', 0);
      
      // Get newsletters with subscribe counts
      const { data: newsletterRows, error: newsletterError } = await this.client
        .from(NewsLetterModel.tableName)
        .select('id')
        .eq('operating_status', 1);
      
      if (newsletterError) throw newsletterError;
      
      const rankingModels = [];
      for (const newsletter of (newsletterRows || [])) {
        const { data: subscribeRows, error: subscribeError } = await this.client
          .from(SubscribeModel.tableName)
          .select('id', { count: 'exact' })
          .eq('newsletter_id', newsletter.id);
        
        if (!subscribeError) {
          rankingModels.push({
            newsletter_id: newsletter.id,
            subscribe_count: subscribeRows?.length || 0
          });
        }
      }
      
      // Sort by subscribe_count descending
      rankingModels.sort((a, b) => b.subscribe_count - a.subscribe_count);
      
      // Insert rankings
      if (rankingModels.length > 0) {
        const { error: insertError } = await this.client
          .from(SubscribeRankingModel.tableName)
          .insert(rankingModels.map(model => ({
            newsletter_id: model.newsletter_id,
            subscribe_count: model.subscribe_count
          })));
        
        if (insertError) throw insertError;
      }
    }
  };

  static UpdateNewsletterLastRecvDateTime = class extends SupabaseCRUDTemplate {
    constructor(newsletter) {
      super();
      this.newsletter = newsletter;
    }

    async execute() {
      const { error } = await this.client
        .from(NewsLetterModel.tableName)
        .update({ last_recv_at: new Date().toISOString() })
        .eq('id', this.newsletter.id);
      
      if (error) throw error;
    }
  };

  static ReadCategoriesOfNewsletter = class extends SupabaseCRUDTemplate {
    async execute() {
      const { data: rows, error } = await this.client
        .from(CategoryModel.tableName)
        .select('*');
      
      if (error) throw error;
      
      return (rows || []).map(categoryModel => new Category(categoryModel.id, categoryModel.name));
    }
  };
}

