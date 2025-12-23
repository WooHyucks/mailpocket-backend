// Database models - these are just type definitions/helpers
// In Node.js, we'll use raw SQL queries with mysql2

export const UserModel = {
  tableName: 'user',
  fields: ['id', 'identifier', 'password', 'platform', 'platform_id', 'is_member']
};

export const ChannelModel = {
  tableName: 'channel',
  fields: ['id', 'webhook_url', 'slack_channel_id', 'name', 'team_name', 'team_icon', 'user_id']
};

export const NewsLetterModel = {
  tableName: 'newsletter',
  fields: ['id', 'name', 'from_email', 'send_date', 'last_recv_at', 'operating_status', 'category_id', 'language']
};

export const NewsletterEmailAddressesModel = {
  tableName: 'newsletter_email_addresses',
  fields: ['id', 'newsletter_id', 'email_address']
};

export const SubscribeModel = {
  tableName: 'subscribe',
  fields: ['id', 'newsletter_id', 'user_id']
};

export const SubscribeRankingModel = {
  tableName: 'subscribe_ranking',
  fields: ['id', 'newsletter_id', 'subscribe_count', 'snapshot_at']
};

export const MailModel = {
  tableName: 'mail',
  fields: ['id', 's3_object_key', 'subject', 'summary_list', 'newsletter_id', 'recv_at', 'html_body', 'translated_body']
};

export const CategoryModel = {
  tableName: 'category',
  fields: ['id', 'name']
};


