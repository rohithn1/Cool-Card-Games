'use client';

import { Card as CardType } from '@/types/game';
import { getCardDisplay } from '@/lib/deck';
import { motion } from 'framer-motion';

interface CardProps {
  card: CardType;
  onClick?: () => void;
  selected?: boolean;
  highlighted?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  disabled?: boolean;
  showPeek?: boolean;
}

export function Card({
  card,
  onClick,
  selected = false,
  highlighted = false,
  size = 'md',
  className = '',
  disabled = false,
  showPeek = false,
}: CardProps) {
  const { symbol, color } = getCardDisplay(card);
  
  const sizeClasses = {
    sm: 'w-12 h-16 text-sm',
    md: 'w-16 h-22 text-base',
    lg: 'w-20 h-28 text-lg',
  };

  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

  if (!card.faceUp && !showPeek) {
    // Card back
    return (
      <motion.div
        whileHover={onClick && !disabled ? { scale: 1.05, y: -4 } : {}}
        whileTap={onClick && !disabled ? { scale: 0.98 } : {}}
        onClick={!disabled ? onClick : undefined}
        className={`
          ${sizeClasses[size]}
          rounded-xl
          bg-gradient-to-br from-rose-700 via-red-800 to-rose-900
          border-2 border-rose-600
          shadow-lg
          flex items-center justify-center
          ${onClick && !disabled ? 'cursor-pointer hover:shadow-xl' : ''}
          ${selected ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-emerald-900' : ''}
          ${highlighted ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-emerald-900 animate-pulse' : ''}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${className}
          overflow-hidden
          relative
        `}
      >
        {/* Pattern overlay */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute inset-2 border-2 border-rose-400 rounded-lg" />
          <div className="absolute inset-4 border border-rose-500 rounded" />
        </div>
        
        {/* Center diamond pattern */}
        <div className="text-rose-400 text-2xl font-bold opacity-50">♦</div>
      </motion.div>
    );
  }

  // Card front
  return (
    <motion.div
      whileHover={onClick && !disabled ? { scale: 1.05, y: -4 } : {}}
      whileTap={onClick && !disabled ? { scale: 0.98 } : {}}
      onClick={!disabled ? onClick : undefined}
      className={`
        ${sizeClasses[size]}
        rounded-xl
        bg-gradient-to-br from-white to-gray-100
        border-2 border-gray-300
        shadow-lg
        flex flex-col items-center justify-between
        p-1.5
        ${onClick && !disabled ? 'cursor-pointer hover:shadow-xl' : ''}
        ${selected ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-emerald-900' : ''}
        ${highlighted ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-emerald-900 animate-pulse' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      {/* Top left corner */}
      <div className={`self-start ${isRed ? 'text-red-600' : 'text-gray-900'} leading-none`}>
        <div className="text-sm font-bold">{card.rank}</div>
        <div className="text-xs">{symbol}</div>
      </div>
      
      {/* Center */}
      <div className={`text-2xl ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
        {symbol}
      </div>
      
      {/* Bottom right corner (rotated) */}
      <div className={`self-end rotate-180 ${isRed ? 'text-red-600' : 'text-gray-900'} leading-none`}>
        <div className="text-sm font-bold">{card.rank}</div>
        <div className="text-xs">{symbol}</div>
      </div>
    </motion.div>
  );
}

// Deck component (face down pile)
export function Deck({
  count,
  onClick,
  disabled = false,
  highlighted = false,
}: {
  count: number;
  onClick?: () => void;
  disabled?: boolean;
  highlighted?: boolean;
}) {
  return (
    <motion.div
      whileHover={onClick && !disabled ? { scale: 1.03 } : {}}
      whileTap={onClick && !disabled ? { scale: 0.98 } : {}}
      onClick={!disabled ? onClick : undefined}
      className={`
        relative w-20 h-28 
        ${onClick && !disabled ? 'cursor-pointer' : ''}
        ${highlighted ? 'animate-pulse' : ''}
      `}
    >
      {/* Stacked cards effect */}
      {[...Array(Math.min(5, count))].map((_, i) => (
        <div
          key={i}
          className={`
            absolute w-full h-full
            rounded-xl
            bg-gradient-to-br from-rose-700 via-red-800 to-rose-900
            border-2 border-rose-600
            shadow-lg
            ${highlighted ? 'ring-4 ring-yellow-400' : ''}
          `}
          style={{
            top: -i * 2,
            left: -i * 1,
            zIndex: 5 - i,
          }}
        >
          {i === 0 && (
            <>
              <div className="absolute inset-0 opacity-30">
                <div className="absolute inset-2 border-2 border-rose-400 rounded-lg" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center text-rose-400 text-2xl font-bold opacity-50">
                ♦
              </div>
            </>
          )}
        </div>
      ))}
      
      {/* Card count badge */}
      <div className="absolute -bottom-2 -right-2 bg-amber-500 text-amber-950 rounded-full w-7 h-7 flex items-center justify-center text-xs font-bold shadow-md z-10">
        {count}
      </div>
    </motion.div>
  );
}

// Discard pile component
export function DiscardPile({
  cards,
  onClick,
  disabled = false,
  highlighted = false,
}: {
  cards: CardType[];
  onClick?: () => void;
  disabled?: boolean;
  highlighted?: boolean;
}) {
  if (cards.length === 0) {
    return (
      <motion.div
        whileHover={onClick && !disabled ? { scale: 1.03 } : {}}
        onClick={!disabled ? onClick : undefined}
        className={`
          w-20 h-28 
          rounded-xl 
          border-2 border-dashed border-emerald-600/50
          bg-emerald-800/30
          flex items-center justify-center
          ${onClick && !disabled ? 'cursor-pointer' : ''}
          ${highlighted ? 'ring-4 ring-cyan-400 animate-pulse' : ''}
        `}
      >
        <span className="text-emerald-600/50 text-xs">Discard</span>
      </motion.div>
    );
  }

  const topCard = cards[0];

  return (
    <motion.div
      whileHover={onClick && !disabled ? { scale: 1.03 } : {}}
      whileTap={onClick && !disabled ? { scale: 0.98 } : {}}
      onClick={!disabled ? onClick : undefined}
      className={`
        relative
        ${onClick && !disabled ? 'cursor-pointer' : ''}
      `}
    >
      {/* Show a few cards slightly offset */}
      {cards.slice(0, 3).reverse().map((card, i) => (
        <div
          key={card.id}
          className="absolute"
          style={{
            top: (2 - i) * 3,
            left: (2 - i) * 2,
            zIndex: i,
          }}
        >
          <Card 
            card={{ ...card, faceUp: i === cards.slice(0, 3).length - 1 }} 
            size="lg"
            highlighted={i === cards.slice(0, 3).length - 1 && highlighted}
          />
        </div>
      ))}
      
      {/* Visible top card */}
      <div className="relative z-10" style={{ marginTop: 6, marginLeft: 4 }}>
        <Card 
          card={topCard} 
          size="lg"
          highlighted={highlighted}
        />
      </div>
    </motion.div>
  );
}

