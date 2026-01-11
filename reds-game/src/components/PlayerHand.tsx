'use client';

import { Card } from './Card';
import { Card as CardType, Player } from '@/types/game';
import { motion, AnimatePresence } from 'framer-motion';
import { getCardValue } from '@/types/game';
import { useState, useEffect } from 'react';

// Hook to detect screen size for responsive card sizing
function useResponsiveCardSize(): 'xs' | 'sm' | 'md' {
  const [size, setSize] = useState<'xs' | 'sm' | 'md'>('md');
  
  useEffect(() => {
    const updateSize = () => {
      const width = window.innerWidth;
      if (width < 400) {
        setSize('xs');
      } else if (width < 640) {
        setSize('sm');
      } else {
        setSize('md');
      }
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);
  
  return size;
}

interface PlayerHandProps {
  player: Player;
  isCurrentPlayer: boolean;
  isMyHand: boolean;
  selectedCardIndex: number | null;
  onCardClick?: (index: number) => void;
  showBottomCards?: boolean;
  highlightedCardIndex?: number | null;
  position: 'bottom' | 'top' | 'left' | 'right';
  powerUpHighlight?: 'selectable' | undefined;
  powerUpSelectedIndex?: number | null;
  powerUpConfirmed?: boolean;
  inspectingCardIndex?: number | null;
  isInspectingMyCard?: boolean;
  revealingSwapCardIndex?: number | null; // For inspect_swap (10) revealing phase
  hiddenCardIndex?: number | null; // Card being animated (hidden during swap)
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
  powerUpHighlight,
  powerUpSelectedIndex,
  powerUpConfirmed,
  inspectingCardIndex,
  isInspectingMyCard = false,
  revealingSwapCardIndex,
  hiddenCardIndex,
}: PlayerHandProps) {
  // Responsive card size
  const cardSize = useResponsiveCardSize();
  
  // Cards 0, 1 are top row; 2, 3 are bottom row (for initial 4 cards)
  const bottomCardIndices = [2, 3];

  return (
    <motion.div
      initial={{ opacity: 0, y: position === 'bottom' ? 50 : position === 'top' ? -50 : 0 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col items-center gap-3`}
    >
      {/* Player name and status */}
      <motion.div 
        animate={{ 
          scale: isCurrentPlayer ? [1, 1.02, 1] : 1,
        }}
        transition={{ duration: 1.5, repeat: isCurrentPlayer ? Infinity : 0 }}
        className={`
          flex items-center gap-3 px-4 py-2 rounded-xl
          ${isCurrentPlayer ? 'bg-amber-500 text-amber-950 shadow-lg ring-2 ring-amber-400' : 'bg-emerald-800/80 text-emerald-100'}
          ${player.hasCalledReds ? 'ring-2 ring-red-500' : ''}
          transition-all duration-300
        `}
      >
        <div className="flex flex-col">
          <span className="font-bold text-sm leading-tight">{player.name} {isMyHand && <span className="text-[10px] opacity-70 font-normal">(You)</span>}</span>
        </div>
        {player.hasCalledReds && (
          <span className="text-[10px] px-1.5 py-0.5 bg-red-600 text-white rounded-md font-black animate-pulse">REDS</span>
        )}
      </motion.div>

      {/* Cards - always 2-column grid, adds rows for penalty cards */}
      <div className="grid grid-cols-2 gap-1.5 sm:gap-2 md:gap-3 overflow-visible">
        <AnimatePresence mode="popLayout">
          {player.cards.map((card, index) => {
            const shouldShowCard = isMyHand && (
              card.faceUp || 
              (showBottomCards && bottomCardIndices.includes(index))
            );
            
            // Determine highlight color
            const isPowerUpSelectable = powerUpHighlight === 'selectable';
            const isPowerUpSelected = powerUpSelectedIndex === index;
            const isPowerUpConfirmedCard = isPowerUpSelected && powerUpConfirmed;
            const isBeingInspected = inspectingCardIndex === index;
            const isRevealingSwap = revealingSwapCardIndex === index;
            
            // For inspection: if it's my card being inspected by ME, show face up with flip animation
            // Also flip if this is a revealing swap card
            const showInspectedFace = (isBeingInspected && isInspectingMyCard) || isRevealingSwap;
            const shouldEnlarge = isBeingInspected || isRevealingSwap;
            const isHidden = hiddenCardIndex === index; // Card being animated elsewhere
            
            return (
              <motion.div
                key={card.id}
                data-card-index={index}
                layout
                initial={{ scale: 1, opacity: 1 }}
                animate={{ 
                  // 50% larger when selected for 9/10 power-ups, or when inspecting/revealing
                  scale: isHidden ? 0.8 : shouldEnlarge ? 1.5 : isPowerUpSelected ? 1.5 : 1, 
                  opacity: isHidden ? 0 : 1, // Hide card during swap animation
                  zIndex: shouldEnlarge ? 100 : isPowerUpSelected ? 50 : 1,
                }}
                exit={{ scale: 0, opacity: 0, y: -50 }}
                transition={{ 
                  type: 'spring',
                  stiffness: 150,
                  damping: 20,
                  delay: isHidden ? 0 : index * 0.08 
                }}
                className={`relative ${(isPowerUpSelectable || isBeingInspected) && !isRevealingSwap ? 'cursor-pointer' : ''}`}
                style={{ position: shouldEnlarge || isPowerUpSelected ? 'relative' : undefined }}
              >
                {/* Squeeze-expand flip animation container */}
                <div className="relative">
                  {/* Card back - squeezes out */}
                  <motion.div
                    initial={{ scaleX: 1, opacity: 1 }}
                    animate={{ 
                      scaleX: showInspectedFace ? 0 : 1,
                      opacity: showInspectedFace ? 0 : 1,
                    }}
                    transition={{ duration: 0.3, ease: 'easeIn' }}
                    style={{ transformOrigin: 'center' }}
                    className={showInspectedFace ? 'absolute inset-0' : ''}
                  >
                    {/* Inspection/Reveal highlight ring */}
                    {(isBeingInspected || isRevealingSwap) && !showInspectedFace && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ 
                          opacity: 1, 
                          scale: 1,
                          boxShadow: isRevealingSwap 
                            ? '0 0 30px 10px rgba(34, 197, 94, 0.7)' 
                            : '0 0 30px 10px rgba(251, 191, 36, 0.7)'
                        }}
                        className={`absolute inset-0 rounded-xl pointer-events-none z-10 ${
                          isRevealingSwap ? 'ring-4 ring-green-400' : 'ring-4 ring-amber-400'
                        }`}
                      />
                    )}
                    {/* Power-up highlight ring - GREEN when selected for 9/10 swaps */}
                    {(isPowerUpSelectable || isPowerUpSelected) && !isBeingInspected && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ 
                          opacity: 1, 
                          scale: 1,
                          boxShadow: isPowerUpSelected 
                            ? '0 0 25px 8px rgba(34, 197, 94, 0.7)' 
                            : '0 0 10px 2px rgba(59, 130, 246, 0.4)'
                        }}
                        className={`absolute inset-0 rounded-xl pointer-events-none z-10 ${
                          isPowerUpSelected 
                            ? 'ring-4 ring-green-500' 
                            : 'ring-2 ring-blue-400/50'
                        }`}
                      />
                    )}
                    <Card
                      card={card}
                      showPeek={shouldShowCard && !card.faceUp}
                      onClick={onCardClick && !isRevealingSwap ? () => onCardClick(index) : undefined}
                      selected={selectedCardIndex === index}
                      highlighted={highlightedCardIndex === index}
                      size={cardSize}
                      disabled={(!isMyHand && !onCardClick) || isRevealingSwap}
                    />
                  </motion.div>
                  
                  {/* Card front - expands in */}
                  {showInspectedFace && (
                    <motion.div
                      initial={{ scaleX: 0, opacity: 0 }}
                      animate={{ scaleX: 1, opacity: 1 }}
                      transition={{ duration: 0.3, ease: 'easeOut', delay: 0.3 }}
                      style={{ transformOrigin: 'center' }}
                      className="cursor-pointer"
                    >
                      {/* Inspection/Reveal highlight ring for flipped card */}
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ 
                          opacity: 1, 
                          scale: 1,
                          boxShadow: isRevealingSwap 
                            ? '0 0 30px 10px rgba(34, 197, 94, 0.7)' 
                            : '0 0 30px 10px rgba(251, 191, 36, 0.7)'
                        }}
                        className={`absolute inset-0 rounded-xl pointer-events-none z-10 ${
                          isRevealingSwap ? 'ring-4 ring-green-400' : 'ring-4 ring-amber-400'
                        }`}
                      />
                      <Card
                        card={{ ...card, faceUp: true }}
                        onClick={onCardClick && !isRevealingSwap ? () => onCardClick(index) : undefined}
                        selected={false}
                        highlighted={false}
                        size={cardSize}
                        disabled={isRevealingSwap}
                      />
                    </motion.div>
                  )}
                </div>
                {/* "Inspecting" label */}
                {isBeingInspected && !isRevealingSwap && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-amber-500 text-amber-950 px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap"
                  >
                    👁️ Inspecting
                  </motion.div>
                )}
                {isRevealingSwap && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-green-500 text-green-950 px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap"
                  >
                    🔄 Your Card
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
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
  powerUpHighlight,
  powerUpSelectedIndex,
  powerUpConfirmed,
  inspectingCardIndex,
  isViewerInspecting = false,
  revealingSwapCardIndex,
  isViewerRevealing = false,
  rotationAngle = 0,
  hiddenCardIndex,
}: {
  player: Player;
  isCurrentPlayer: boolean;
  onCardClick?: (index: number) => void;
  highlightedCardIndex?: number | null;
  position: 'top' | 'left' | 'right';
  powerUpHighlight?: 'selectable' | undefined;
  powerUpSelectedIndex?: number | null;
  powerUpConfirmed?: boolean;
  inspectingCardIndex?: number | null;
  isViewerInspecting?: boolean; // True if the current viewer is the one inspecting this card
  revealingSwapCardIndex?: number | null; // For inspect_swap (10) revealing phase
  isViewerRevealing?: boolean; // True if the current viewer is revealing this card for swap
  rotationAngle?: number;
  hiddenCardIndex?: number | null; // Card being animated (hidden during swap/give)
}) {
  // Responsive card size
  const cardSize = useResponsiveCardSize();
  
  // Reorder cards based on rotation - if facing us (180 deg), flip the card order
  // so their bottom cards appear at top from our perspective
  const shouldFlipLayout = Math.abs(rotationAngle || 0) > 90;
  
  // Card display order: flip rows AND columns when rotated to mirror the opponent's view
  // In a 2-column grid:
  // Original: [0,1] [2,3] [4,5] ... (top to bottom rows)
  // Flipped:  [last-1,last] ... [3,2] [1,0] (reversed rows, swapped columns within each row)
  const cardOrder = (() => {
    const totalCards = player.cards.length;
    if (!shouldFlipLayout) {
      // Normal order
      return player.cards.map((_, i) => i);
    }
    
    // For rotated opponents, flip the entire layout
    // Each row pair should be reversed, and rows should be in reverse order
    const totalRows = Math.ceil(totalCards / 2);
    const flippedOrder: number[] = [];
    
    for (let row = totalRows - 1; row >= 0; row--) {
      const leftIdx = row * 2;
      const rightIdx = row * 2 + 1;
      
      // Swap left and right within each row
      if (rightIdx < totalCards) {
        flippedOrder.push(rightIdx);
      }
      flippedOrder.push(leftIdx);
    }
    
    return flippedOrder;
  })();

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex flex-col items-center gap-1.5`}
      style={{ 
        transform: `rotate(${rotationAngle}deg)`,
      }}
    >
      {/* Player name */}
      <motion.div 
        animate={{ 
          scale: isCurrentPlayer ? [1, 1.03, 1] : 1,
        }}
        transition={{ duration: 1.5, repeat: isCurrentPlayer ? Infinity : 0 }}
        className={`
          flex items-center gap-2 px-2 py-1 rounded-full text-xs
          ${isCurrentPlayer ? 'bg-yellow-500/90 text-yellow-950 shadow-md' : 'bg-emerald-800/80 text-emerald-100'}
          ${player.hasCalledReds ? 'ring-2 ring-red-500' : ''}
        `}
        style={{ transform: `rotate(${-rotationAngle}deg)` }} // Counter-rotate name to be readable
      >
        <span className="font-semibold">{player.name}</span>
        {player.hasCalledReds && <span className="font-bold text-red-600">REDS!</span>}
      </motion.div>

      {/* Compact card display - always 2-column grid, adds rows for penalty cards */}
      <div className="grid grid-cols-2 gap-1 sm:gap-1.5 overflow-visible">
        <AnimatePresence mode="popLayout">
          {cardOrder.map((originalIndex) => {
            const card = player.cards[originalIndex];
            if (!card) return null;
            
            // Determine highlight color
            const isPowerUpSelectable = powerUpHighlight === 'selectable';
            const isPowerUpSelected = powerUpSelectedIndex === originalIndex;
            const isPowerUpConfirmedCard = isPowerUpSelected && powerUpConfirmed;
            const isBeingInspected = inspectingCardIndex === originalIndex;
            const isRevealingSwap = revealingSwapCardIndex === originalIndex;
            
            // If I'm the one inspecting/revealing, show the card flipped (face up)
            const showFlippedCard = (isBeingInspected && isViewerInspecting) || (isRevealingSwap && isViewerRevealing);
            const shouldEnlarge = isBeingInspected || isRevealingSwap;
            const isHidden = hiddenCardIndex === originalIndex; // Card being animated elsewhere
            
            return (
              <motion.div
                key={card.id}
                data-card-index={originalIndex}
                layout
                initial={{ scale: 1, opacity: 1 }}
                animate={{ 
                  // 50% larger when selected for 9/10 power-ups, or when inspecting/revealing
                  scale: isHidden ? 0.8 : shouldEnlarge ? 1.5 : isPowerUpSelected ? 1.5 : 1, 
                  opacity: isHidden ? 0 : 1, // Hide card during swap/give animation
                  zIndex: shouldEnlarge ? 100 : isPowerUpSelected ? 50 : 1,
                }}
                exit={{ scale: 0, opacity: 0, y: 30 }}
                transition={{ 
                  type: 'spring',
                  stiffness: 150,
                  damping: 20,
                }}
                whileHover={onCardClick && !isRevealingSwap && !isPowerUpSelected && !isHidden ? { scale: 1.1, y: -5 } : {}}
                className={`relative ${(onCardClick && !isRevealingSwap) || isPowerUpSelectable || isBeingInspected ? 'cursor-pointer' : ''}`}
                style={{ position: shouldEnlarge || isPowerUpSelected ? 'relative' : undefined }}
              >
                {/* Squeeze-expand flip animation container */}
                <div className="relative">
                  {/* Card back - squeezes out */}
                  <motion.div
                    initial={{ scaleX: 1, opacity: 1 }}
                    animate={{ 
                      scaleX: showFlippedCard ? 0 : 1,
                      opacity: showFlippedCard ? 0 : 1,
                    }}
                    transition={{ duration: 0.3, ease: 'easeIn' }}
                    style={{ transformOrigin: 'center' }}
                    className={showFlippedCard ? 'absolute inset-0' : ''}
                  >
                    {/* Inspection/Reveal highlight */}
                    {(isBeingInspected || isRevealingSwap) && !showFlippedCard && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ 
                          opacity: 1, 
                          scale: 1,
                          boxShadow: isRevealingSwap 
                            ? '0 0 25px 8px rgba(34, 197, 94, 0.7)' 
                            : '0 0 25px 8px rgba(251, 191, 36, 0.7)'
                        }}
                        className={`absolute inset-0 rounded-lg pointer-events-none z-10 ${
                          isRevealingSwap ? 'ring-4 ring-green-400' : 'ring-4 ring-amber-400'
                        }`}
                      />
                    )}
                    {/* Power-up highlight ring - GREEN when selected for 9/10 swaps */}
                    {(isPowerUpSelectable || isPowerUpSelected) && !isBeingInspected && !isRevealingSwap && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ 
                          opacity: 1, 
                          scale: 1,
                          boxShadow: isPowerUpSelected 
                            ? '0 0 20px 6px rgba(34, 197, 94, 0.7)' 
                            : '0 0 8px 2px rgba(59, 130, 246, 0.4)'
                        }}
                        className={`absolute inset-0 rounded-lg pointer-events-none z-10 ${
                          isPowerUpSelected 
                            ? 'ring-3 ring-green-500' 
                            : 'ring-2 ring-blue-400/50'
                        }`}
                      />
                    )}
                    <Card
                      key={card.id}
                      card={card}
                      onClick={onCardClick && !isRevealingSwap ? () => onCardClick(originalIndex) : undefined}
                      highlighted={highlightedCardIndex === originalIndex}
                      size={cardSize}
                    />
                  </motion.div>
                  
                  {/* Card front - expands in */}
                  {showFlippedCard && (
                    <motion.div
                      initial={{ scaleX: 0, opacity: 0 }}
                      animate={{ scaleX: 1, opacity: 1 }}
                      transition={{ duration: 0.3, ease: 'easeOut', delay: 0.3 }}
                      style={{ transformOrigin: 'center' }}
                      className="cursor-pointer"
                    >
                      {/* Inspection/Reveal highlight ring for flipped card */}
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ 
                          opacity: 1, 
                          scale: 1,
                          boxShadow: isRevealingSwap 
                            ? '0 0 25px 8px rgba(34, 197, 94, 0.7)' 
                            : '0 0 25px 8px rgba(251, 191, 36, 0.7)'
                        }}
                        className={`absolute inset-0 rounded-lg pointer-events-none z-10 ${
                          isRevealingSwap ? 'ring-4 ring-green-400' : 'ring-4 ring-amber-400'
                        }`}
                      />
                      <Card
                        card={{ ...card, faceUp: true }}
                        onClick={onCardClick && !isRevealingSwap ? () => onCardClick(originalIndex) : undefined}
                        highlighted={false}
                        size={cardSize}
                        disabled={isRevealingSwap}
                      />
                    </motion.div>
                  )}
                </div>
                
                {/* Label for revealing swap */}
                {isRevealingSwap && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-green-500 text-green-950 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
                    style={{ transform: `rotate(${-rotationAngle}deg) translateX(-50%)` }}
                  >
                    🔄 Their Card
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      
    </motion.div>
  );
}

