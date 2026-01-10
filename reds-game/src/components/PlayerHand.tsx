'use client';

import { Card } from './Card';
import { Card as CardType, Player } from '@/types/game';
import { motion } from 'framer-motion';
import { getCardValue } from '@/types/game';

interface PlayerHandProps {
  player: Player;
  isCurrentPlayer: boolean;
  isMyHand: boolean;
  selectedCardIndex: number | null;
  onCardClick?: (index: number) => void;
  showBottomCards?: boolean;
  highlightedCardIndex?: number | null;
  position: 'bottom' | 'top' | 'left' | 'right';
}

export function PlayerHand({
  player,
  isCurrentPlayer,
  isMyHand,
  selectedCardIndex,
  onCardClick,
  showBottomCards = false,
  highlightedCardIndex,
  position,
}: PlayerHandProps) {
  const isHorizontal = position === 'top' || position === 'bottom';
  
  // For viewing phase, show bottom 2 cards (indices 2 and 3 if cards are dealt in rows)
  // We'll treat indices 2 and 3 as the "bottom" cards
  const bottomCardIndices = [2, 3];
  
  const containerClasses = {
    bottom: 'flex-row gap-2 items-end',
    top: 'flex-row gap-2 items-start',
    left: 'flex-col gap-2 items-start',
    right: 'flex-col gap-2 items-end',
  };

  const totalScore = player.cards.every(c => c.faceUp) 
    ? player.cards.reduce((sum, card) => sum + getCardValue(card), 0)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: position === 'bottom' ? 50 : position === 'top' ? -50 : 0 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col items-center gap-2`}
    >
      {/* Player name and status */}
      <div className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full
        ${isCurrentPlayer ? 'bg-yellow-500/90 text-yellow-950' : 'bg-emerald-800/80 text-emerald-100'}
        ${player.hasCalledReds ? 'ring-2 ring-red-500' : ''}
      `}>
        <span className="font-semibold text-sm">{player.name}</span>
        {isMyHand && <span className="text-xs opacity-70">(You)</span>}
        {player.hasCalledReds && <span className="text-xs font-bold text-red-600">REDS!</span>}
        {totalScore !== null && (
          <span className="font-bold ml-1">{totalScore} pts</span>
        )}
      </div>

      {/* Cards */}
      <div className={`flex ${containerClasses[position]}`}>
        {player.cards.map((card, index) => {
          const shouldShowCard = isMyHand && (
            card.faceUp || 
            (showBottomCards && bottomCardIndices.includes(index))
          );
          
          return (
            <motion.div
              key={card.id}
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card
                card={card}
                showPeek={shouldShowCard && !card.faceUp}
                onClick={onCardClick ? () => onCardClick(index) : undefined}
                selected={selectedCardIndex === index}
                highlighted={highlightedCardIndex === index}
                size={isMyHand ? 'lg' : 'md'}
                disabled={!isMyHand && !onCardClick}
              />
            </motion.div>
          );
        })}
      </div>

      {/* Card count indicator */}
      <div className="text-xs text-emerald-400 opacity-70">
        {player.cards.length} cards
      </div>
    </motion.div>
  );
}

// Simplified hand for opponents at top/sides
export function OpponentHand({
  player,
  isCurrentPlayer,
  onCardClick,
  highlightedCardIndex,
  position,
}: {
  player: Player;
  isCurrentPlayer: boolean;
  onCardClick?: (index: number) => void;
  highlightedCardIndex?: number | null;
  position: 'top' | 'left' | 'right';
}) {
  const totalScore = player.cards.every(c => c.faceUp) 
    ? player.cards.reduce((sum, card) => sum + getCardValue(card), 0)
    : null;

  return (
    <div className={`flex flex-col items-center gap-1.5`}>
      {/* Player name */}
      <div className={`
        flex items-center gap-2 px-2 py-1 rounded-full text-xs
        ${isCurrentPlayer ? 'bg-yellow-500/90 text-yellow-950' : 'bg-emerald-800/80 text-emerald-100'}
        ${player.hasCalledReds ? 'ring-2 ring-red-500' : ''}
      `}>
        <span className="font-semibold">{player.name}</span>
        {player.hasCalledReds && <span className="font-bold text-red-600">REDS!</span>}
        {totalScore !== null && (
          <span className="font-bold ml-1">{totalScore}</span>
        )}
      </div>

      {/* Compact card display */}
      <div className={`flex ${position === 'top' ? 'flex-row' : 'flex-col'} gap-1`}>
        {player.cards.map((card, index) => (
          <Card
            key={card.id}
            card={card}
            onClick={onCardClick ? () => onCardClick(index) : undefined}
            highlighted={highlightedCardIndex === index}
            size="sm"
          />
        ))}
      </div>
    </div>
  );
}

