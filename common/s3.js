import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

export class S3Connector {
  constructor() {
    this.awsAccessKeyId = process.env.AWS_ACCESS_KEY;
    this.awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    this.bucketName = 'mailpocket-mail';
    
    this.s3Client = new S3Client({
      region: 'ap-northeast-2',
      credentials: {
        accessKeyId: this.awsAccessKeyId,
        secretAccessKey: this.awsSecretAccessKey
      }
    });
  }
}


