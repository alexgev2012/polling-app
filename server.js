'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { promisify } = require('util');
const { Server } = require('socket.io');

const scrypt = promisify(crypto.scrypt);
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 30;
const MAX_OPTIONS = 8;
const dataDirectory = path.join(__dirname, 'data');
const dataFile = path.join(dataDirectory, 'app-data.json');

let database = { users: [], polls: [], sessions: [] };
let writeQueue = Promise.resolve();

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function makeId() {
  return crypto.randomUUID();
}

function saveDatabase() {
  const task = writeQueue.then(async () => {
    const temporaryFile = `${dataFile}.${process.pid}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(database, null, 2), 'utf8');
    await fs.rename(temporaryFile, dataFile);
  });
  writeQueue = task.catch(error => console.error('Could not save app data:', error));
  return task;
}

function readCookie(request, name) {
  const cookies = (request.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(cookie.slice(separator + 1).trim()); }
      catch { return ''; }
    }
  }
  return '';
}

function findSessionUser(request) {
  const token = readCookie(request, 'pulse_session');
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = database.sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
  if (!session) return null;
  return database.users.find(user => user.id === session.userId) || null;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function setSessionCookie(response, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `pulse_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}

async function createSession(response, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  database.sessions = database.sessions.filter(session => session.expiresAt > Date.now());
  database.sessions.push({ tokenHash, userId: user.id, expiresAt: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 });
  await saveDatabase();
  setSessionCookie(response, token);
}

function requireUser(request, response, next) {
  const user = findSessionUser(request);
  if (!user) return response.status(401).json({ error: 'Sign in to continue.' });
  request.user = user;
  next();
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return null;
  const options = value.map(option => typeof option === 'string' ? option.trim() : '');
  if (options.length < 2 || options.length > MAX_OPTIONS || options.some(option => !option || option.length > 80)) return null;
  if (new Set(options.map(option => option.toLocaleLowerCase())).size !== options.length) return null;
  return options.map(text => ({ id: makeId(), text }));
}

function getPollView(poll, userId = null) {
  const counts = Object.fromEntries(poll.options.map(option => [option.id, 0]));
  for (const choiceId of Object.values(poll.votes)) {
    if (Object.prototype.hasOwnProperty.call(counts, choiceId)) counts[choiceId] += 1;
  }
  const voters = Object.entries(poll.votes).map(([voterId, choiceId]) => {
    const voter = database.users.find(user => user.id === voterId);
    const option = poll.options.find(item => item.id === choiceId);
    if (!voter || !option) return null;
    return { name: voter.name, choiceId, choice: option.text };
  }).filter(Boolean);
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options.map(option => ({ ...option, votes: counts[option.id] || 0 })),
    totalVotes: voters.length,
    voters,
    creator: database.users.find(user => user.id === poll.creatorId)?.name || 'Former member',
    creatorId: poll.creatorId,
    createdAt: poll.createdAt,
    closed: poll.closed,
    hasVoted: userId ? Object.prototype.hasOwnProperty.call(poll.votes, userId) : false,
    myChoiceId: userId ? poll.votes[userId] || null : null
  };
}

function listPollView(poll) {
  const totalVotes = Object.keys(poll.votes).length;
  return {
    id: poll.id,
    question: poll.question,
    optionCount: poll.options.length,
    totalVotes,
    creator: database.users.find(user => user.id === poll.creatorId)?.name || 'Former member',
    creatorId: poll.creatorId,
    createdAt: poll.createdAt,
    closed: poll.closed
  };
}

function findPoll(pollId) {
  return database.polls.find(poll => poll.id === pollId);
}

function emitPollUpdate(poll) {
  io.to(`poll:${poll.id}`).emit('pollUpdated', getPollView(poll));
  io.emit('pollListUpdated');
}

function sendAuthError(response, status, error) {
  return response.status(status).json({ error });
}

app.get('/', (_request, response) => response.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/me', (request, response) => {
  const user = findSessionUser(request);
  response.json({ user: user ? publicUser(user) : null });
});

app.post('/api/register', async (request, response) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
  const email = normalizeEmail(request.body?.email);
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  if (name.length < 2 || name.length > 40) return sendAuthError(response, 400, 'Name must be 2–40 characters.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendAuthError(response, 400, 'Enter a valid email address.');
  if (password.length < 8 || password.length > 128) return sendAuthError(response, 400, 'Password must be 8–128 characters.');
  if (database.users.some(user => user.email === email)) return sendAuthError(response, 409, 'An account with that email already exists.');

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = await scrypt(password, salt, 64);
  if (database.users.some(user => user.email === email)) return sendAuthError(response, 409, 'An account with that email already exists.');
  const user = { id: makeId(), name, email, salt, passwordHash: passwordHash.toString('hex'), createdAt: new Date().toISOString() };
  database.users.push(user);
  try {
    await createSession(response, user);
    response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    database.users = database.users.filter(item => item.id !== user.id);
    console.error('Account creation failed:', error);
    sendAuthError(response, 500, 'Could not create the account. Please try again.');
  }
});

app.post('/api/login', async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  const user = database.users.find(item => item.email === email);
  if (!user || password.length > 128) return sendAuthError(response, 401, 'Email or password is incorrect.');
  const attemptedHash = await scrypt(password, user.salt, 64);
  const savedHash = Buffer.from(user.passwordHash, 'hex');
  if (savedHash.length !== attemptedHash.length || !crypto.timingSafeEqual(savedHash, attemptedHash)) {
    return sendAuthError(response, 401, 'Email or password is incorrect.');
  }
  try {
    await createSession(response, user);
    response.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Login session failed:', error);
    sendAuthError(response, 500, 'Could not sign in. Please try again.');
  }
});

app.post('/api/logout', async (request, response) => {
  const token = readCookie(request, 'pulse_session');
  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    database.sessions = database.sessions.filter(session => session.tokenHash !== tokenHash);
    try { await saveDatabase(); }
    catch (error) { console.error('Logout session cleanup failed:', error); }
  }
  response.setHeader('Set-Cookie', 'pulse_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  response.json({ ok: true });
});

app.get('/api/polls', (request, response) => {
  const user = findSessionUser(request);
  const scope = request.query.scope === 'mine' ? 'mine' : 'all';
  const search = typeof request.query.q === 'string' ? request.query.q.trim().toLocaleLowerCase() : '';
  let polls = database.polls;
  if (scope === 'mine') polls = user ? polls.filter(poll => poll.creatorId === user.id) : [];
  if (search) polls = polls.filter(poll => `${poll.question} ${database.users.find(item => item.id === poll.creatorId)?.name || ''}`.toLocaleLowerCase().includes(search));
  polls = [...polls].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  response.json({ polls: polls.map(listPollView) });
});

app.post('/api/polls', requireUser, async (request, response) => {
  const question = typeof request.body?.question === 'string' ? request.body.question.trim() : '';
  const options = normalizeOptions(request.body?.options);
  if (!question || question.length > 180) return response.status(400).json({ error: 'Question must be 1–180 characters.' });
  if (!options) return response.status(400).json({ error: `Add 2–${MAX_OPTIONS} different choices, each no longer than 80 characters.` });
  const poll = {
    id: makeId(), creatorId: request.user.id, question, options, votes: {},
    createdAt: new Date().toISOString(), closed: false
  };
  database.polls.push(poll);
  try {
    await saveDatabase();
    io.emit('pollListUpdated');
    response.status(201).json({ poll: getPollView(poll, request.user.id) });
  } catch (error) {
    database.polls = database.polls.filter(item => item.id !== poll.id);
    console.error('Poll creation failed:', error);
    response.status(500).json({ error: 'Could not save this poll. Please try again.' });
  }
});

app.get('/api/polls/:id', (request, response) => {
  const poll = findPoll(request.params.id);
  if (!poll) return response.status(404).json({ error: 'This poll could not be found.' });
  const user = findSessionUser(request);
  response.json({ poll: getPollView(poll, user?.id || null) });
});

app.post('/api/polls/:id/vote', requireUser, async (request, response) => {
  const poll = findPoll(request.params.id);
  if (!poll) return response.status(404).json({ error: 'This poll could not be found.' });
  if (poll.closed) return response.status(409).json({ error: 'This poll is closed.' });
  if (Object.prototype.hasOwnProperty.call(poll.votes, request.user.id)) return response.status(409).json({ error: 'You have already voted in this poll.' });
  const choiceId = typeof request.body?.choiceId === 'string' ? request.body.choiceId : '';
  if (!poll.options.some(option => option.id === choiceId)) return response.status(400).json({ error: 'Choose one of the available options.' });
  poll.votes[request.user.id] = choiceId;
  try {
    await saveDatabase();
    emitPollUpdate(poll);
    response.json({ poll: getPollView(poll, request.user.id) });
  } catch (error) {
    delete poll.votes[request.user.id];
    console.error('Vote save failed:', error);
    response.status(500).json({ error: 'Could not save your vote. Please try again.' });
  }
});

app.patch('/api/polls/:id', requireUser, async (request, response) => {
  const poll = findPoll(request.params.id);
  if (!poll) return response.status(404).json({ error: 'This poll could not be found.' });
  if (poll.creatorId !== request.user.id) return response.status(403).json({ error: 'Only the poll creator can manage this poll.' });
  if (typeof request.body?.closed !== 'boolean') return response.status(400).json({ error: 'Choose whether to close or reopen the poll.' });
  const previousClosed = poll.closed;
  poll.closed = request.body.closed;
  try {
    await saveDatabase();
    emitPollUpdate(poll);
    response.json({ poll: getPollView(poll, request.user.id) });
  } catch (error) {
    poll.closed = previousClosed;
    console.error('Poll update failed:', error);
    response.status(500).json({ error: 'Could not update this poll. Please try again.' });
  }
});

app.delete('/api/polls/:id', requireUser, async (request, response) => {
  const poll = findPoll(request.params.id);
  if (!poll) return response.status(404).json({ error: 'This poll could not be found.' });
  if (poll.creatorId !== request.user.id) return response.status(403).json({ error: 'Only the poll creator can delete this poll.' });
  database.polls = database.polls.filter(item => item.id !== poll.id);
  try {
    await saveDatabase();
    io.to(`poll:${poll.id}`).emit('pollDeleted');
    io.emit('pollListUpdated');
    response.json({ ok: true });
  } catch (error) {
    database.polls.push(poll);
    console.error('Poll deletion failed:', error);
    response.status(500).json({ error: 'Could not delete this poll. Please try again.' });
  }
});

io.on('connection', socket => {
  socket.on('watchPoll', pollId => {
    if (typeof pollId !== 'string' || !findPoll(pollId)) return;
    socket.join(`poll:${pollId}`);
  });
  socket.on('stopWatchingPoll', pollId => {
    if (typeof pollId === 'string') socket.leave(`poll:${pollId}`);
  });
});

async function start() {
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    const saved = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    database = {
      users: Array.isArray(saved.users) ? saved.users : [],
      polls: Array.isArray(saved.polls) ? saved.polls : [],
      sessions: Array.isArray(saved.sessions) ? saved.sessions : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await saveDatabase();
  }
  const now = Date.now();
  database.sessions = database.sessions.filter(session => session.expiresAt > now);
  await saveDatabase();
  server.listen(PORT, () => console.log(`Pulse is running at http://localhost:${PORT}`));
}

start().catch(error => {
  console.error('Could not start Pulse:', error);
  process.exitCode = 1;
});
