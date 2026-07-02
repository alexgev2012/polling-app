let addOp = document.getElementById("addOp")
let optionsContainer = document.getElementById("optionsContainer")
let form = document.getElementById("createPollForm")
let socket = io()
let pollForm = document.getElementById("pollForm")
let pollQuestionDisplay = document.getElementById("pollQuestionDisplay")
let pollOptions = document.getElementById("pollOptions")
let submitbtn = document.getElementById('voteButton')
let voteForm = document.getElementById('voteForm')
let userNameInput = document.getElementById('usernameInput')
let userID = localStorage.getItem('userID')

if (!userID) {
    userID = Math.floor(Math.random() * 10000)
    localStorage.setItem('userID', userID)
}

addOp.addEventListener("click", AddOption)



function AddOption() {
    let input = document.createElement("input")
    optionsContainer.appendChild(input)
    input.type = "text"
    input.name = "option"
    input.placeholder = "Option " + optionsContainer.children.length
    optionsLen = optionsContainer.children.length
}

form.addEventListener("submit", function (event) {
    let optionArr = []
    event.preventDefault()
    let optionsInput = document.querySelectorAll("#optionsContainer input")
    let pollQuestion = document.getElementById("pollQuestion").value.trim()



    if (pollQuestion == '') {
        alert("Poll question is empty")
        return
    }
    for (let i = 0; i < optionsInput.length; i++) {
        if (optionsInput[i].value === '' || optionsInput[i].value.trim() === '') {
            alert("Option is empty")
            return
        }
        else {
            optionArr.push(optionsInput[i].value)
        }
    }

    let uniqueValue = new Set(optionArr)
    if (uniqueValue.size != optionArr.length) {
        alert("The options are the same")
        return
    }



    socket.emit('sentPoll', { pollQuestion, optionArr })

})

let toggleUserVotes = document.getElementById("toggleUserVotes")
toggleUserVotes.addEventListener("click", function () {
    let userVotes = document.getElementById("userVotes")
    if (userVotes.style.display == "none") {
        userVotes.style.display = "block"
        toggleUserVotes.innerText = "Hide Votes"
    }
    else {
        userVotes.style.display = "none"
        toggleUserVotes.innerText = "Show Votes"
    }
})


socket.on('newPoll', function (data) {
    let obj = Object.keys(data.options)
    pollForm.style.display = "block"
    pollQuestionDisplay.innerText = data.question
    pollOptions.innerHTML = ''
    for (let i = 0; i < obj.length; i++) {
        let input = document.createElement("input")
        let label = document.createElement("label")
        input.type = "radio"
        input.name = "option"
        input.value = obj[i]
        label.innerText = obj[i]
        label.appendChild(input)
        pollOptions.appendChild(label)
    }
    updateChart(data)
})

socket.on('voterejected', function(data) {
    alert(data)
})

voteForm.addEventListener('submit', function (event) {
    event.preventDefault()
    let selected = document.querySelector('#pollOptions input:checked')
    let userName = userNameInput.value.trim()
    if (!userName) return alert("enter username")
    if (!selected) return alert('choose any of options')
    socket.emit('vote', { userID, userName, choice: selected.value })
    selected.checked = false
})

let chart = null

function updateChart(poll) {
    console.log(Object.values(poll.options))
    if(chart != null) {
        chart.destroy
    }
    const ctx = document.getElementById('pollChart');
    let labelsArr = Object.keys(poll.options)

    chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labelsArr,
            datasets: [{
                label: '# of Votes',
                data: Object.values(poll.options),
                borderWidth: 1
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

