const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
let { Server } = require('socket.io');
let io = new Server(server);

app.use(express.static('public'));

let poll = {
    question: "What is your favorite programming language?",
    options: {
        "JavaScript": 0,
        "Python": 0,
        "Java": 0,
        "C++": 0
    }
}

let user = {}
io.on('connection', function (socket) {
    socket.emit('newPoll', poll)

    socket.on('sentPoll', function ({ pollQuestion, optionArr }) {
        poll = {
            question: pollQuestion,
            options: {

            }
        }
        for (let i = 0; i < optionArr.length; i++) {
            poll.options[optionArr[i]] = 0
        }
        user = {}
        io.emit('newPoll', poll)
    })

    socket.on('vote', function ({ userID, userName, choice }) {
        if (!userName) {
            socket.emit('voterejected', 'Please enter username')
            return
        }
        if (user[userID]) {
            socket.emit('voterejected', 'You have already voted')
            return
        }
        if (poll.options[choice] != undefined) {
            poll.options[choice]++
            user[userID] = { userName, choice }
        }
        io.emit('newPoll', poll)
        console.log(user)
    })
});


const PORT = 3000;
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));