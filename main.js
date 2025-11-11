import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { userRouter } from './user/presentation.js';
import { mailRouter } from './mail/presentation.js';
import { channelRouter } from './channel/presentation.js';
import { newsletterRouter } from './newsletter/presentation.js';
import { MailService } from './mail/service.js';
import { UserService } from './user/service.js';
import { Token } from './common/token.js';
import { getExperiment } from './common/experiment.js';
import { catchException, HttpException } from './common/exceptions.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MailPocket API',
      version: '1.0.0',
      description: 'MailPocket Node.js Express Backend API Documentation',
    },
    servers: [
      {
        url: `http://localhost:${port}`,
        description: 'Local development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['./main.js', './**/presentation.js'], // Paths to files containing OpenAPI definitions
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: '*',
  allowedHeaders: '*',
  exposedHeaders: ['Location']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Health check
/**
 * @swagger
 * /haelth-check:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 */
app.get('/haelth-check', (req, res) => {
  res.status(200).send('haelth_check');
});

// Initialize services
const userService = new UserService();
const mailService = new MailService();

// Routes
/**
 * @swagger
 * /mails:
 *   get:
 *     summary: Get mail list
 *     tags: [Mail]
 *     responses:
 *       200:
 *         description: List of mails
 */
app.get('/mails', async (req, res, next) => {
  try {
    const mailList = await mailService.getMailList();
    res.status(200).json(mailList);
  } catch (error) {
    catchException(error, req, next);
  }
});

/**
 * @swagger
 * /mails/detail:
 *   get:
 *     summary: Get mail detail
 *     tags: [Mail]
 *     parameters:
 *       - in: query
 *         name: mail_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Mail detail
 */
app.get('/mails/detail', async (req, res, next) => {
  try {
    const { mail_id } = req.query;
    const mail = await mailService.getMailDetail(mail_id);
    res.status(200).send(mail);
  } catch (error) {
    catchException(error, req, next);
  }
});

/**
 * @swagger
 * /experiment:
 *   get:
 *     summary: Get experiment features
 *     tags: [Experiment]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Experiment features
 */
app.get('/experiment', async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;
    const user_id = Token.getUserIdByToken(authorization);
    const user = await userService.read(user_id);
    const features = await getExperiment(user);
    res.status(200).json(features);
  } catch (error) {
    catchException(error, req, next);
  }
});

// Mount routers
app.use('/user', userRouter);
app.use('/mail', mailRouter);
app.use('/channel', channelRouter);
app.use('/newsletter', newsletterRouter);

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof HttpException) {
    res.status(error.statusCode).json({ detail: error.detail });
  } else {
    res.status(500).json({ detail: 'An internal server error occurred. If the problem persists, please contact our support team.' });
  }
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});

