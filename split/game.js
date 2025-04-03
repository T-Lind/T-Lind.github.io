// Game state variables
let score = 0;
let timer = 5.0; // seconds per round
let timerInterval = null;
let gameInProgress = false;
let leftAnswered = false;
let rightAnswered = false;
let currentLeftQuestion = null;
let currentRightQuestion = null;

// Define key mappings for each panel
const leftKeys = ['q', 'w', 'e', 'r'];
const rightKeys = ['u', 'i', 'o', 'p'];

// Utility: Check if a number is prime.
function isPrime(num) {
    if (num < 2) return false;
    for (let i = 2; i <= Math.sqrt(num); i++) {
        if (num % i === 0) return false;
    }
    return true;
}

// --- Question Generators ---
// Each generator returns an object:
// { text: string, options: [string, ...], correctIndex: number }

const questionGenerators = [
    // 1. Prime number check (2 options)
    function () {
        const num = Math.floor(Math.random() * 98) + 2; // between 2 and 99
        const correct = isPrime(num);
        return {
            text: `Is ${num} a prime number?`,
            options: ["Yes", "No"],
            correctIndex: correct ? 0 : 1
        };
    },
    // 2. Addition question (4 options)
    function () {
        const a = Math.floor(Math.random() * 50) + 1;
        const b = Math.floor(Math.random() * 50) + 1;
        const correctAnswer = a + b;
        let options = [correctAnswer];
        while (options.length < 4) {
            let wrong = correctAnswer + Math.floor(Math.random() * 10) - 5;
            if (wrong !== correctAnswer && !options.includes(wrong) && wrong >= 0) {
                options.push(wrong);
            }
        }
        options = options.sort(() => Math.random() - 0.5);
        return {
            text: `What is ${a} + ${b}?`,
            options: options.map(String),
            correctIndex: options.indexOf(correctAnswer)
        };
    },
    // 3. Subtraction question (4 options)
    function () {
        const a = Math.floor(Math.random() * 50) + 20;
        const b = Math.floor(Math.random() * 20) + 1;
        const correctAnswer = a - b;
        let options = [correctAnswer];
        while (options.length < 4) {
            let wrong = correctAnswer + Math.floor(Math.random() * 10) - 5;
            if (wrong !== correctAnswer && !options.includes(wrong) && wrong >= 0) {
                options.push(wrong);
            }
        }
        options = options.sort(() => Math.random() - 0.5);
        return {
            text: `What is ${a} - ${b}?`,
            options: options.map(String),
            correctIndex: options.indexOf(correctAnswer)
        };
    },
    // 4. Multiplication question (4 options)
    function () {
        const a = Math.floor(Math.random() * 12) + 1;
        const b = Math.floor(Math.random() * 12) + 1;
        const correctAnswer = a * b;
        let options = [correctAnswer];
        while (options.length < 4) {
            let wrong = correctAnswer + Math.floor(Math.random() * 10) - 5;
            if (wrong !== correctAnswer && !options.includes(wrong) && wrong >= 0) {
                options.push(wrong);
            }
        }
        options = options.sort(() => Math.random() - 0.5);
        return {
            text: `What is ${a} x ${b}?`,
            options: options.map(String),
            correctIndex: options.indexOf(correctAnswer)
        };
    },
    // 5. Largest number among four (4 options)
    function () {
        let numbers = [];
        for (let i = 0; i < 4; i++) {
            numbers.push(Math.floor(Math.random() * 100));
        }
        const correctAnswer = Math.max(...numbers);
        return {
            text: `Which is the largest number?`,
            options: numbers.map(String),
            correctIndex: numbers.indexOf(correctAnswer)
        };
    },
    // 6. Identify the even number (4 options; only one is even)
    function () {
        let numbers = [];
        let even = Math.floor(Math.random() * 50) * 2;
        let correctIndex = Math.floor(Math.random() * 4);
        for (let i = 0; i < 4; i++) {
            if (i === correctIndex) {
                numbers.push(even);
            } else {
                // generate an odd number
                let odd = Math.floor(Math.random() * 50) * 2 + 1;
                numbers.push(odd);
            }
        }
        return {
            text: `Which number is even?`,
            options: numbers.map(String),
            correctIndex: correctIndex
        };
    },
    // 7. Fruit identification (4 options)
    function () {
        const fruits = ["Apple", "Banana", "Cherry", "Orange", "Grape", "Mango", "Peach"];
        const nonFruits = ["Car", "House", "Table", "Chair", "Laptop", "Phone", "Book"];
        let correctFruit = fruits[Math.floor(Math.random() * fruits.length)];
        let options = [];
        let correctIndex = Math.floor(Math.random() * 4);
        for (let i = 0; i < 4; i++) {
            if (i === correctIndex) {
                options.push(correctFruit);
            } else {
                options.push(nonFruits[Math.floor(Math.random() * nonFruits.length)]);
            }
        }
        return {
            text: `Which of these is a fruit?`,
            options: options,
            correctIndex: correctIndex
        };
    },
    // 8. Color text challenge (4 options)
    function () {
        const colors = ["Red", "Blue", "Green", "Yellow"];
        const displayedWord = colors[Math.floor(Math.random() * colors.length)];
        const fontColor = colors[Math.floor(Math.random() * colors.length)];
        const textHTML = `What is the <span style="color:${fontColor.toLowerCase()}; font-weight:bold;">${displayedWord}</span> color?`;
        return {
            text: textHTML,
            options: colors,
            correctIndex: colors.indexOf(fontColor)
        };
    },
    // 9. Word scramble challenge (4 options)
    function () {
        const words = ["happy", "puzzle", "split", "random", "logic", "brain"];
        const correctWord = words[Math.floor(Math.random() * words.length)];
        const scrambled = correctWord.split('').sort(() => Math.random() - 0.5).join('');
        let options = [correctWord];
        while (options.length < 4) {
            let candidate = words[Math.floor(Math.random() * words.length)];
            if (!options.includes(candidate)) {
                options.push(candidate);
            }
        }
        options = options.sort(() => Math.random() - 0.5);
        return {
            text: `Unscramble this word: ${scrambled}`,
            options: options,
            correctIndex: options.indexOf(correctWord)
        };
    },
    // 10. Division question (4 options) - ensures clean division.
    function () {
        const divisor = Math.floor(Math.random() * 9) + 2; // 2 to 10
        const quotient = Math.floor(Math.random() * 10) + 1; // 1 to 10
        const dividend = divisor * quotient;
        let options = [quotient];
        while (options.length < 4) {
            let wrong = quotient + Math.floor(Math.random() * 5) - 2;
            if (wrong !== quotient && wrong > 0 && !options.includes(wrong)) {
                options.push(wrong);
            }
        }
        options = options.sort(() => Math.random() - 0.5);
        return {
            text: `What is ${dividend} ÷ ${divisor}?`,
            options: options.map(String),
            correctIndex: options.indexOf(quotient)
        };
    },
    // 11. Square root question (4 options) - choose a perfect square.
    function () {
        const num = Math.floor(Math.random() * 20) + 1; // 1 to 20
        const square = num * num;
        let options = [num];
        while (options.length < 4) {
            let wrong = num + Math.floor(Math.random() * 5) - 2;
            if (wrong !== num && wrong > 0 && !options.includes(wrong)) {
                options.push(wrong);
            }
        }
        options = options.sort(() => Math.random() - 0.5);
        return {
            text: `What is the square root of ${square}?`,
            options: options.map(String),
            correctIndex: options.indexOf(num)
        };
    },
    // 12. Sequence pattern challenge (4 options) - arithmetic progression.
    function () {
        const start = Math.floor(Math.random() * 10) + 1;
        const diff = Math.floor(Math.random() * 5) + 1;
        const seq = [start, start + diff, start + 2 * diff];
        const correctAnswer = start + 3 * diff;
        let options = [correctAnswer];
        while (options.length < 4) {
            let wrong = correctAnswer + Math.floor(Math.random() * 5) - 2;
            if (wrong !== correctAnswer && !options.includes(wrong) && wrong > 0) {
                options.push(wrong);
            }
        }
        options = options.sort(() => Math.random() - 0.5);
        return {
            text: `Complete the sequence: ${seq.join(", ")}, ?`,
            options: options.map(String),
            correctIndex: options.indexOf(correctAnswer)
        };
    },
    // 13. Trivia question: Red Planet (4 options)
    function () {
        return {
            text: "Which planet is known as the Red Planet?",
            options: ["Mars", "Jupiter", "Venus", "Saturn"],
            correctIndex: 0
        };
    },
    // 14. Reverse word challenge (4 options)
    function () {
        const words = ["stream", "garden", "computer", "keyboard", "javascript", "freezer", "strand", "gourd", "container", "popsicle", "meandering"];
        const chosen = words[Math.floor(Math.random() * words.length)];
        const reversed = chosen.split("").reverse().join("");
        let options = [chosen];
        // Create distractors by reversing other words
        while (options.length < 4) {
            let candidate = words[Math.floor(Math.random() * words.length)];
            if (!options.includes(candidate)) {
                options.push(candidate);
            }
        }
        options = options.sort(() => Math.random() - 0.5);
        return {
            text: `Which word reverses to "${reversed}"?`,
            options: options,
            correctIndex: options.indexOf(chosen)
        };
    }
];

// Returns a random question object from one of the generators.
function getRandomQuestion() {
    const generator = questionGenerators[Math.floor(Math.random() * questionGenerators.length)];
    return generator();
}

// Renders a given question on the specified panel ("left" or "right").
function renderQuestion(panel, questionObj) {
    const questionEl = document.getElementById(panel + "-question");
    const optionsEl = document.getElementById(panel + "-options");
    questionEl.innerHTML = questionObj.text;
    optionsEl.innerHTML = "";
    let keys = (panel === "left") ? leftKeys : rightKeys;
    for (let i = 0; i < questionObj.options.length; i++) {
        let optionDiv = document.createElement("div");
        optionDiv.className = "option";
        optionDiv.textContent = keys[i].toUpperCase() + ": " + questionObj.options[i];
        optionsEl.appendChild(optionDiv);
    }
}

// Starts a new round by generating two questions and resetting the timer.
function startRound() {
    leftAnswered = false;
    rightAnswered = false;
    timer = 5.0;
    currentLeftQuestion = getRandomQuestion();
    currentRightQuestion = getRandomQuestion();
    renderQuestion("left", currentLeftQuestion);
    renderQuestion("right", currentRightQuestion);
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timer -= 0.1;
        document.getElementById("timer").textContent = "Time: " + timer.toFixed(1);
        if (timer <= 0) {
            gameOver();
        }
    }, 100);
}

// Ends the game.
function gameOver() {
    gameInProgress = false;
    clearInterval(timerInterval);
    document.getElementById("timer").textContent = "Time: 0.0";
    alert("Game Over! Your score: " + score);
    document.getElementById("restart-button").style.display = "block";
}

// Proceeds to the next round after a successful one.
function nextRound() {
    score++;
    document.getElementById("score").textContent = "Score: " + score;
    startRound();
}

// Listen for key presses for game answers.
document.addEventListener("keydown", function (e) {
    if (gameInProgress) {
        const key = e.key.toLowerCase();
        // Left panel key handling
        if (leftKeys.includes(key)) {
            if (!leftAnswered) {
                const index = leftKeys.indexOf(key);
                if (index < currentLeftQuestion.options.length) {
                    if (index === currentLeftQuestion.correctIndex) {
                        leftAnswered = true;
                    } else {
                        gameOver();
                    }
                }
            }
        }
        // Right panel key handling
        if (rightKeys.includes(key)) {
            if (!rightAnswered) {
                const index = rightKeys.indexOf(key);
                if (index < currentRightQuestion.options.length) {
                    if (index === currentRightQuestion.correctIndex) {
                        rightAnswered = true;
                    } else {
                        gameOver();
                    }
                }
            }
        }
        // When both questions are answered correctly, advance to the next round.
        if (leftAnswered && rightAnswered) {
            clearInterval(timerInterval);
            setTimeout(nextRound, 200);
        }
    } else {
        // If game is not in progress and either Start or Restart button is visible,
        // allow space/enter to trigger it.
        if (e.key === " " || e.key === "Enter") {
            const startButton = document.getElementById("start-button");
            const restartButton = document.getElementById("restart-button");
            if (startButton.style.display !== "none") {
                startButton.click();
            } else if (restartButton.style.display !== "none") {
                restartButton.click();
            }
        }
    }
});

// Start Game button
document.getElementById("start-button").addEventListener("click", function () {
    score = 0;
    document.getElementById("score").textContent = "Score: " + score;
    gameInProgress = true;
    document.getElementById("start-button").style.display = "none";
    document.getElementById("restart-button").style.display = "none";
    startRound();
});

// Restart Game button
document.getElementById("restart-button").addEventListener("click", function () {
    score = 0;
    document.getElementById("score").textContent = "Score: " + score;
    document.getElementById("restart-button").style.display = "none";
    gameInProgress = true;
    startRound();
});
