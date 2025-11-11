import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const clientId = process.env.SLACK_CLIENT_ID;
const clientSecret = process.env.SLACK_CLIENT_SECRET;
const slackLoggingChannelWebhookUrl = process.env.SLACK_LOGGING_CHANNEL_WEBHOOK_URL;
const slackLoggingUnknownEmailAddressWebhookUrl = process.env.SLACK_UNKNOWN_EMAIL_ADDRESS_WEBHOOK_URL;

export class SlackAPI {
  async connectWorkspace(code, userId) {
    const url = 'https://slack.com/api/oauth.v2.access';
    const data = {
      client_id: clientId,
      client_secret: clientSecret,
      code: code
    };
    
    const response = await axios.post(url, data);
    const responseData = response.data;
    const accessToken = responseData.access_token;
    const webhookUrl = responseData.incoming_webhook.url.replace(/\\/g, '');
    const slackChannelId = responseData.incoming_webhook.channel_id;
    const name = responseData.incoming_webhook.channel;
    const teamName = responseData.team.name;
    const teamIcon = await this._getTeamIcon(accessToken);
    
    const Channel = (await import('../channel/domain.js')).Channel;
    return new Channel({
      id: null,
      webhook_url: webhookUrl,
      slack_channel_id: slackChannelId,
      team_name: teamName,
      team_icon: teamIcon,
      name: name,
      user_id: userId
    });
  }

  async _getTeamIcon(accessToken) {
    const url = 'https://slack.com/api/team.info';
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data.team.icon.image_230.replace(/\\/g, '');
  }

  async loging(mail) {
    const notificationText = this.__makeLogNotificationText(mail);
    const data = { blocks: notificationText };
    const resp = await axios.post(slackLoggingChannelWebhookUrl, data);
    console.log('log notification', resp.data);
  }

  __makeLogNotificationText(mail) {
    return [
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `email : ${mail.from_email}\nid : ${mail.from_name}\n*<${mail.read_link}|${mail.subject}>*`
          }
        ]
      }
    ];
  }

  async sendingWelcomeMessage(channel) {
    const welcomeMessage = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '이제부터 이 채널에 뉴스레터를 요약해서 보내드릴게요.\n메일 포켓을 사용하면 이런 게 좋아요.\n\n*1) 매일 쏟아지는 뉴스레터를 3줄 요약해서 슬랙에 보내드려요.*\n눈으로만 훑어보세요. 재미 있는 뉴스라면 조금 더 자세히 보고, 슬랙의 save item 을 사용하면 나중에 읽을 수도 있어요.\n*2) 메일함에 일회성 메일이 쌓이는걸 방지할 수 있어요.*\n뉴스레터 때문에 메일함이 항상 999+ 개 이상 쌓여 있고, 중요 메일 놓쳐본 적 많으시죠? 뉴스레터는 메일 포켓이 받고, 슬랙으로 요약해서 슝- 보내 드릴게요.'
        }
      }
    ];
    const data = { blocks: welcomeMessage };
    await axios.post(channel.webhook_url, data);
  }

  async sendingMailRecvNotification(channel, mail, newsletter) {
    const notificationText = this.__makeNotificationText(channel, mail, newsletter);
    const data = { blocks: notificationText };
    const resp = await axios.post(channel.webhook_url, data);
    console.log('notification', resp.data);
  }

  __makeNotificationText(channel, mail, newsletter) {
    const utmSource = `&utm_source=slack&utm_medium=bot&utm_campaign=${channel.team_name}`;
    const notificationText = [
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `${newsletter.name}의 새로운 소식이 도착했어요.\n*<${mail.read_link}${utmSource}|${mail.subject}>*`
          }
        ]
      }
    ];
    
    if (mail.summary_list) {
      const summaryNewsSlackNotificationTextList = [];
      for (const [subject, content] of Object.entries(mail.summary_list)) {
        summaryNewsSlackNotificationTextList.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${subject}*\n${content}`
          }
        });
      }
      notificationText.push(...summaryNewsSlackNotificationTextList);
    }
    
    return notificationText;
  }

  async logingUnknownEmailAddress(mail) {
    const mrkdwnText = `${mail.from_email}\nis unknown email address\n뉴스레터: ${mail.from_name}\n제목: ${mail.subject}\n링크: ${mail.read_link}\nS3 OBJ KEY: ${mail.s3_object_key}`;
    const data = this.__makeOneSlackMessageBlocks(mrkdwnText);
    await axios.post(slackLoggingUnknownEmailAddressWebhookUrl, data);
  }

  __makeOneSlackMessageBlocks(mrkdwnText) {
    return {
      blocks: [
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: mrkdwnText
            }
          ]
        }
      ]
    };
  }
}


