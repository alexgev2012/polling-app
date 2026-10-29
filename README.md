# Pulse polling

Pulse is a small account-based polling website built with Express and Socket.IO. Members can create and save polls, share a direct link, vote once per account, follow live results, and close or reopen their polls.

## Run locally

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) and create an account. Press `Ctrl+C` in the terminal to stop the server.

## Data and behavior

- Accounts, polls, sessions, and votes are saved in `data/app-data.json` and remain available after a server restart.
- The `data/` directory is excluded from Git. Back it up if you need to preserve local data.
- This version stores data in one local JSON file and is intended for one running server process. For a public multi-instance deployment, move storage to a database and configure HTTPS with `NODE_ENV=production`.
- Polls appear in the public directory and can also be opened by direct link. Only the creator can close, reopen, or delete a poll. Voter names and choices appear in the poll's voter list.
- Passwords are stored as scrypt hashes. Sign-in sessions use an HTTP-only cookie and expire after 30 days.

In PowerShell, set `$env:PORT=4000` before `npm start` to change the listening port.
