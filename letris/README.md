# Letris - Word Tetris Game

A modern twist on the classic Tetris game where players form words instead of clearing lines. Built with vanilla HTML, CSS, and JavaScript.

## 🎮 How to Play

### Objective
Form valid English words (3+ letters) with falling letter blocks. When words are detected, they disappear and trigger chain reactions as blocks fall down due to gravity.

### Controls
- **←→ Arrow Keys**: Move falling letter left/right
- **↓ Arrow Key**: Soft drop (faster fall)
- **Space**: Hard drop (instant fall)
- **P**: Pause/Resume game
- **New Game Button**: Start over

### Game Mechanics

1. **Letter Blocks**: Individual letters fall from the top, similar to Tetris pieces
2. **Word Formation**: Form words horizontally, vertically, or diagonally (3+ letters)
3. **Word Validation**: Uses a comprehensive English dictionary for validation
4. **Chain Reactions**: When words disappear, blocks above fall down, potentially creating new words
5. **Scoring**: Points based on letter values (Scrabble-inspired) and word length
6. **Levels**: Game speed increases every 10 words cleared
7. **Game Over**: When blocks reach the top of the playing field

### Scoring System

- **Base Score**: Each letter has a point value (A=1, E=1, Q=10, Z=10, etc.)
- **Length Bonus**: +2 points for each letter beyond the minimum 3
- **Chain Multiplier**: Subsequent chain reactions multiply scores (1x, 1.5x, 2x, etc.)

## 🚀 Getting Started

### Run Locally
1. Clone or download the project files
2. Open a terminal in the project directory
3. Start a local web server:
   ```bash
   python -m http.server 8000
   ```
4. Open your browser and go to `http://localhost:8000`

### Files Structure
```
letris/
├── index.html      # Main game page and UI structure
├── styles.css      # Modern CSS styling and animations
├── game.js         # Core game logic and rendering
├── dictionary.js   # Word validation and scoring system
├── english.txt     # Comprehensive English dictionary (50,000+ words)
└── README.md       # This file
```

## 🎯 Features

- **Modern UI**: Clean, responsive design with gradient backgrounds and animations
- **Comprehensive Dictionary**: 50,000+ English words from external dictionary file (3+ letters only)
- **Smart Word Detection**: Finds words in all directions (horizontal, vertical, diagonal)
- **Chain Reactions**: Gravity system enables cascading word formations
- **Visual Feedback**: Animations for word discovery, scoring, and level progression
- **Responsive Design**: Works on desktop and mobile devices
- **Keyboard Controls**: Full keyboard support for smooth gameplay

## 🔧 Technical Implementation

### Core Systems

1. **Game Board**: 10x20 grid rendered on HTML5 Canvas
2. **Letter Generation**: Frequency-based random letter selection
3. **Word Detection**: Multi-directional pattern matching algorithm
4. **Physics**: Gravity simulation for falling blocks
5. **Scoring**: Dynamic point calculation with multipliers

### Edge Cases Handled

- **Overlapping Words**: Prevents double-counting of shared letters
- **Chain Reactions**: Recursive word detection after gravity application
- **Game Over Detection**: Checks for blocked spawn position
- **Input Validation**: Debounced controls to prevent spam
- **Memory Management**: Efficient board state tracking

### Performance Optimizations

- **Canvas Rendering**: Hardware-accelerated graphics
- **Efficient Algorithms**: O(n²) word detection for real-time performance
- **Memory Pooling**: Reuses objects to minimize garbage collection
- **Event Delegation**: Optimized DOM event handling

## 🎨 Design Philosophy

The game combines the addictive mechanics of Tetris with the intellectual challenge of word formation. The visual design emphasizes clarity and modern aesthetics while maintaining accessibility and readability.

### Color Scheme
- **Primary**: Purple-blue gradient background
- **Accent**: Vibrant block colors for visual distinction
- **UI**: Clean whites and grays with subtle shadows
- **Feedback**: Green for positive actions, red for warnings

## 🏆 Strategy Tips

1. **Think Ahead**: Consider how falling blocks will affect existing letter formations
2. **Chain Setup**: Position letters to create multiple words in chain reactions
3. **Letter Management**: Balance vowels and consonants for maximum word potential
4. **Timing**: Use soft drops to position letters precisely
5. **Pattern Recognition**: Look for common word patterns and suffixes

---

Enjoy playing Letris! 🎮✨
