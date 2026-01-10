// Card suits and values
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
}

export interface Player {
  id: string;
  name: string;
  cards: Card[];
  isHost: boolean;
  isConnected: boolean;
  hasSeenBottomCards: boolean;
  hasCalledReds: boolean;
}

export type GamePhase = 
  | 'waiting'           // Waiting for players to join
  | 'viewing_cards'     // Initial phase where players view their bottom 2 cards
  | 'playing'           // Main game phase
  | 'final_round'       // After someone calls reds, everyone gets one more turn
  | 'game_over';        // Game ended, showing results

export type TurnPhase =
  | 'draw'              // Player needs to draw a card
  | 'decide'            // Player has drawn and needs to decide what to do
  | 'power_up'          // Player is using a power-up ability
  | 'stacking';         // A stacking action is in progress

export type PowerUpType = 'inspect_own' | 'inspect_other' | 'blind_swap' | 'inspect_swap';

export interface PowerUpAction {
  type: PowerUpType;
  sourcePlayerId: string;
  sourceCardIndex?: number;
  targetPlayerId?: string;
  targetCardIndex?: number;
}

export interface StackAction {
  playerId: string;
  playerCardIndex: number;
  targetPlayerId?: string;     // If stacking another player's card
  targetCardIndex?: number;
  timestamp: number;
}

export interface GameState {
  gameCode: string;
  phase: GamePhase;
  turnPhase: TurnPhase;
  currentPlayerIndex: number;
  players: Player[];
  deck: Card[];
  discardPile: Card[];
  drawnCard: Card | null;
  currentPowerUp: PowerUpAction | null;
  pendingStacks: StackAction[];
  redsCallerId: string | null;
  finalRoundTurnsRemaining: number;
  winner: string | null;
  lastAction: string;
}

export interface GameMessage {
  type: 
    | 'join_request'
    | 'join_response'
    | 'player_joined'
    | 'player_left'
    | 'game_start'
    | 'state_sync'
    | 'draw_card'
    | 'swap_card'
    | 'discard_card'
    | 'power_up_start'
    | 'power_up_complete'
    | 'stack_attempt'
    | 'stack_result'
    | 'call_reds'
    | 'end_turn'
    | 'reveal_cards'
    | 'game_over';
  payload: unknown;
  timestamp: number;
  senderId: string;
}

// Card value calculation
export function getCardValue(card: Card): number {
  const { rank, suit } = card;
  
  // Red King = -2
  if (rank === 'K' && (suit === 'hearts' || suit === 'diamonds')) {
    return -2;
  }
  
  // Black King = 13
  if (rank === 'K') {
    return 13;
  }
  
  // Face cards
  if (rank === 'Q') return 12;
  if (rank === 'J') return 11;
  if (rank === 'A') return 1;
  
  // Number cards
  return parseInt(rank);
}

// Check if a card has a power-up
export function getCardPowerUp(card: Card): PowerUpType | null {
  switch (card.rank) {
    case '7': return 'inspect_own';
    case '8': return 'inspect_other';
    case '9': return 'blind_swap';
    case '10': return 'inspect_swap';
    default: return null;
  }
}

// Calculate player's total score
export function calculateScore(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + getCardValue(card), 0);
}

// Check if two cards match (for stacking)
export function cardsMatch(card1: Card, card2: Card): boolean {
  return card1.rank === card2.rank;
}

