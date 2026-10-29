const MAX_OPTIONS = 8;
const LETTERS = 'ABCDEFGH';
const $ = selector => document.querySelector(selector);
const state = { user: null, scope: 'all', currentPoll: null, toastTimer: null, searchTimer: null };

const socket = io();
const authDialog = $('#authDialog');
const createDialog = $('#createDialog');

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function setUser(user) {
  state.user = user;
  $('#guestActions').hidden = Boolean(user);
  $('#memberActions').hidden = !user;
  $('#memberName').textContent = user?.name || '';
  $('#mineTab').classList.toggle('requires-auth', !user);
}

function openAuth(mode = 'login') {
  setAuthMode(mode);
  $('#authMessage').textContent = '';
  authDialog.showModal();
}

function setAuthMode(mode) {
  const registering = mode === 'register';
  document.querySelectorAll('.auth-mode').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  $('#authNameField').hidden = !registering;
  $('#authName').required = registering;
  $('#authTitle').textContent = registering ? 'Make it yours.' : 'Welcome back.';
  $('#authSubtitle').textContent = registering ? 'Create an account to make and save polls.' : 'Sign in to vote and keep your polls close.';
  $('#authSubmit').textContent = registering ? 'Create my account' : 'Log in';
  $('#authPassword').autocomplete = registering ? 'new-password' : 'current-password';
  $('#authMessage').textContent = '';
}

document.querySelectorAll('.auth-mode').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.mode)));
$('#loginButton').addEventListener('click', () => openAuth('login'));
$('#signupButton').addEventListener('click', () => openAuth('register'));
$('#heroCreateButton').addEventListener('click', openCreateDialog);
$('#logoutButton').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
    setUser(null);
    if (state.scope === 'mine') setScope('all');
    await loadPolls();
    if (state.currentPoll) await loadPollDetail(state.currentPoll.id, false);
    showToast('You are signed out.');
  } catch (error) { showToast(error.message); }
});

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#authSubmit');
  const mode = $('.auth-mode.active').dataset.mode;
  const payload = { email: $('#authEmail').value.trim(), password: $('#authPassword').value };
  if (mode === 'register') payload.name = $('#authName').value.trim();
  const message = $('#authMessage');
  message.classList.remove('success');
  message.textContent = '';
  button.disabled = true;
  try {
    const { user } = await api(`/api/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
    setUser(user);
    authDialog.close();
    $('#authForm').reset();
    await loadPolls();
    if (state.currentPoll) await loadPollDetail(state.currentPoll.id, false);
    showToast(mode === 'register' ? `Welcome to Pulse, ${user.name}.` : `Welcome back, ${user.name}.`);
  } catch (error) {
    message.textContent = error.message;
  } finally { button.disabled = false; }
});

function openCreateDialog() {
  if (!state.user) return openAuth('register');
  $('#createMessage').textContent = '';
  createDialog.showModal();
}

document.querySelectorAll('.filter-tab').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.scope === 'mine' && !state.user) return openAuth('login');
  setScope(button.dataset.scope);
}));

function setScope(scope) {
  state.scope = scope;
  document.querySelectorAll('.filter-tab').forEach(button => button.classList.toggle('active', button.dataset.scope === scope));
  loadPolls();
}

$('#searchInput').addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadPolls, 180);
});

async function loadPolls() {
  const grid = $('#pollGrid');
  if (state.scope === 'mine' && !state.user) {
    grid.replaceChildren();
    renderEmpty(grid, 'Sign in to see your polls.', 'Your polls will be saved to your account.');
    $('#pollCount').textContent = '';
    return;
  }
  try {
    const params = new URLSearchParams({ scope: state.scope });
    const search = $('#searchInput').value.trim();
    if (search) params.set('q', search);
    const { polls } = await api(`/api/polls?${params}`);
    renderPollCards(polls);
  } catch (error) {
    grid.replaceChildren();
    renderEmpty(grid, 'The polls could not load.', error.message);
  }
}

function renderEmpty(container, title, description, action = false) {
  const empty = document.createElement('div');
  empty.className = 'empty-library';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const text = document.createElement('p');
  text.textContent = description;
  empty.append(heading, text);
  if (action) {
    const button = document.createElement('button');
    button.className = 'button button-primary';
    button.type = 'button';
    button.textContent = state.user ? 'Create a poll' : 'Create an account';
    button.addEventListener('click', state.user ? openCreateDialog : () => openAuth('register'));
    empty.appendChild(button);
  }
  container.appendChild(empty);
}

function renderPollCards(polls) {
  const grid = $('#pollGrid');
  grid.replaceChildren();
  $('#pollCount').textContent = `${polls.length} ${polls.length === 1 ? 'poll' : 'polls'}`;
  if (!polls.length) {
    const searching = Boolean($('#searchInput').value.trim());
    renderEmpty(grid, searching ? 'No polls found.' : state.scope === 'mine' ? 'Your first poll starts here.' : 'The room is quiet.', searching ? 'Try a different search.' : 'Ask a question and invite people to weigh in.', !searching);
    return;
  }
  polls.forEach(poll => grid.appendChild(makePollCard(poll)));
}

function makePollCard(poll) {
  const card = document.createElement('article');
  card.className = 'poll-tile';
  card.tabIndex = 0;
  card.setAttribute('role', 'link');
  card.setAttribute('aria-label', `Open poll: ${poll.question}`);
  const top = document.createElement('div');
  top.className = 'tile-top';
  const status = document.createElement('span');
  status.className = `tile-tag${poll.closed ? ' closed' : ''}`;
  status.textContent = poll.closed ? 'Closed' : '● Live poll';
  const owner = document.createElement('span');
  owner.className = 'tile-owner';
  owner.textContent = `by ${poll.creator}`;
  top.append(status, owner);
  const question = document.createElement('h3');
  question.className = 'tile-question';
  question.textContent = poll.question;
  const preview = document.createElement('div');
  preview.className = 'tile-preview';
  const first = document.createElement('div');
  first.className = 'mini-row';
  const optionText = document.createElement('strong');
  optionText.textContent = `${poll.optionCount} choices`;
  const count = document.createElement('span');
  count.textContent = poll.totalVotes ? `${poll.totalVotes} votes` : 'No votes yet';
  first.append(optionText, count);
  preview.appendChild(first);
  const footer = document.createElement('div');
  footer.className = 'tile-footer';
  const date = document.createElement('span');
  date.textContent = formatDate(poll.createdAt);
  const action = document.createElement('strong');
  action.textContent = 'Open poll ↗';
  footer.append(date, action);
  card.append(top, question, preview, footer);
  card.addEventListener('click', () => openPoll(poll.id));
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPoll(poll.id); }
  });
  return card;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

async function openPoll(pollId) {
  if (state.currentPoll?.id && state.currentPoll.id !== pollId) socket.emit('stopWatchingPoll', state.currentPoll.id);
  history.pushState({}, '', `/?poll=${encodeURIComponent(pollId)}`);
  await loadPollDetail(pollId, true);
}

async function loadPollDetail(pollId, joinRoom) {
  $('#homeView').hidden = true;
  $('#detailView').hidden = false;
  const container = $('#detailContent');
  container.innerHTML = '<div class="detail-card">Loading poll…</div>';
  try {
    const { poll } = await api(`/api/polls/${encodeURIComponent(pollId)}`);
    state.currentPoll = poll;
    if (joinRoom) socket.emit('watchPoll', poll.id);
    renderDetail(poll);
  } catch (error) {
    state.currentPoll = null;
    container.replaceChildren();
    renderEmpty(container, 'Poll unavailable.', error.message, false);
  }
}

function showHome(updateUrl = true) {
  if (state.currentPoll) socket.emit('stopWatchingPoll', state.currentPoll.id);
  state.currentPoll = null;
  $('#detailView').hidden = true;
  $('#homeView').hidden = false;
  if (updateUrl) history.pushState({}, '', '/');
  loadPolls();
}

$('#backButton').addEventListener('click', () => showHome());
window.addEventListener('popstate', () => {
  const pollId = new URLSearchParams(location.search).get('poll');
  if (pollId) loadPollDetail(pollId, true);
  else showHome(false);
});

function renderDetail(poll) {
  const container = $('#detailContent');
  container.replaceChildren();
  const layout = document.createElement('div');
  layout.className = 'detail-layout';
  const mainCard = document.createElement('section');
  mainCard.className = 'detail-card';
  const topLine = document.createElement('div');
  topLine.className = 'detail-topline';
  const status = document.createElement('span');
  status.className = `status-tag${poll.closed ? ' closed' : ''}`;
  status.textContent = poll.closed ? 'Poll closed' : '● Voting is open';
  const owner = document.createElement('span');
  owner.className = 'detail-owner';
  owner.textContent = `Created by ${poll.creator}`;
  topLine.append(status, owner);
  const question = document.createElement('h1');
  question.className = 'detail-question';
  question.textContent = poll.question;
  const date = document.createElement('p');
  date.className = 'detail-date';
  date.textContent = `Created ${formatDate(poll.createdAt)}`;
  mainCard.append(topLine, question, date);
  const form = document.createElement('form');
  form.addEventListener('submit', event => submitVote(event, poll));
  const description = document.createElement('p');
  description.className = 'detail-description';
  description.textContent = 'Choose one answer';
  const options = document.createElement('div');
  options.className = 'vote-options';
  const canVote = state.user && !poll.closed && !poll.hasVoted;
  poll.options.forEach(option => {
    const label = document.createElement('label');
    label.className = `vote-option${poll.myChoiceId === option.id ? ' selected' : ''}`;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'choice';
    input.value = option.id;
    input.disabled = !canVote;
    input.checked = poll.myChoiceId === option.id;
    const radio = document.createElement('span');
    radio.className = 'radio-mark';
    const text = document.createElement('span');
    text.textContent = option.text;
    input.addEventListener('change', () => {
      options.querySelectorAll('.vote-option').forEach(item => item.classList.remove('selected'));
      label.classList.add('selected');
    });
    label.append(input, radio, text);
    options.appendChild(label);
  });
  const message = document.createElement('p');
  message.className = 'detail-message';
  message.setAttribute('role', 'status');
  const voteButton = document.createElement('button');
  voteButton.className = 'button button-primary vote-action';
  voteButton.type = 'submit';
  if (!state.user) {
    voteButton.textContent = 'Sign in to vote';
    voteButton.addEventListener('click', event => { event.preventDefault(); openAuth('login'); });
    message.textContent = 'Sign in to record your vote on this poll.';
  } else if (poll.closed) {
    voteButton.textContent = 'Voting is closed';
    voteButton.disabled = true;
    message.textContent = 'The poll creator has closed this poll.';
  } else if (poll.hasVoted) {
    voteButton.textContent = 'Vote submitted';
    voteButton.disabled = true;
    message.classList.add('success');
    message.textContent = 'Your vote is in. Results are live.';
  } else {
    voteButton.textContent = 'Submit my vote';
    message.textContent = 'Your vote will be saved to your account.';
  }
  form.append(description, options, voteButton, message);
  mainCard.appendChild(form);

  const side = document.createElement('aside');
  side.className = 'side-column';
  side.append(buildResultsCard(poll), buildShareCard(poll));
  if (poll.creatorId === state.user?.id) side.appendChild(buildManageCard(poll));
  layout.append(mainCard, side);
  container.appendChild(layout);
}

async function submitVote(event, poll) {
  event.preventDefault();
  if (!state.user) return openAuth('login');
  if (poll.closed || poll.hasVoted) return;
  const form = event.currentTarget;
  const choiceId = new FormData(form).get('choice');
  const message = form.querySelector('.detail-message');
  if (!choiceId) {
    message.className = 'detail-message error';
    message.textContent = 'Choose an answer before submitting.';
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  message.className = 'detail-message';
  message.textContent = 'Saving your vote…';
  try {
    const { poll: updated } = await api(`/api/polls/${encodeURIComponent(poll.id)}/vote`, { method: 'POST', body: JSON.stringify({ choiceId }) });
    state.currentPoll = updated;
    renderDetail(updated);
    showToast('Your vote is in.');
  } catch (error) {
    message.className = 'detail-message error';
    message.textContent = error.message;
    button.disabled = false;
  }
}

function buildResultsCard(poll) {
  const card = document.createElement('section');
  card.className = 'side-card';
  const header = document.createElement('div');
  header.className = 'results-header';
  const title = document.createElement('h3');
  title.textContent = 'The results';
  const total = document.createElement('span');
  total.className = 'vote-total';
  const number = document.createElement('strong');
  number.textContent = poll.totalVotes;
  const label = document.createElement('span');
  label.textContent = 'VOTES';
  total.append(number, label);
  header.append(title, total);
  const list = document.createElement('div');
  list.className = 'result-list';
  if (!poll.totalVotes) {
    const empty = document.createElement('p');
    empty.className = 'result-empty';
    empty.textContent = 'No votes yet. Be the first to weigh in.';
    list.appendChild(empty);
  }
  poll.options.forEach(option => {
    const percent = poll.totalVotes ? Math.round(option.votes / poll.totalVotes * 100) : 0;
    const line = document.createElement('div');
    line.className = 'result-line';
    const name = document.createElement('span');
    name.className = 'result-line-label';
    name.textContent = option.text;
    const count = document.createElement('span');
    count.className = 'result-line-count';
    count.textContent = `${option.votes} · ${percent}%`;
    const track = document.createElement('div');
    track.className = 'result-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', `${option.text}: ${percent}%`);
    track.setAttribute('aria-valuenow', percent);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const bar = document.createElement('i');
    bar.style.width = `${percent}%`;
    track.appendChild(bar);
    line.append(name, count, track);
    list.appendChild(line);
  });
  const bottom = document.createElement('div');
  bottom.className = 'detail-bottom';
  const toggle = document.createElement('button');
  toggle.className = 'link-button';
  toggle.type = 'button';
  toggle.textContent = 'Show voters ↓';
  const live = document.createElement('span');
  live.className = 'live-note';
  live.innerHTML = '<i></i> LIVE';
  bottom.append(toggle, live);
  const voters = document.createElement('div');
  voters.className = 'voter-list';
  voters.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    voters.hidden = !voters.hidden;
    toggle.setAttribute('aria-expanded', String(!voters.hidden));
    toggle.textContent = voters.hidden ? 'Show voters ↓' : 'Hide voters ↑';
  });
  if (poll.voters.length) {
    poll.voters.forEach(vote => {
      const voter = document.createElement('div');
      voter.className = 'voter-card';
      const avatar = document.createElement('span');
      avatar.className = 'voter-avatar';
      avatar.textContent = vote.name.charAt(0) || '?';
      const info = document.createElement('span');
      info.className = 'voter-info';
      const name = document.createElement('strong');
      name.textContent = vote.name;
      const choice = document.createElement('span');
      choice.textContent = `Voted for ${vote.choice}`;
      info.append(name, choice);
      voter.append(avatar, info);
      voters.appendChild(voter);
    });
  }
  card.append(header, list, bottom, voters);
  return card;
}

function buildShareCard(poll) {
  const card = document.createElement('section');
  card.className = 'side-card';
  const title = document.createElement('h3');
  title.textContent = 'Bring everyone in';
  const row = document.createElement('div');
  row.className = 'share-copy';
  const input = document.createElement('input');
  input.readOnly = true;
  input.value = `${location.origin}/?poll=${encodeURIComponent(poll.id)}`;
  input.setAttribute('aria-label', 'Shareable poll link');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Copy link';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = 'Copy link'; }, 1500);
    } catch {
      input.select();
      document.execCommand('copy');
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = 'Copy link'; }, 1500);
    }
  });
  row.append(input, button);
  card.append(title, row);
  return card;
}

function buildManageCard(poll) {
  const card = document.createElement('section');
  card.className = 'side-card';
  const title = document.createElement('h3');
  title.textContent = 'Poll controls';
  const actions = document.createElement('div');
  actions.className = 'manage-actions';
  const close = document.createElement('button');
  close.className = 'manage-button';
  close.type = 'button';
  close.textContent = poll.closed ? 'Reopen voting' : 'Close voting';
  close.addEventListener('click', async () => {
    close.disabled = true;
    try {
      const { poll: updated } = await api(`/api/polls/${encodeURIComponent(poll.id)}`, { method: 'PATCH', body: JSON.stringify({ closed: !poll.closed }) });
      state.currentPoll = updated;
      renderDetail(updated);
      showToast(updated.closed ? 'Voting is closed.' : 'Voting is open again.');
    } catch (error) { showToast(error.message); close.disabled = false; }
  });
  const remove = document.createElement('button');
  remove.className = 'manage-button danger';
  remove.type = 'button';
  remove.textContent = 'Delete poll';
  remove.addEventListener('click', async () => {
    if (!confirm('Delete this poll and its saved votes? This cannot be undone.')) return;
    remove.disabled = true;
    try {
      await api(`/api/polls/${encodeURIComponent(poll.id)}`, { method: 'DELETE' });
      showHome();
      showToast('Poll deleted.');
    } catch (error) { showToast(error.message); remove.disabled = false; }
  });
  actions.append(close, remove);
  const note = document.createElement('p');
  note.className = 'owner-note';
  note.textContent = 'Close voting when you are ready to wrap up. Your saved results stay available.';
  card.append(title, actions, note);
  return card;
}

$('#createForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('#createMessage');
  message.classList.remove('success');
  message.textContent = '';
  const question = $('#pollQuestion').value.trim();
  const options = [...document.querySelectorAll('.choice-input')].map(input => input.value.trim());
  if (!question) { message.textContent = 'Add a question first.'; return; }
  if (options.some(option => !option)) { message.textContent = 'Fill in every answer choice.'; return; }
  if (new Set(options.map(option => option.toLocaleLowerCase())).size !== options.length) { message.textContent = 'Each choice should be different.'; return; }
  const button = $('#createForm').querySelector('button[type="submit"]');
  button.disabled = true;
  message.textContent = 'Saving your poll…';
  try {
    const { poll } = await api('/api/polls', { method: 'POST', body: JSON.stringify({ question, options }) });
    createDialog.close();
    $('#createForm').reset();
    resetChoiceInputs();
    state.scope = 'mine';
    document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.scope === 'mine'));
    await loadPolls();
    await openPoll(poll.id);
    showToast('Your poll is published and saved.');
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});

function updateChoiceControls() {
  const rows = [...$('#optionsContainer').querySelectorAll('.create-option-row')];
  $('#optionCount').textContent = `${rows.length} of ${MAX_OPTIONS}`;
  $('#addOptionButton').disabled = rows.length >= MAX_OPTIONS;
  rows.forEach((row, index) => {
    row.querySelector('.choice-letter').textContent = LETTERS[index];
    row.querySelector('.remove-choice').disabled = rows.length <= 2;
  });
}

$('#addOptionButton').addEventListener('click', () => {
  const container = $('#optionsContainer');
  if (container.children.length >= MAX_OPTIONS) return;
  const row = document.createElement('div');
  row.className = 'create-option-row';
  const letter = document.createElement('span');
  letter.className = 'choice-letter';
  const input = document.createElement('input');
  input.className = 'choice-input';
  input.name = 'option';
  input.maxLength = 80;
  input.placeholder = 'Another choice';
  input.required = true;
  const remove = document.createElement('button');
  remove.className = 'remove-choice';
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove choice');
  remove.textContent = '×';
  row.append(letter, input, remove);
  container.appendChild(row);
  updateChoiceControls();
  input.focus();
});
$('#optionsContainer').addEventListener('click', event => {
  const remove = event.target.closest('.remove-choice');
  if (!remove || remove.disabled) return;
  remove.closest('.create-option-row').remove();
  updateChoiceControls();
});

function resetChoiceInputs() {
  const container = $('#optionsContainer');
  container.innerHTML = '<div class="create-option-row"><span class="choice-letter">A</span><input class="choice-input" name="option" maxlength="80" placeholder="First choice" required><button class="remove-choice" type="button" disabled aria-label="Remove choice">×</button></div><div class="create-option-row"><span class="choice-letter">B</span><input class="choice-input" name="option" maxlength="80" placeholder="Second choice" required><button class="remove-choice" type="button" disabled aria-label="Remove choice">×</button></div>';
  updateChoiceControls();
}

socket.on('connect', () => {
  $('#connectionLabel').textContent = 'Connected';
  $('.connection').classList.remove('disconnected');
  $('.connection').classList.add('connected');
  if (state.currentPoll) socket.emit('watchPoll', state.currentPoll.id);
});
socket.on('disconnect', () => {
  $('#connectionLabel').textContent = 'Reconnecting';
  $('.connection').classList.remove('connected');
  $('.connection').classList.add('disconnected');
});
socket.on('pollListUpdated', () => { if (!$('#homeView').hidden) loadPolls(); });
socket.on('pollUpdated', poll => {
  if (state.currentPoll?.id !== poll.id) return;
  loadPollDetail(poll.id, false);
});
socket.on('pollDeleted', () => {
  state.currentPoll = null;
  showHome();
  showToast('This poll has been deleted.');
});

async function initialize() {
  try {
    const { user } = await api('/api/me');
    setUser(user);
  } catch { setUser(null); }
  updateChoiceControls();
  const pollId = new URLSearchParams(location.search).get('poll');
  if (pollId) await loadPollDetail(pollId, true);
  else await loadPolls();
}

initialize();
