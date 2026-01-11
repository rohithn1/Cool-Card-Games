/**
 * Card Position Coordinate System
 * 
 * This module provides a standardized coordinate system for all card positions
 * on the game table. Coordinates are in percentages (0-100) relative to the viewport.
 * 
 * Position IDs follow the format:
 * - "deck" - The draw pile
 * - "discard" - The discard pile
 * - "drawn" - The currently drawn card position
 * - "p{playerIndex}c{cardIndex}" - Player's card position (e.g., "p0c0" = player 0, card 0)
 */

// Card dimensions (used for offset calculations)
export const CARD_DIMENSIONS = {
  width: 80,  // lg size width
  height: 112, // lg size height
  gap: 12,    // gap between cards in hand
};

// Base positions for the table layout
interface Position {
  x: number; // percentage from left (0-100)
  y: number; // percentage from top (0-100)
}

// Position with rotation for angled opponent hands
interface OrientedPosition extends Position {
  rotation: number; // degrees
}

/**
 * Get the base position for the deck
 */
export function getDeckPosition(): Position {
  return { x: 45, y: 50 };
}

/**
 * Get the base position for the discard pile
 */
export function getDiscardPosition(): Position {
  return { x: 55, y: 50 };
}

/**
 * Get the position for a drawn card (displayed between deck and discard)
 */
export function getDrawnCardPosition(): Position {
  return { x: 65, y: 50 };
}

/**
 * Get the base position for my hand (current player, always at bottom)
 * Matches: className="absolute bottom-8 left-1/2 -translate-x-1/2"
 * bottom-8 = 32px, which is approximately 3-5% from bottom depending on viewport
 */
export function getMyHandPosition(): Position {
  // bottom-8 = 32px, for a typical viewport this is about 96% down
  return { x: 50, y: 92 };
}

/**
 * Calculate opponent positions based on player count
 * MUST MATCH the calculation in GameTable.tsx for accurate animations
 * Uses semi-ellipse formula with radiusX=42, radiusY=36
 */
export function getOpponentPositions(totalPlayers: number, myPlayerIndex: number): OrientedPosition[] {
  const opponents: OrientedPosition[] = [];
  
  // Calculate how many opponents we have
  const opponentCount = totalPlayers - 1;
  
  if (opponentCount === 0) return opponents;
  
  // MATCH GameTable.tsx calculation exactly
  const maxSpread = Math.min(160, 40 + opponentCount * 25);
  const radiusX = 42;
  const radiusY = 36;
  
  for (let idx = 0; idx < opponentCount; idx++) {
    let angle: number;
    let x: number;
    let y: number;
    let rotationAngle: number;
    
    if (opponentCount === 1) {
      // Single opponent directly across (top center)
      angle = 0;
      x = 50;
      y = 10;
      rotationAngle = 180;
    } else {
      // Multiple opponents - spread evenly across arc
      const step = maxSpread / (opponentCount - 1);
      angle = -maxSpread / 2 + idx * step;
      
      // Convert angle to x,y position on a semi-ellipse
      x = 50 + radiusX * Math.sin(angle * Math.PI / 180);
      y = 50 - radiusY * Math.cos(angle * Math.PI / 180);
      
      // Rotation should face toward center
      rotationAngle = angle + 180;
    }
    
    opponents.push({ x, y, rotation: rotationAngle });
  }
  
  return opponents;
}

/**
 * Get the position of a specific card within a player's hand
 * Cards are ALWAYS arranged in a 2-column grid (adds rows for penalty cards)
 * 
 * MUST MATCH the actual CSS grid layout in PlayerHand.tsx:
 * - Grid uses grid-cols-2 gap-1.5 sm:gap-2 md:gap-3 (responsive)
 * - Cards are approximately 64-80px wide depending on screen size
 * 
 * @param basePosition - The center position of the player's hand
 * @param cardIndex - The index of the card (0-based)
 * @param totalCards - Total number of cards in hand
 * @param isMyHand - Whether this is the current player's hand
 */
export function getCardInHandPosition(
  basePosition: Position,
  cardIndex: number,
  totalCards: number,
  isMyHand: boolean
): Position {
  // Always use 2-column grid layout
  // Cards: [0, 1] row 0, [2, 3] row 1, [4, 5] row 2, etc.
  const col = cardIndex % 2;
  const row = Math.floor(cardIndex / 2);
  const totalRows = Math.ceil(totalCards / 2);
  
  // Spacing in percentage of viewport
  // Cards are ~64-80px wide, gap is ~8-12px
  const cardSpacingX = isMyHand ? 5 : 4; // percentage horizontal spacing between card centers
  const cardSpacingY = isMyHand ? 9 : 6; // percentage vertical spacing between card centers
  
  // Center the grid around the base position
  // X offset: left column (-), right column (+)
  const xOffset = (col === 0 ? -1 : 1) * (cardSpacingX / 2);
  
  // Y offset: center the rows around the base position
  // For 1 row (2 cards): row 0 at center
  // For 2 rows (4 cards): row 0 above, row 1 below center
  // For 3+ rows: expand upward and downward
  const centerRow = (totalRows - 1) / 2;
  const yOffset = (row - centerRow) * cardSpacingY;
  
  return {
    x: basePosition.x + xOffset,
    y: basePosition.y + yOffset,
  };
}

/**
 * Position key type for the coordinate map
 */
export type PositionKey = 
  | 'deck' 
  | 'discard' 
  | 'drawn' 
  | `p${number}c${number}`;

/**
 * Build a complete position map for a given game configuration
 */
export function buildPositionMap(
  totalPlayers: number,
  myPlayerIndex: number,
  playerCardCounts: number[]
): Map<PositionKey, Position> {
  const positionMap = new Map<PositionKey, Position>();
  
  // Static positions
  positionMap.set('deck', getDeckPosition());
  positionMap.set('discard', getDiscardPosition());
  positionMap.set('drawn', getDrawnCardPosition());
  
  // My hand positions
  const myHandBase = getMyHandPosition();
  const myCardCount = playerCardCounts[myPlayerIndex] || 4;
  for (let cardIdx = 0; cardIdx < myCardCount; cardIdx++) {
    const cardPos = getCardInHandPosition(myHandBase, cardIdx, myCardCount, true);
    positionMap.set(`p${myPlayerIndex}c${cardIdx}`, cardPos);
  }
  
  // Opponent positions
  const opponentPositions = getOpponentPositions(totalPlayers, myPlayerIndex);
  let opponentIdx = 0;
  
  for (let playerIdx = 0; playerIdx < totalPlayers; playerIdx++) {
    if (playerIdx === myPlayerIndex) continue;
    
    const opponentBase = opponentPositions[opponentIdx];
    const cardCount = playerCardCounts[playerIdx] || 4;
    
    for (let cardIdx = 0; cardIdx < cardCount; cardIdx++) {
      const cardPos = getCardInHandPosition(opponentBase, cardIdx, cardCount, false);
      positionMap.set(`p${playerIdx}c${cardIdx}`, cardPos);
    }
    
    opponentIdx++;
  }
  
  return positionMap;
}

/**
 * Get pixel coordinates from percentage position
 * Converts percentage-based position to actual pixel coordinates
 */
export function toPixelCoordinates(
  position: Position,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  return {
    x: (position.x / 100) * viewportWidth,
    y: (position.y / 100) * viewportHeight,
  };
}

/**
 * Calculate animation keyframes for a card moving from source to target
 * Goes through center of table for visual interest
 */
export function getSwapAnimationKeyframes(
  sourcePos: Position,
  targetPos: Position,
  goThroughCenter: boolean = true
): { positions: Position[]; times: number[] } {
  if (!goThroughCenter) {
    return {
      positions: [sourcePos, targetPos],
      times: [0, 1],
    };
  }
  
  const centerPos: Position = { x: 50, y: 50 };
  
  return {
    positions: [sourcePos, centerPos, targetPos],
    times: [0, 0.5, 1],
  };
}

/**
 * Helper to get position key for a player's card
 */
export function getPlayerCardKey(playerIndex: number, cardIndex: number): PositionKey {
  return `p${playerIndex}c${cardIndex}`;
}

/**
 * Animation configuration type
 */
export interface AnimationConfig {
  sourceKey: PositionKey;
  targetKey: PositionKey;
  duration: number;
  goThroughCenter?: boolean;
}

/**
 * Pre-defined animation configurations for different game actions
 */
export const ANIMATION_CONFIGS = {
  drawFromDeck: (playerIndex: number, cardIndex: number): AnimationConfig => ({
    sourceKey: 'deck',
    targetKey: getPlayerCardKey(playerIndex, cardIndex),
    duration: 600,
    goThroughCenter: false,
  }),
  
  drawFromDiscard: (playerIndex: number, cardIndex: number): AnimationConfig => ({
    sourceKey: 'discard',
    targetKey: getPlayerCardKey(playerIndex, cardIndex),
    duration: 600,
    goThroughCenter: false,
  }),
  
  discardCard: (playerIndex: number, cardIndex: number): AnimationConfig => ({
    sourceKey: getPlayerCardKey(playerIndex, cardIndex),
    targetKey: 'discard',
    duration: 500,
    goThroughCenter: false,
  }),
  
  swapCards: (
    player1Index: number,
    card1Index: number,
    player2Index: number,
    card2Index: number
  ): AnimationConfig[] => [
    {
      sourceKey: getPlayerCardKey(player1Index, card1Index),
      targetKey: getPlayerCardKey(player2Index, card2Index),
      duration: 1200,
      goThroughCenter: true,
    },
    {
      sourceKey: getPlayerCardKey(player2Index, card2Index),
      targetKey: getPlayerCardKey(player1Index, card1Index),
      duration: 1200,
      goThroughCenter: true,
    },
  ],
  
  giveCard: (
    fromPlayerIndex: number,
    fromCardIndex: number,
    toPlayerIndex: number,
    toCardIndex: number
  ): AnimationConfig => ({
    sourceKey: getPlayerCardKey(fromPlayerIndex, fromCardIndex),
    targetKey: getPlayerCardKey(toPlayerIndex, toCardIndex),
    duration: 1000,
    goThroughCenter: true,
  }),
  
  penaltyCard: (playerIndex: number, cardIndex: number): AnimationConfig => ({
    sourceKey: 'deck',
    targetKey: getPlayerCardKey(playerIndex, cardIndex),
    duration: 800,
    goThroughCenter: false,
  }),
};

