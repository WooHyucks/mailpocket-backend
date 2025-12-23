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
import * as cheerio from 'cheerio';

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
        send_date: data.send_date,
        language: data.language
      });
    }
  };

  static LoadNewsLetterByID = class extends SupabaseCRUDTemplate {
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
      
      return new NewsLetter({
        id: newsletterData.id,
        name: newsletterData.name,
        category_id: newsletterData.category_id,
        send_date: newsletterData.send_date,
        language: newsletterData.language || 'ko'
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
        language: newsletterData.language,
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
          operating_status: newsletterModel.operating_status,
          language: newsletterModel.language
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
          language: newsletterModel.language,
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

  // ============================================================
  // Newsletter Matching Strategy - 4-Step Resolution
  // ============================================================
  // 0. From header name matching (highest priority)
  // 1. HTML body text-based name matching
  // 2. Email address exact matching
  // 3. Domain matching (excluding blacklist, single match only)
  // ============================================================

  static DOMAIN_BLACKLIST = [
    'gmail.com',
    'naver.com',
    'daum.net',
    'kakao.com',
    'outlook.com',
    'hotmail.com',
    'yahoo.com',
    'stibee.com',
    'send.stibee.com',
    'mailchimp.com',
    'sendgrid.net',
    'substack.com'
  ];

  static MAX_HTML_TEXT_LENGTH = 10000;

  static normalize(text) {
    return text
      .toLowerCase()
      .replace(/\s+/g, '') // Remove all whitespace
      .replace(/[^\w가-힣]/g, ''); // Remove special characters, keep alphanumeric and Korean
  }

  static extractTextForNameMatching(html) {
    const $ = cheerio.load(html);
    $('script, style, head').remove();
    const text = $('body').text();
    const normalized = NewsLetterRepository.normalize(text);
    return normalized.slice(0, NewsLetterRepository.MAX_HTML_TEXT_LENGTH);
  }

  static extractDomain(email) {
    const match = email.match(/@([^@]+)$/);
    return match ? match[1].toLowerCase() : null;
  }

  static MatchNewsletterByFromName = class extends SupabaseCRUDTemplate {
    constructor(parsedFromName, newsletters) {
      super();
      this.parsedFromName = parsedFromName;
      this.newsletters = newsletters;
    }

    execute() {
      const normalizedFromName = NewsLetterRepository.normalize(this.parsedFromName);

      for (const newsletter of this.newsletters) {
        const normalizedName = NewsLetterRepository.normalize(newsletter.name);
        
        if (normalizedFromName.includes(normalizedName)) {
          console.log(`[MATCH] from_name success: ${newsletter.name}`);
          return {
            newsletter: { id: newsletter.id, name: newsletter.name },
            matchedBy: 'from_name'
          };
        }
      }

      console.log('[MATCH] from_name failed');
      return { newsletter: null, matchedBy: null };
    }
  };

  static MatchNewsletterByHtmlBody = class extends SupabaseCRUDTemplate {
    constructor(htmlBody, newsletters) {
      super();
      this.htmlBody = htmlBody;
      this.newsletters = newsletters;
    }

    execute() {
      const htmlText = NewsLetterRepository.extractTextForNameMatching(this.htmlBody);

      for (const newsletter of this.newsletters) {
        const normalizedName = NewsLetterRepository.normalize(newsletter.name);
        
        if (htmlText.includes(normalizedName)) {
          console.log(`[MATCH] html_body success: ${newsletter.name}`);
          return {
            newsletter: { id: newsletter.id, name: newsletter.name },
            matchedBy: 'html_body'
          };
        }
      }

      console.log('[MATCH] html_body failed');
      return { newsletter: null, matchedBy: null };
    }
  };

  static MatchNewsletterByEmail = class extends SupabaseCRUDTemplate {
    constructor(parsedFromEmail, newsletterEmailAddresses, newsletters) {
      super();
      this.parsedFromEmail = parsedFromEmail;
      this.newsletterEmailAddresses = newsletterEmailAddresses;
      this.newsletters = newsletters;
    }

    execute() {
      for (const emailInfo of this.newsletterEmailAddresses) {
        if (emailInfo.email_address === this.parsedFromEmail) {
          const newsletter = this.newsletters.find(n => n.id === emailInfo.newsletter_id);
          if (newsletter) {
            console.log(`[MATCH] email success: ${newsletter.name}`);
            return {
              newsletter: { id: newsletter.id, name: newsletter.name },
              matchedBy: 'email'
            };
          }
        }
      }

      console.log('[MATCH] email failed');
      return { newsletter: null, matchedBy: null };
    }
  };

  static MatchNewsletterByDomain = class extends SupabaseCRUDTemplate {
    constructor(parsedFromEmail, newsletterEmailAddresses, newsletters) {
      super();
      this.parsedFromEmail = parsedFromEmail;
      this.newsletterEmailAddresses = newsletterEmailAddresses;
      this.newsletters = newsletters;
    }

    execute() {
      const domain = NewsLetterRepository.extractDomain(this.parsedFromEmail);
      
      if (!domain) {
        console.log('[MATCH] domain failed: no domain');
        return { newsletter: null, matchedBy: null };
      }

      if (NewsLetterRepository.DOMAIN_BLACKLIST.includes(domain)) {
        console.log(`[MATCH] domain failed: ${domain} is in blacklist`);
        return { newsletter: null, matchedBy: null };
      }

      // Find all newsletters with matching domain from newsletter_email_addresses
      const matchingNewsletterIds = new Set();
      
      for (const emailInfo of this.newsletterEmailAddresses) {
        const emailDomain = NewsLetterRepository.extractDomain(emailInfo.email_address);
        if (emailDomain && emailDomain === domain) {
          matchingNewsletterIds.add(emailInfo.newsletter_id);
        }
      }

      // Only match if exactly one newsletter has this domain
      if (matchingNewsletterIds.size === 1) {
        const newsletterId = Array.from(matchingNewsletterIds)[0];
        const newsletter = this.newsletters.find(n => n.id === newsletterId);
        if (newsletter) {
          console.log(`[MATCH] domain success: ${newsletter.name}`);
          return {
            newsletter: { id: newsletter.id, name: newsletter.name },
            matchedBy: 'domain'
          };
        }
      }

      if (matchingNewsletterIds.size > 1) {
        console.log(`[MATCH] domain failed: multiple newsletters found (${matchingNewsletterIds.size})`);
      } else {
        console.log('[MATCH] domain failed: no matching domain');
      }
      
      return { newsletter: null, matchedBy: null };
    }
  };

  static ResolveNewsletter = class extends SupabaseCRUDTemplate {
    constructor(parsedFromName, parsedFromEmail, htmlBody) {
      super();
      this.parsedFromName = parsedFromName;
      this.parsedFromEmail = parsedFromEmail;
      this.htmlBody = htmlBody;
    }

    async execute() {
      // Load all newsletters and email addresses once
      const { data: newsletters, error: newslettersError } = await this.client
        .from(NewsLetterModel.tableName)
        .select('id, name, language');

      if (newslettersError || !newsletters || newsletters.length === 0) {
        console.log('[MATCH] Failed to load newsletters');
        return { newsletter: null, matchedBy: null };
      }

      const { data: newsletterEmailAddresses, error: emailsError } = await this.client
        .from(NewsletterEmailAddressesModel.tableName)
        .select('newsletter_id, email_address');

      if (emailsError) {
        console.log('[MATCH] Failed to load newsletter email addresses');
        return { newsletter: null, matchedBy: null };
      }

      const newsletterList = newsletters;
      const emailList = newsletterEmailAddresses || [];

      // Step 0: Try From header name matching (highest priority)
      const fromNameMatch = new NewsLetterRepository.MatchNewsletterByFromName(this.parsedFromName, newsletterList).execute();
      if (fromNameMatch.newsletter) {
        return fromNameMatch;
      }

      // Step 1: Try HTML body name matching
      const htmlBodyMatch = new NewsLetterRepository.MatchNewsletterByHtmlBody(this.htmlBody, newsletterList).execute();
      if (htmlBodyMatch.newsletter) {
        return htmlBodyMatch;
      }

      // Step 2: Try email address exact matching
      const emailMatch = new NewsLetterRepository.MatchNewsletterByEmail(this.parsedFromEmail, emailList, newsletterList).execute();
      if (emailMatch.newsletter) {
        return emailMatch;
      }

      // Step 3: Try domain matching (excluding blacklist, single match only)
      const domainMatch = new NewsLetterRepository.MatchNewsletterByDomain(this.parsedFromEmail, emailList, newsletterList).execute();
      if (domainMatch.newsletter) {
        return domainMatch;
      }

      // All matching strategies failed
      console.log('[MATCH] All matching strategies failed');
      return { newsletter: null, matchedBy: null };
    }
  };
}

