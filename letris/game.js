// Letris - Word Tetris Game
// Main game logic and rendering

class LetrisGame {
    constructor() {
        this.canvas = document.getElementById('gameBoard');
        this.ctx = this.canvas.getContext('2d');
        this.dictionary = new WordDictionary();
        
        // Game constants
        this.BOARD_WIDTH = 10;
        this.BOARD_HEIGHT = 10;
        this.CELL_SIZE = 40;
        this.COLORS = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
        ];
        
        // Game state
        this.board = [];
        this.currentPiece = null;
        this.nextLetter = '';
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.gameOver = false;
        this.paused = false;
        this.dropTimer = 0;
        this.dropInterval = 500; // milliseconds - increased default speed
        this.lastTime = 0;
        this.dictionaryLoaded = false;
        
        // Initialize game
        this.initializeBoard();
        this.bindEvents();
        this.bindSettingsEvents();
        this.initializeGame();
    }

    async initializeGame() {
        // Wait for dictionary to load
        await this.waitForDictionary();
        this.dictionaryLoaded = true;
        
        this.generateNextPiece();
        this.updateDisplay();
        this.gameLoop();
    }

    async waitForDictionary() {
        // Wait until the dictionary is loaded
        let attempts = 0;
        while (this.dictionary.words.size === 0 && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (this.dictionary.words.size === 0) {
            console.warn('Dictionary loading timed out, using fallback');
            this.dictionary.loadFallbackDictionary();
        }
    }

    initializeBoard() {
        this.board = Array(this.BOARD_HEIGHT).fill(null).map(() => 
            Array(this.BOARD_WIDTH).fill(null)
        );
    }

    bindEvents() {
        // Keyboard controls
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
        
        // UI buttons
        document.getElementById('pauseButton').addEventListener('click', () => this.togglePause());
        document.getElementById('newGameButton').addEventListener('click', () => this.newGame());
        document.getElementById('restartButton').addEventListener('click', () => this.newGame());
    }

    bindSettingsEvents() {
        // Settings controls
        const letterDistributionSelect = document.getElementById('letterDistribution');
        const minWordLengthSelect = document.getElementById('minWordLength');
        
        letterDistributionSelect.addEventListener('change', (e) => {
            this.dictionary.setLetterDistribution(e.target.value);
        });
        
        minWordLengthSelect.addEventListener('change', (e) => {
            this.dictionary.setMinWordLength(parseInt(e.target.value));
        });
    }

    handleKeyPress(e) {
        if (this.gameOver) return;
        
        switch(e.code) {
            case 'ArrowLeft':
                e.preventDefault();
                if (!this.paused) this.movePiece(-1, 0);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (!this.paused) this.movePiece(1, 0);
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (!this.paused) this.movePiece(0, 1);
                break;
            case 'Space':
                e.preventDefault();
                if (!this.paused) this.hardDrop();
                break;
            case 'KeyP':
                e.preventDefault();
                this.togglePause();
                break;
        }
    }

    generateNextPiece() {
        // If we don't have a current piece, initialize both current and next
        if (!this.currentPiece) {
            this.nextLetter = this.dictionary.getRandomLetter();
            document.getElementById('nextLetter').textContent = this.nextLetter;
        }
        
        // Move next letter to current piece
        const currentLetter = this.nextLetter || this.dictionary.getRandomLetter();
        
        this.currentPiece = {
            letter: currentLetter,
            x: Math.floor(this.BOARD_WIDTH / 2),
            y: 0,
            color: this.COLORS[Math.floor(Math.random() * this.COLORS.length)]
        };
        
        // Check for game over
        if (this.board[0][this.currentPiece.x] !== null) {
            this.endGame();
            return;
        }
        
        // Generate new next letter
        this.nextLetter = this.dictionary.getRandomLetter();
        document.getElementById('nextLetter').textContent = this.nextLetter;
    }

    movePiece(dx, dy) {
        const newX = this.currentPiece.x + dx;
        const newY = this.currentPiece.y + dy;
        
        if (this.isValidPosition(newX, newY)) {
            this.currentPiece.x = newX;
            this.currentPiece.y = newY;
            return true;
        } else if (dy > 0) {
            // Piece can't move down, place it
            this.placePiece();
            return false;
        }
        return false;
    }

    isValidPosition(x, y) {
        return x >= 0 && x < this.BOARD_WIDTH && 
               y >= 0 && y < this.BOARD_HEIGHT && 
               (y === 0 || this.board[y][x] === null);
    }

    hardDrop() {
        while (this.movePiece(0, 1)) {
            // Keep dropping until it hits something
        }
    }

    placePiece() {
        // Place the current piece on the board
        this.board[this.currentPiece.y][this.currentPiece.x] = {
            letter: this.currentPiece.letter,
            color: this.currentPiece.color
        };
        
        // Check for words and handle chain reactions
        this.processWordMatches();
        
        // Generate next piece
        this.generateNextPiece();
    }

    processWordMatches() {
        let chainReaction = true;
        let totalWordsFound = 0;
        let chainMultiplier = 1;
        
        while (chainReaction) {
            const wordsFound = this.findAndRemoveWords();
            
            if (wordsFound.length > 0) {
                totalWordsFound += wordsFound.length;
                
                // Calculate score for this chain
                let chainScore = 0;
                wordsFound.forEach(wordData => {
                    const baseScore = this.dictionary.calculateWordScore(wordData.word);
                    chainScore += baseScore * chainMultiplier;
                    this.showWordFound(wordData.word, baseScore * chainMultiplier);
                });
                
                this.score += chainScore;
                this.lines += wordsFound.length;
                
                // Apply gravity after removing words
                this.applyGravity();
                
                // Increase chain multiplier for next iteration
                chainMultiplier += 0.5;
                
                // Small delay for visual effect
                setTimeout(() => {}, 300);
            } else {
                chainReaction = false;
            }
        }
        
        // Update level based on lines cleared
        const newLevel = Math.floor(this.lines / 10) + 1;
        if (newLevel > this.level) {
            // Level up animation
            const levelElement = document.getElementById('level');
            levelElement.classList.add('level-up');
            setTimeout(() => {
                levelElement.classList.remove('level-up');
            }, 800);
        }
        
        this.level = newLevel;
        this.dropInterval = Math.max(100, 500 - (this.level - 1) * 50);
        
        this.updateDisplay();
    }

    findAndRemoveWords() {
        const wordsFound = [];
        const cellsToRemove = new Set();
        
        // Find horizontal words
        for (let row = 0; row < this.BOARD_HEIGHT; row++) {
            this.findWordsInLine(row, 'horizontal', wordsFound, cellsToRemove);
        }
        
        // Find vertical words
        for (let col = 0; col < this.BOARD_WIDTH; col++) {
            this.findWordsInLine(col, 'vertical', wordsFound, cellsToRemove);
        }
        
        // Find diagonal words (both directions)
        this.findDiagonalWords(wordsFound, cellsToRemove);
        
        // Remove found words from board
        cellsToRemove.forEach(key => {
            const [row, col] = key.split(',').map(Number);
            this.board[row][col] = null;
        });
        
        return wordsFound;
    }

    findWordsInLine(lineIndex, direction, wordsFound, cellsToRemove) {
        const cells = [];
        const maxLength = direction === 'horizontal' ? this.BOARD_WIDTH : this.BOARD_HEIGHT;
        
        // Get cells in the line
        for (let i = 0; i < maxLength; i++) {
            const row = direction === 'horizontal' ? lineIndex : i;
            const col = direction === 'horizontal' ? i : lineIndex;
            cells.push({
                row,
                col,
                cell: this.board[row][col]
            });
        }
        
        // Find consecutive letter sequences
        let currentSequence = [];
        
        for (let i = 0; i < cells.length; i++) {
            const cellData = cells[i];
            
            if (cellData.cell && cellData.cell.letter) {
                currentSequence.push(cellData);
            } else {
                // End of sequence, check for words
                this.checkSequenceForWords(currentSequence, wordsFound, cellsToRemove);
                currentSequence = [];
            }
        }
        
        // Check final sequence
        this.checkSequenceForWords(currentSequence, wordsFound, cellsToRemove);
    }

    findDiagonalWords(wordsFound, cellsToRemove) {
        // Check all diagonals (both directions)
        const directions = [
            {dr: 1, dc: 1},   // Down-right
            {dr: 1, dc: -1}   // Down-left
        ];
        
        directions.forEach(({dr, dc}) => {
            // Start from edges
            for (let startRow = 0; startRow < this.BOARD_HEIGHT; startRow++) {
                this.findDiagonalWordsFromPosition(startRow, 0, dr, dc, wordsFound, cellsToRemove);
            }
            
            for (let startCol = 1; startCol < this.BOARD_WIDTH; startCol++) {
                this.findDiagonalWordsFromPosition(0, startCol, dr, dc, wordsFound, cellsToRemove);
            }
        });
    }

    findDiagonalWordsFromPosition(startRow, startCol, dr, dc, wordsFound, cellsToRemove) {
        const cells = [];
        let row = startRow;
        let col = startCol;
        
        while (row >= 0 && row < this.BOARD_HEIGHT && col >= 0 && col < this.BOARD_WIDTH) {
            cells.push({
                row,
                col,
                cell: this.board[row][col]
            });
            row += dr;
            col += dc;
        }
        
        // Find consecutive sequences in diagonal
        let currentSequence = [];
        
        for (let i = 0; i < cells.length; i++) {
            const cellData = cells[i];
            
            if (cellData.cell && cellData.cell.letter) {
                currentSequence.push(cellData);
            } else {
                this.checkSequenceForWords(currentSequence, wordsFound, cellsToRemove);
                currentSequence = [];
            }
        }
        
        this.checkSequenceForWords(currentSequence, wordsFound, cellsToRemove);
    }

    checkSequenceForWords(sequence, wordsFound, cellsToRemove) {
        if (sequence.length < 3) return;
        
        // Check all possible substrings of length 3 or more
        for (let start = 0; start <= sequence.length - 3; start++) {
            for (let end = start + 3; end <= sequence.length; end++) {
                const subSequence = sequence.slice(start, end);
                const word = subSequence.map(s => s.cell.letter).join('');
                
                if (this.dictionary.isValidWord(word)) {
                    wordsFound.push({
                        word,
                        positions: subSequence.map(s => ({row: s.row, col: s.col}))
                    });
                    
                    // Mark cells for removal
                    subSequence.forEach(s => {
                        cellsToRemove.add(`${s.row},${s.col}`);
                    });
                }
            }
        }
    }

    applyGravity() {
        // Make letters fall down to fill empty spaces
        for (let col = 0; col < this.BOARD_WIDTH; col++) {
            // Collect all non-null cells in this column
            const nonNullCells = [];
            for (let row = this.BOARD_HEIGHT - 1; row >= 0; row--) {
                if (this.board[row][col] !== null) {
                    nonNullCells.push(this.board[row][col]);
                }
                this.board[row][col] = null;
            }
            
            // Place them at the bottom
            for (let i = 0; i < nonNullCells.length; i++) {
                this.board[this.BOARD_HEIGHT - 1 - i][col] = nonNullCells[i];
            }
        }
    }

    showWordFound(word, points) {
        const wordFoundElement = document.getElementById('wordFound');
        const foundWordElement = document.getElementById('foundWord');
        const wordPointsElement = document.getElementById('wordPoints');
        
        foundWordElement.textContent = word;
        wordPointsElement.textContent = `+${points}`;
        
        wordFoundElement.classList.add('visible', 'word-found-animation');
        
        // Animate score increment
        const scoreElement = document.getElementById('score');
        scoreElement.classList.add('score-increment');
        
        setTimeout(() => {
            scoreElement.classList.remove('score-increment');
        }, 500);
        
        setTimeout(() => {
            wordFoundElement.classList.remove('visible', 'word-found-animation');
        }, 2000);
    }

    togglePause() {
        this.paused = !this.paused;
        const pauseButton = document.getElementById('pauseButton');
        pauseButton.textContent = this.paused ? 'Resume' : 'Pause';
        
        // Show/hide pause indicator
        const pauseIndicator = document.querySelector('.paused-indicator');
        if (pauseIndicator) {
            pauseIndicator.classList.toggle('visible', this.paused);
        }
    }

    newGame() {
        this.initializeBoard();
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.gameOver = false;
        this.paused = false;
        this.dropTimer = 0;
        this.dropInterval = 500; // Reset to faster default speed
        
        document.getElementById('gameOverlay').classList.remove('visible');
        document.getElementById('pauseButton').textContent = 'Pause';
        
        this.generateNextPiece();
        this.updateDisplay();
    }

    endGame() {
        this.gameOver = true;
        document.getElementById('finalScore').textContent = this.score;
        document.getElementById('gameOverlay').classList.add('visible');
    }

    updateDisplay() {
        document.getElementById('score').textContent = this.score.toLocaleString();
        document.getElementById('level').textContent = this.level;
        document.getElementById('lines').textContent = this.lines;
    }

    render() {
        // Clear canvas
        this.ctx.fillStyle = '#f8f9fa';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Show loading message if dictionary isn't loaded yet
        if (!this.dictionaryLoaded) {
            this.ctx.fillStyle = '#666';
            this.ctx.font = 'bold 24px "Segoe UI", system-ui, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('Loading Dictionary...', this.canvas.width / 2, this.canvas.height / 2);
            return;
        }
        
        // Draw grid
        this.ctx.strokeStyle = '#e9ecef';
        this.ctx.lineWidth = 1;
        
        for (let row = 0; row <= this.BOARD_HEIGHT; row++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, row * this.CELL_SIZE);
            this.ctx.lineTo(this.canvas.width, row * this.CELL_SIZE);
            this.ctx.stroke();
        }
        
        for (let col = 0; col <= this.BOARD_WIDTH; col++) {
            this.ctx.beginPath();
            this.ctx.moveTo(col * this.CELL_SIZE, 0);
            this.ctx.lineTo(col * this.CELL_SIZE, this.canvas.height);
            this.ctx.stroke();
        }
        
        // Draw placed pieces
        for (let row = 0; row < this.BOARD_HEIGHT; row++) {
            for (let col = 0; col < this.BOARD_WIDTH; col++) {
                const cell = this.board[row][col];
                if (cell) {
                    this.drawLetterBlock(col * this.CELL_SIZE, row * this.CELL_SIZE, 
                                       cell.letter, cell.color);
                }
            }
        }
        
        // Draw current falling piece
        if (this.currentPiece && !this.gameOver && !this.paused) {
            this.drawLetterBlock(
                this.currentPiece.x * this.CELL_SIZE,
                this.currentPiece.y * this.CELL_SIZE,
                this.currentPiece.letter,
                this.currentPiece.color
            );
        }
    }

    drawLetterBlock(x, y, letter, color) {
        const padding = 2;
        
        // Draw block background
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x + padding, y + padding, 
                         this.CELL_SIZE - padding * 2, this.CELL_SIZE - padding * 2);
        
        // Draw shadow/border
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        this.ctx.fillRect(x + padding + 2, y + padding + 2, 
                         this.CELL_SIZE - padding * 2, this.CELL_SIZE - padding * 2);
        
        // Redraw main block
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x + padding, y + padding, 
                         this.CELL_SIZE - padding * 2 - 2, this.CELL_SIZE - padding * 2 - 2);
        
        // Draw letter
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 24px "Segoe UI", system-ui, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(letter, x + this.CELL_SIZE / 2, y + this.CELL_SIZE / 2);
    }

    gameLoop(currentTime = 0) {
        const deltaTime = currentTime - this.lastTime;
        this.lastTime = currentTime;
        
        if (!this.gameOver && !this.paused && this.dictionaryLoaded) {
            this.dropTimer += deltaTime;
            
            if (this.dropTimer >= this.dropInterval) {
                this.movePiece(0, 1);
                this.dropTimer = 0;
            }
        }
        
        this.render();
        requestAnimationFrame((time) => this.gameLoop(time));
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.game = new LetrisGame();
});

// Add pause indicator to DOM
document.addEventListener('DOMContentLoaded', () => {
    const pauseIndicator = document.createElement('div');
    pauseIndicator.className = 'paused-indicator';
    pauseIndicator.textContent = 'PAUSED';
    document.querySelector('.game-board-container').appendChild(pauseIndicator);
});
