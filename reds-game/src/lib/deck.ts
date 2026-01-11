import { Card, Suit, Rank } from '@/types/game';
import { v4 as uuidv4 } from 'uuid';

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Create a new deck of 52 cards + 2 Jokers (per deck)
export function createDeck(deckCount: number = 1): Card[] {
  const deck: Card[] = [];
  
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({
          id: uuidv4(),
          suit,
          rank,
          faceUp: false,
        });
      }
    }
    
    // Add 2 Jokers per deck
    deck.push({
      id: uuidv4(),
      suit: 'joker',
      rank: 'JOKER',
      faceUp: false,
    });
    deck.push({
      id: uuidv4(),
      suit: 'joker',
      rank: 'JOKER',
      faceUp: false,
    });
  }
  
  return deck;
}

// Fisher-Yates shuffle algorithm
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// Deal cards to players
export function dealCards(deck: Card[], numPlayers: number, cardsPerPlayer: number = 4): { 
  playerHands: Card[][];
  remainingDeck: Card[];
} {
  const playerHands: Card[][] = Array.from({ length: numPlayers }, () => []);
  let deckIndex = 0;
  
  // Deal cards one at a time to each player
  for (let cardNum = 0; cardNum < cardsPerPlayer; cardNum++) {
    for (let playerIndex = 0; playerIndex < numPlayers; playerIndex++) {
      if (deckIndex < deck.length) {
        playerHands[playerIndex].push({
          ...deck[deckIndex],
          faceUp: false,
        });
        deckIndex++;
      }
    }
  }
  
  return {
    playerHands,
    remainingDeck: deck.slice(deckIndex),
  };
}

// Draw a card from the deck
export function drawFromDeck(deck: Card[]): { card: Card | null; remainingDeck: Card[] } {
  if (deck.length === 0) {
    return { card: null, remainingDeck: [] };
  }
  
  const [card, ...remainingDeck] = deck;
  return { card: { ...card, faceUp: true }, remainingDeck };
}

// Draw from discard pile
export function drawFromDiscard(discardPile: Card[]): { card: Card | null; remainingPile: Card[] } {
  if (discardPile.length === 0) {
    return { card: null, remainingPile: [] };
  }
  
  const [card, ...remainingPile] = discardPile;
  return { card: { ...card, faceUp: true }, remainingPile };
}

// Generate a random 6-digit game code
export function generateGameCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Get card display info
export function getCardDisplay(card: Card): { symbol: string; color: string } {
  if (card.rank === 'JOKER') {
    return {
      symbol: '★',
      color: 'text-purple-600',
    };
  }
  
  const suitSymbols: Record<Suit, string> = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠',
    joker: '★',
  };
  
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  
  return {
    symbol: suitSymbols[card.suit],
    color: isRed ? 'text-red-600' : 'text-gray-900',
  };
}

