-- Supabase Database Schema for MailPocket
-- Run this SQL in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User table
CREATE TABLE IF NOT EXISTS "user" (
    id BIGSERIAL PRIMARY KEY,
    identifier VARCHAR(255),
    password VARCHAR(255),
    platform VARCHAR(50),
    platform_id VARCHAR(255),
    is_member BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Category table
CREATE TABLE IF NOT EXISTS category (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Newsletter table
CREATE TABLE IF NOT EXISTS newsletter (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    from_email VARCHAR(255),
    send_date VARCHAR(50),
    last_recv_at TIMESTAMP WITH TIME ZONE,
    operating_status INTEGER DEFAULT 1,
    category_id BIGINT REFERENCES category(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Newsletter Email Addresses table
CREATE TABLE IF NOT EXISTS newsletter_email_addresses (
    id BIGSERIAL PRIMARY KEY,
    newsletter_id BIGINT NOT NULL REFERENCES newsletter(id) ON DELETE CASCADE,
    email_address VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(newsletter_id, email_address)
);

-- Subscribe table
CREATE TABLE IF NOT EXISTS subscribe (
    id BIGSERIAL PRIMARY KEY,
    newsletter_id BIGINT NOT NULL REFERENCES newsletter(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(newsletter_id, user_id)
);

-- Subscribe Ranking table
CREATE TABLE IF NOT EXISTS subscribe_ranking (
    id BIGSERIAL PRIMARY KEY,
    newsletter_id BIGINT NOT NULL REFERENCES newsletter(id) ON DELETE CASCADE,
    subscribe_count INTEGER DEFAULT 0,
    snapshot_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(newsletter_id)
);

-- Channel table
CREATE TABLE IF NOT EXISTS channel (
    id BIGSERIAL PRIMARY KEY,
    webhook_url TEXT,
    slack_channel_id VARCHAR(255),
    name VARCHAR(255),
    team_name VARCHAR(255),
    team_icon TEXT,
    user_id BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mail table
CREATE TABLE IF NOT EXISTS mail (
    id BIGSERIAL PRIMARY KEY,
    s3_object_key VARCHAR(255) NOT NULL UNIQUE,
    subject TEXT,
    summary_list JSONB,
    newsletter_id BIGINT REFERENCES newsletter(id) ON DELETE SET NULL,
    recv_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_identifier ON "user"(identifier);
CREATE INDEX IF NOT EXISTS idx_user_platform ON "user"(platform, platform_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_category ON newsletter(category_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_email_addresses_email ON newsletter_email_addresses(email_address);
CREATE INDEX IF NOT EXISTS idx_subscribe_user ON subscribe(user_id);
CREATE INDEX IF NOT EXISTS idx_subscribe_newsletter ON subscribe(newsletter_id);
CREATE INDEX IF NOT EXISTS idx_channel_user ON channel(user_id);
CREATE INDEX IF NOT EXISTS idx_mail_newsletter ON mail(newsletter_id);
CREATE INDEX IF NOT EXISTS idx_mail_recv_at ON mail(recv_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscribe_ranking_newsletter ON subscribe_ranking(newsletter_id);

-- Enable Row Level Security (RLS) - 기본적으로 비활성화, 필요시 활성화
-- ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE newsletter ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE mail ENABLE ROW LEVEL SECURITY;
-- 등등...

