const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');

const authRouter = require('./routes/auth');
const clientsRouter = require('./routes/clients');
const agentsRouter = require('./routes/agents');
const callsRouter = require('./routes/calls');
const ticketsRouter = require('./routes/tickets');
const dashboardRouter = require('./routes/dashboard');
const telephonyRouter = require('./routes/telephony');
const errorHandler = require('./middleware/error-handler');

const app = express();
app.set('trust proxy', env.trustProxy);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: env.corsOrigin === '*' ? true : env.corsOrigin,
  })
);
app.use(morgan('dev'));
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'supporthub-backend', now: new Date().toISOString() });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/telephony', telephonyRouter);
app.use('/api/v1/clients', clientsRouter);
app.use('/api/v1/agents', agentsRouter);
app.use('/api/v1/calls', callsRouter);
app.use('/api/v1/tickets', ticketsRouter);
app.use('/api/v1/dashboard', dashboardRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Support Hub API running on port ${env.port}`);
});
