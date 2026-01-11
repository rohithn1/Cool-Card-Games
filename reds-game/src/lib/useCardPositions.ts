'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  buildPositionMap,
  getOpponentPositions,
  getMyHandPosition,
  getDeckPosition,
  getDiscardPosition,
  getDrawnCardPosition,
  getCardInHandPosition,
  toPixelCoordinates,
  getSwapAnimationKeyframes,
  PositionKey,
  CARD_DIMENSIONS,
} from './cardPositions';
import { Player } from '@/types/game';

interface UseCardPositionsProps {
  players: Player[];
  myPlayerId: string | null;
}

interface PositionWithPixels {
  x: string; // CSS value (e.g., "50%" or "400px")
  y: string;
  xPx: number;
  yPx: number;
  rotation?: number;
}

interface CardPosition {
  position: PositionWithPixels;
  playerIndex: number;
  cardIndex: number;
}

export function useCardPositions({ players, myPlayerId }: UseCardPositionsProps) {
  const [viewport, setViewport] = useState({ width: 1920, height: 1080 });
  
  // Update viewport size on resize
  useEffect(() => {
    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);
  
  const myPlayerIndex = useMemo(() => {
    return players.findIndex(p => p.id === myPlayerId);
  }, [players, myPlayerId]);
  
  const playerCardCounts = useMemo(() => {
    return players.map(p => p.cards.length);
  }, [players]);
  
  // Build the position map
  const positionMap = useMemo(() => {
    if (players.length === 0 || myPlayerIndex < 0) return new Map();
    return buildPositionMap(players.length, myPlayerIndex, playerCardCounts);
  }, [players.length, myPlayerIndex, playerCardCounts]);
  
  // Get opponent base positions with rotation
  const opponentPositions = useMemo(() => {
    if (players.length === 0 || myPlayerIndex < 0) return [];
    return getOpponentPositions(players.length, myPlayerIndex);
  }, [players.length, myPlayerIndex]);
  
  // Get position for a specific element
  const getPosition = useCallback((key: PositionKey): PositionWithPixels | null => {
    const pos = positionMap.get(key);
    if (!pos) return null;
    
    const pixelPos = toPixelCoordinates(pos, viewport.width, viewport.height);
    
    return {
      x: `${pos.x}%`,
      y: `${pos.y}%`,
      xPx: pixelPos.x,
      yPx: pixelPos.y,
    };
  }, [positionMap, viewport]);
  
  // Get deck position
  const deckPosition = useMemo((): PositionWithPixels => {
    const pos = getDeckPosition();
    const pixelPos = toPixelCoordinates(pos, viewport.width, viewport.height);
    return {
      x: `${pos.x}%`,
      y: `${pos.y}%`,
      xPx: pixelPos.x,
      yPx: pixelPos.y,
    };
  }, [viewport]);
  
  // Get discard position
  const discardPosition = useMemo((): PositionWithPixels => {
    const pos = getDiscardPosition();
    const pixelPos = toPixelCoordinates(pos, viewport.width, viewport.height);
    return {
      x: `${pos.x}%`,
      y: `${pos.y}%`,
      xPx: pixelPos.x,
      yPx: pixelPos.y,
    };
  }, [viewport]);
  
  // Get drawn card position
  const drawnCardPosition = useMemo((): PositionWithPixels => {
    const pos = getDrawnCardPosition();
    const pixelPos = toPixelCoordinates(pos, viewport.width, viewport.height);
    return {
      x: `${pos.x}%`,
      y: `${pos.y}%`,
      xPx: pixelPos.x,
      yPx: pixelPos.y,
    };
  }, [viewport]);
  
  // Get my hand base position
  const myHandPosition = useMemo((): PositionWithPixels => {
    const pos = getMyHandPosition();
    const pixelPos = toPixelCoordinates(pos, viewport.width, viewport.height);
    return {
      x: `${pos.x}%`,
      y: `${pos.y}%`,
      xPx: pixelPos.x,
      yPx: pixelPos.y,
    };
  }, [viewport]);
  
  // Get position for a specific card in a player's hand
  const getPlayerCardPosition = useCallback((
    playerIndex: number,
    cardIndex: number
  ): PositionWithPixels | null => {
    if (playerIndex < 0 || playerIndex >= players.length) return null;
    
    const player = players[playerIndex];
    const isMyHand = playerIndex === myPlayerIndex;
    
    let basePos;
    let rotation = 0;
    
    if (isMyHand) {
      basePos = getMyHandPosition();
    } else {
      // Find which opponent index this is
      let opponentIdx = 0;
      for (let i = 0; i < playerIndex; i++) {
        if (i !== myPlayerIndex) opponentIdx++;
      }
      
      if (opponentIdx < opponentPositions.length) {
        const oppPos = opponentPositions[opponentIdx];
        basePos = { x: oppPos.x, y: oppPos.y };
        rotation = oppPos.rotation;
      } else {
        return null;
      }
    }
    
    const cardPos = getCardInHandPosition(basePos, cardIndex, player.cards.length, isMyHand);
    const pixelPos = toPixelCoordinates(cardPos, viewport.width, viewport.height);
    
    return {
      x: `${cardPos.x}%`,
      y: `${cardPos.y}%`,
      xPx: pixelPos.x,
      yPx: pixelPos.y,
      rotation,
    };
  }, [players, myPlayerIndex, opponentPositions, viewport]);
  
  // Get opponent hand positions with rotation
  const getOpponentHandPositions = useCallback((): Array<{
    playerId: string;
    playerIndex: number;
    position: PositionWithPixels;
    rotation: number;
  }> => {
    const result: Array<{
      playerId: string;
      playerIndex: number;
      position: PositionWithPixels;
      rotation: number;
    }> = [];
    
    let opponentIdx = 0;
    for (let i = 0; i < players.length; i++) {
      if (i === myPlayerIndex) continue;
      
      const oppPos = opponentPositions[opponentIdx];
      if (oppPos) {
        const pixelPos = toPixelCoordinates(oppPos, viewport.width, viewport.height);
        result.push({
          playerId: players[i].id,
          playerIndex: i,
          position: {
            x: `${oppPos.x}%`,
            y: `${oppPos.y}%`,
            xPx: pixelPos.x,
            yPx: pixelPos.y,
          },
          rotation: oppPos.rotation,
        });
      }
      opponentIdx++;
    }
    
    return result;
  }, [players, myPlayerIndex, opponentPositions, viewport]);
  
  // Calculate animation path between two positions
  const getAnimationPath = useCallback((
    sourcePlayerIndex: number,
    sourceCardIndex: number | null,
    targetPlayerIndex: number,
    targetCardIndex: number | null,
    sourceType?: 'deck' | 'discard' | 'drawn' | 'card',
    targetType?: 'deck' | 'discard' | 'card'
  ): { start: PositionWithPixels; end: PositionWithPixels; center: PositionWithPixels } | null => {
    let sourcePos: PositionWithPixels | null = null;
    let targetPos: PositionWithPixels | null = null;
    
    // Get source position
    if (sourceType === 'deck') {
      sourcePos = deckPosition;
    } else if (sourceType === 'discard') {
      sourcePos = discardPosition;
    } else if (sourceType === 'drawn') {
      sourcePos = drawnCardPosition;
    } else if (sourceCardIndex !== null) {
      sourcePos = getPlayerCardPosition(sourcePlayerIndex, sourceCardIndex);
    }
    
    // Get target position
    if (targetType === 'deck') {
      targetPos = deckPosition;
    } else if (targetType === 'discard') {
      targetPos = discardPosition;
    } else if (targetCardIndex !== null) {
      targetPos = getPlayerCardPosition(targetPlayerIndex, targetCardIndex);
    }
    
    if (!sourcePos || !targetPos) return null;
    
    // Center position for animations that go through the middle
    const centerPos: PositionWithPixels = {
      x: '50%',
      y: '50%',
      xPx: viewport.width / 2,
      yPx: viewport.height / 2,
    };
    
    return {
      start: sourcePos,
      end: targetPos,
      center: centerPos,
    };
  }, [deckPosition, discardPosition, drawnCardPosition, getPlayerCardPosition, viewport]);
  
  return {
    viewport,
    positionMap,
    getPosition,
    deckPosition,
    discardPosition,
    drawnCardPosition,
    myHandPosition,
    getPlayerCardPosition,
    getOpponentHandPositions,
    getAnimationPath,
    opponentPositions,
    myPlayerIndex,
    CARD_DIMENSIONS,
  };
}

// Export types for external use
export type { PositionWithPixels, CardPosition };


