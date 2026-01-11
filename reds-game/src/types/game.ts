// Card suits and values
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'JOKER';

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
  isReady: boolean;
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
  | 'power_up_choice'   // Player discarded a power-up card and must choose to use or skip
  | 'power_up'          // Player is using a power-up ability
  | 'stacking';         // A stacking action is in progress

export type PowerUpType = 
  | 'inspect_own' 
  | 'inspect_other' 
  | 'blind_swap' 
  | 'inspect_swap'
  | 'blind_swap_others'    // When player has 0 cards - swap 2 other players' cards blindly
  | 'inspect_swap_others'; // When player has 0 cards - inspect and swap 2 other players' cards

export interface PowerUpAction {
  type: PowerUpType;
  sourcePlayerId: string;
  sourceCardIndex?: number;
  targetPlayerId?: string;
  targetCardIndex?: number;
  // For swapping between two opponents (when player has 0 cards)
  secondTargetPlayerId?: string;
  secondTargetCardIndex?: number;
}

export interface StackAction {
  playerId: string;
  playerName: string;
  playerCardIndex: number;
  card: Card;
  targetPlayerId?: string;     // If stacking another player's card
  targetCardIndex?: number;
  timestamp: number;
}

export interface StackAnimation {
  stacks: StackAction[];
  winnerId: string | null;
  resolvedAt: number | null;
  // Track the stack result for animation
  result?: {
    success: boolean;
    stackedCard: Card;
    stackerId: string;
    stackerName: string;
    targetPlayerId?: string; // If stacked opponent's card
    targetCardIndex?: number;
    awaitingCardGive?: boolean; // If stacker needs to select a card to give
  };
}

export interface SwapAnimation {
  type: 'blind_swap' | 'blind_swap_others' | 'inspect_swap' | 'inspect_swap_others';
  playerId: string;  // Player performing the swap
  playerName: string;
  // For regular swaps (player's card <-> opponent's card)
  sourcePlayerId?: string;
  sourceCardIndex?: number;
  targetPlayerId: string;
  targetCardIndex: number;
  // For _others swaps (opponent 1 <-> opponent 2)
  secondTargetPlayerId?: string;
  secondTargetCardIndex?: number;
  phase: 'selecting' | 'animating' | 'completed';
  startedAt: number;
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
  stackAnimation: StackAnimation | null;
  swapAnimation: SwapAnimation | null; // For showing swap animations to all players
  lastDiscardWasStack: boolean; // Prevents multiple stacks on same card
  redsCallerId: string | null;
  finalRoundTurnsRemaining: number;
  winner: string | null;
  lastAction: string;
  stateVersion: number; // Increments on every state change for reliable sync detection
  // Track which card is being inspected (visible to all players)
  inspectingCard: {
    playerId: string;
    cardIndex: number;
  } | null;
  // Penalty card display - visible to all players when someone misstacks
  penaltyCardDisplay: {
    card: Card;
    playerId: string;
    playerName: string;
    shownAt: number;
  } | null;
  // Card movement animation - visible to all players for draw/discard/swap
  cardMoveAnimation: {
    type: 'draw_deck' | 'draw_discard' | 'discard' | 'swap' | 'give';
    playerId: string;
    playerName: string;
    drawnCard: Card | null; // Face-down for other players
    discardedCard: Card | null; // Card going to discard pile
    handIndex: number | null;
    // For give animations
    targetPlayerId?: string;
    targetHandIndex?: number | null;
    startedAt: number;
  } | null;
}

export interface GameMessage {
  type: 
    | 'join_request'
    | 'join_response'
    | 'player_joined'
    | 'player_left'
    | 'player_ready'
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
  
  // Joker = 0
  if (rank === 'JOKER') {
    return 0;
  }
  
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

