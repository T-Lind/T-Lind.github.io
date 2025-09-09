// Comprehensive word dictionary for Letris
// Using a curated list of common English words suitable for gameplay

class WordDictionary {
    constructor() {
        this.allWords = new Set();
        this.words = new Set();
        this.minWordLength = 4; // Default minimum word length
        this.letterDistribution = 'frequency'; // 'frequency' or 'uniform' - default to frequency
        this.loadDictionary();
    }

    async loadDictionary() {
        try {
            // Try to load from the english.txt file
            const response = await fetch('english.txt');
            if (response.ok) {
                const text = await response.text();
                const words = text.split('\n').map(word => word.trim().toUpperCase());
                
                // Store all words, filter later based on settings
                words.forEach(word => {
                    if (word.length >= 3) { // Always keep 3+ letter words in allWords
                        this.allWords.add(word);
                    }
                });
                
                this.updateWordSet();
                console.log(`Dictionary loaded from english.txt with ${this.allWords.size} total words`);
            } else {
                throw new Error('Could not load english.txt');
            }
        } catch (error) {
            console.warn('Could not load english.txt, falling back to built-in dictionary:', error);
            this.loadFallbackDictionary();
        }
    }

    updateWordSet() {
        // Update the active word set based on current minimum length
        this.words.clear();
        this.allWords.forEach(word => {
            if (word.length >= this.minWordLength) {
                this.words.add(word);
            }
        });
        console.log(`Active dictionary updated: ${this.words.size} words (${this.minWordLength}+ letters)`);
    }

    setMinWordLength(length) {
        this.minWordLength = length;
        this.updateWordSet();
    }

    setLetterDistribution(distribution) {
        this.letterDistribution = distribution;
        console.log(`Letter distribution set to: ${distribution}`);
    }

    loadFallbackDictionary() {
        // Fallback dictionary with common words (3+ letters only)
        const fallbackWords = [
            // Common 3-letter words
            'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR',
            'HAD', 'HAS', 'HIS', 'HOW', 'MAN', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WHO', 'BOY', 'DID',
            'ITS', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'WAY', 'WIN', 'YES', 'YET', 'AGO', 'AID',
            'AIM', 'AIR', 'ART', 'ASK', 'BAD', 'BAG', 'BAR', 'BED', 'BIG', 'BIT', 'BOX', 'BUS', 'BUY',
            'CAR', 'CAT', 'CUP', 'CUT', 'DAD', 'DAY', 'DOG', 'EAR', 'EAT', 'EGG', 'END', 'EYE', 'FAR',
            'FEW', 'FIT', 'FLY', 'FUN', 'GET', 'GOT', 'GUN', 'HIT', 'HOT', 'JOB', 'KEY', 'LAW', 'LAY',
            'LEG', 'LIE', 'LOT', 'LOW', 'MAD', 'MAP', 'MAY', 'MOM', 'PAY', 'PEN', 'PET', 'PIG', 'RUN',
            'SAD', 'SIT', 'SIX', 'SUN', 'TEN', 'TOP', 'TRY', 'WAR', 'WIN', 'ZOO',
            
            // Common 4-letter words
            'THAT', 'WITH', 'HAVE', 'THIS', 'WILL', 'YOUR', 'FROM', 'THEY', 'KNOW', 'WANT', 'BEEN',
            'GOOD', 'MUCH', 'SOME', 'TIME', 'VERY', 'WHEN', 'COME', 'HERE', 'JUST', 'LIKE', 'LONG',
            'MAKE', 'MANY', 'OVER', 'SUCH', 'TAKE', 'THAN', 'THEM', 'WELL', 'ALSO', 'BACK', 'CALL',
            'CAME', 'EACH', 'EVEN', 'FIND', 'GIVE', 'HAND', 'HIGH', 'KEEP', 'LAST', 'LEFT', 'LIFE',
            'LIVE', 'LOOK', 'MADE', 'MOST', 'MOVE', 'MUST', 'NAME', 'NEED', 'NEXT', 'ONLY', 'OPEN',
            'PART', 'PLAY', 'SAID', 'SAME', 'SEEM', 'SHOW', 'SIDE', 'TELL', 'TURN', 'USED', 'WANT',
            'WAYS', 'WEEK', 'WENT', 'WERE', 'WHAT', 'WORD', 'WORK', 'YEAR', 'ABLE', 'AWAY', 'BEST',
            'BOTH', 'CARE', 'CASE', 'COME', 'DONE', 'DOWN', 'EASY', 'FACE', 'FACT', 'FAIR', 'FAST',
            'FEEL', 'FIRE', 'FISH', 'FOOD', 'FOOT', 'FORM', 'FREE', 'FULL', 'GAME', 'GIRL', 'GOES',
            'GRAY', 'HELP', 'HOLD', 'HOME', 'HOPE', 'HOUR', 'IDEA', 'INTO', 'KING', 'LAND', 'LATE',
            'LOVE', 'MAIN', 'MEAN', 'MIND', 'MISS', 'NEAR', 'ONCE', 'POOR', 'RACE', 'REAL', 'ROAD',
            'ROOM', 'SAFE', 'SIZE', 'SOON', 'STOP', 'SURE', 'TALK', 'TEAM', 'TOLD', 'TOOK', 'TREE',
            'TRUE', 'TYPE', 'WAIT', 'WALK', 'WALL', 'WARM', 'WIDE', 'WIFE', 'WILD', 'WIND', 'WISH', 'WOOD',
            
            // Common 5+ letter words
            'ABOUT', 'AFTER', 'AGAIN', 'BEING', 'COULD', 'EVERY', 'FIRST', 'FOUND', 'GREAT', 'GROUP',
            'HOUSE', 'LARGE', 'MIGHT', 'NEVER', 'OTHER', 'PLACE', 'RIGHT', 'SHALL', 'SMALL', 'SOUND',
            'STILL', 'THEIR', 'THERE', 'THESE', 'THINK', 'THREE', 'UNDER', 'WATER', 'WHERE', 'WHICH',
            'WHILE', 'WORLD', 'WOULD', 'WRITE', 'YOUNG', 'BEFORE', 'PEOPLE', 'SCHOOL', 'SYSTEM', 'LITTLE'
        ];

        fallbackWords.forEach(word => this.allWords.add(word.toUpperCase()));
        this.updateWordSet();
        console.log(`Fallback dictionary loaded with ${this.allWords.size} total words`);
    }

    isValidWord(word) {
        if (!word || word.length < this.minWordLength) return false;
        return this.words.has(word.toUpperCase());
    }

    // Calculate word score based on letter values (Scrabble-inspired)
    calculateWordScore(word, baseMultiplier = 1) {
        const letterValues = {
            'A': 1, 'E': 1, 'I': 1, 'O': 1, 'U': 1, 'L': 1, 'N': 1, 'S': 1, 'T': 1, 'R': 1,
            'D': 2, 'G': 2,
            'B': 3, 'C': 3, 'M': 3, 'P': 3,
            'F': 4, 'H': 4, 'V': 4, 'W': 4, 'Y': 4,
            'K': 5,
            'J': 8, 'X': 8,
            'Q': 10, 'Z': 10
        };

        let score = 0;
        for (let letter of word.toUpperCase()) {
            score += letterValues[letter] || 1;
        }

        // Length bonus
        const lengthBonus = Math.max(0, word.length - 3) * 2;
        
        // Uniform distribution bonus (1.05x multiplier)
        const distributionBonus = this.letterDistribution === 'uniform' ? 1.05 : 1.0;
        
        return Math.floor((score + lengthBonus) * baseMultiplier * distributionBonus);
    }

    // Get a random letter with frequency-based or uniform distribution
    getRandomLetter() {
        if (this.letterDistribution === 'uniform') {
            // Uniform distribution - all letters equally likely
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            return letters[Math.floor(Math.random() * letters.length)];
        } else {
            // Letter frequency in English (approximate)
            const letterFrequency = {
                'A': 8.2, 'B': 1.5, 'C': 2.8, 'D': 4.3, 'E': 12.7, 'F': 2.2, 'G': 2.0, 'H': 6.1,
                'I': 7.0, 'J': 0.15, 'K': 0.77, 'L': 4.0, 'M': 2.4, 'N': 6.7, 'O': 7.5, 'P': 1.9,
                'Q': 0.1, 'R': 6.0, 'S': 6.3, 'T': 9.1, 'U': 2.8, 'V': 1.0, 'W': 2.4, 'X': 0.15,
                'Y': 2.0, 'Z': 0.07
            };

            // Create weighted array
            const weightedLetters = [];
            for (let [letter, frequency] of Object.entries(letterFrequency)) {
                const weight = Math.round(frequency * 10);
                for (let i = 0; i < weight; i++) {
                    weightedLetters.push(letter);
                }
            }

            return weightedLetters[Math.floor(Math.random() * weightedLetters.length)];
        }
    }

    // Find all valid words in a grid (for testing/debugging)
    findAllWords(grid, minLength = 3) {
        const words = [];
        const rows = grid.length;
        const cols = grid[0].length;

        // Check horizontal words
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col <= cols - minLength; col++) {
                for (let len = minLength; len <= cols - col; len++) {
                    const word = grid[row].slice(col, col + len).join('');
                    if (this.isValidWord(word)) {
                        words.push({
                            word,
                            positions: Array.from({length: len}, (_, i) => ({row, col: col + i})),
                            direction: 'horizontal'
                        });
                    }
                }
            }
        }

        // Check vertical words
        for (let col = 0; col < cols; col++) {
            for (let row = 0; row <= rows - minLength; row++) {
                for (let len = minLength; len <= rows - row; len++) {
                    const word = Array.from({length: len}, (_, i) => grid[row + i][col]).join('');
                    if (this.isValidWord(word)) {
                        words.push({
                            word,
                            positions: Array.from({length: len}, (_, i) => ({row: row + i, col})),
                            direction: 'vertical'
                        });
                    }
                }
            }
        }

        return words;
    }
}

// Export for use in game
window.WordDictionary = WordDictionary;
