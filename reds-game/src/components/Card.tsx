'use client';

import { Card as CardType } from '@/types/game';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';

interface CardProps {
  card: CardType;
  onClick?: () => void;
  selected?: boolean;
  highlighted?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  disabled?: boolean;
  showPeek?: boolean;
}

// Size configurations - all dimensions scale proportionally
// xs is for mobile screens, sm for small mobile, md for tablets, lg for desktop
const sizeConfig = {
  xs: {
    width: 'w-10',
    height: 'h-14',
    cornerRank: 'text-[8px]',
    cornerSymbol: 'text-[6px]',
    centerSymbol: 'text-xl',
    jokerLetter: 'text-[4px]',
    jokerCenter: 'text-lg',
    cornerOffset: 'top-0.5 left-0.5',
    border: 'border',
  },
  sm: {
    width: 'w-12',
    height: 'h-16',
    cornerRank: 'text-[10px]',
    cornerSymbol: 'text-[8px]',
    centerSymbol: 'text-2xl',
    jokerLetter: 'text-[5px]',
    jokerCenter: 'text-xl',
    cornerOffset: 'top-0.5 left-1',
    border: 'border',
  },
  md: {
    width: 'w-14',
    height: 'h-20',
    cornerRank: 'text-[11px]',
    cornerSymbol: 'text-[9px]',
    centerSymbol: 'text-2xl',
    jokerLetter: 'text-[5px]',
    jokerCenter: 'text-xl',
    cornerOffset: 'top-0.5 left-1',
    border: 'border',
  },
  lg: {
    width: 'w-16',
    height: 'h-22',
    cornerRank: 'text-xs',
    cornerSymbol: 'text-[10px]',
    centerSymbol: 'text-3xl',
    jokerLetter: 'text-[6px]',
    jokerCenter: 'text-2xl',
    cornerOffset: 'top-0.5 left-1',
    border: 'border-2',
  },
  xl: {
    width: 'w-20',
    height: 'h-28',
    cornerRank: 'text-sm',
    cornerSymbol: 'text-xs',
    centerSymbol: 'text-5xl',
    jokerLetter: 'text-[8px]',
    jokerCenter: 'text-3xl',
    cornerOffset: 'top-1 left-1.5',
    border: 'border-2',
  },
};

// Get suit symbol
function getSuitSymbol(suit: string): string {
  const symbols: Record<string, string> = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠',
  };
  return symbols[suit] || '?';
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
  const config = sizeConfig[size];
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const isJoker = card.rank === 'JOKER';
  const symbol = getSuitSymbol(card.suit);
  const color = isRed ? 'text-red-600' : 'text-gray-900';

  // Card back
  if (!card.faceUp && !showPeek) {
    return (
      <motion.div
        whileHover={onClick && !disabled ? { scale: 1.05, y: -4 } : {}}
        whileTap={onClick && !disabled ? { scale: 0.98 } : {}}
        onClick={!disabled ? onClick : undefined}
        className={`
          ${config.width} ${config.height}
          rounded-xl shadow-lg overflow-hidden relative
          ${onClick && !disabled ? 'cursor-pointer hover:shadow-xl' : ''}
          ${selected ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-emerald-900' : ''}
          ${highlighted ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-emerald-900 animate-pulse' : ''}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${className}
        `}
      >
        <Image
          src="/card-back.png"
          alt="Card back"
          fill
          className="object-cover rounded-xl"
          sizes="(max-width: 768px) 80px, 96px"
          priority
        />
      </motion.div>
    );
  }

  // Joker card
  if (isJoker) {
    return (
      <motion.div
        whileHover={onClick && !disabled ? { scale: 1.05, y: -4 } : {}}
        whileTap={onClick && !disabled ? { scale: 0.98 } : {}}
        onClick={!disabled ? onClick : undefined}
        className={`
          ${config.width} ${config.height}
          rounded-xl shadow-lg overflow-hidden relative
          bg-gradient-to-br from-purple-100 via-white to-violet-100
          ${config.border} border-purple-400
          ${onClick && !disabled ? 'cursor-pointer hover:shadow-xl' : ''}
          ${selected ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-emerald-900' : ''}
          ${highlighted ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-emerald-900 animate-pulse' : ''}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${className}
        `}
      >
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'repeating-linear-gradient(45deg, #7c3aed 0, #7c3aed 1px, transparent 0, transparent 50%)',
          backgroundSize: '6px 6px',
        }} />

        {/* Top left JOKER vertical */}
        <div className="absolute top-1 left-1 flex flex-col items-center leading-none">
          {'JOKER'.split('').map((letter, i) => (
            <span key={i} className={`text-purple-700 font-black ${config.jokerLetter}`}>{letter}</span>
          ))}
        </div>

        {/* Center */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`${config.jokerCenter}`}>🃏</span>
        </div>

        {/* Bottom right JOKER vertical (rotated) */}
        <div className="absolute bottom-1 right-1 flex flex-col items-center leading-none rotate-180">
          {'JOKER'.split('').map((letter, i) => (
            <span key={i} className={`text-purple-700 font-black ${config.jokerLetter}`}>{letter}</span>
          ))}
        </div>
      </motion.div>
    );
  }

  // Standard card (A, 2-10, J, Q, K) - simplified layout
  return (
    <motion.div
      whileHover={onClick && !disabled ? { scale: 1.05, y: -4 } : {}}
      whileTap={onClick && !disabled ? { scale: 0.98 } : {}}
      onClick={!disabled ? onClick : undefined}
      className={`
        ${config.width} ${config.height}
        rounded-xl shadow-lg overflow-hidden relative
        bg-gradient-to-br from-white via-gray-50 to-white
        ${config.border} ${isRed ? 'border-red-200' : 'border-gray-300'}
        ${onClick && !disabled ? 'cursor-pointer hover:shadow-xl' : ''}
        ${selected ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-emerald-900' : ''}
        ${highlighted ? 'ring-4 ring-cyan-400 ring-offset-2 ring-offset-emerald-900 animate-pulse' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      {/* Top left corner - rank + suit */}
      <div className={`absolute ${config.cornerOffset} ${color} leading-none text-center`}>
        <div className={`${config.cornerRank} font-bold`}>{card.rank}</div>
        <div className={config.cornerSymbol}>{symbol}</div>
      </div>

      {/* Large center suit symbol */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`${config.centerSymbol} ${color}`}>{symbol}</span>
      </div>

      {/* Bottom right corner - rank + suit (rotated 180°) */}
      <div className={`absolute bottom-1 right-1.5 rotate-180 ${color} leading-none text-center`}>
        <div className={`${config.cornerRank} font-bold`}>{card.rank}</div>
        <div className={config.cornerSymbol}>{symbol}</div>
      </div>
    </motion.div>
  );
}

// Deck component (face down pile) with animation - responsive sizing
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
      whileTap={onClick && !disabled ? { scale: 0.95 } : {}}
      onClick={!disabled ? onClick : undefined}
      className={`relative w-14 h-20 sm:w-16 sm:h-22 md:w-20 md:h-28 ${onClick && !disabled ? 'cursor-pointer' : ''}`}
    >
      <AnimatePresence>
        {[...Array(Math.min(5, count))].map((_, i) => (
          <motion.div
            key={`deck-card-${count}-${i}`}
            initial={i === 0 ? { y: -20, opacity: 0 } : {}}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0, rotateZ: 5 }}
            transition={{ duration: 0.2 }}
            className={`
              absolute w-full h-full rounded-lg sm:rounded-xl shadow-lg overflow-hidden
              ${highlighted && i === 0 ? 'ring-2 sm:ring-4 ring-yellow-400 shadow-yellow-400/30' : ''}
            `}
            style={{ top: -i * 1.5, left: -i * 0.5, zIndex: 5 - i }}
          >
            <Image
              src="/card-back.png"
              alt="Card back"
              fill
              className="object-cover rounded-lg sm:rounded-xl"
              sizes="(max-width: 640px) 56px, 80px"
              priority={i === 0}
            />
          </motion.div>
        ))}
      </AnimatePresence>
      
      <motion.div 
        key={count}
        initial={{ scale: 1.2 }}
        animate={{ scale: 1 }}
        className="absolute -bottom-1.5 -right-1.5 sm:-bottom-2 sm:-right-2 bg-amber-500 text-amber-950 rounded-full w-5 h-5 sm:w-7 sm:h-7 flex items-center justify-center text-[10px] sm:text-xs font-bold shadow-md z-10"
      >
        {count}
      </motion.div>
    </motion.div>
  );
}

// Discard pile component with animation - responsive sizing
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
          w-14 h-20 sm:w-16 sm:h-22 md:w-20 md:h-28 rounded-lg sm:rounded-xl border-2 border-dashed border-emerald-600/50
          bg-emerald-800/30 flex items-center justify-center
          ${onClick && !disabled ? 'cursor-pointer' : ''}
          ${highlighted ? 'ring-2 sm:ring-4 ring-cyan-400 animate-pulse' : ''}
        `}
      >
        <span className="text-emerald-600/50 text-[10px] sm:text-xs">Discard</span>
      </motion.div>
    );
  }

  const topCard = cards[0];

  return (
    <motion.div
      whileHover={onClick && !disabled ? { scale: 1.03 } : {}}
      whileTap={onClick && !disabled ? { scale: 0.98 } : {}}
      onClick={!disabled ? onClick : undefined}
      className={`relative ${onClick && !disabled ? 'cursor-pointer' : ''}`}
    >
      {cards.slice(1, 4).reverse().map((card, i) => (
        <div
          key={card.id}
          className="absolute"
          style={{ top: (2 - i) * 2, left: (2 - i) * 1.5, zIndex: i }}
        >
          <Card card={{ ...card, faceUp: false }} size="md" className="sm:hidden" />
          <Card card={{ ...card, faceUp: false }} size="lg" className="hidden sm:block" />
        </div>
      ))}
      
      {/* Top card - no animation, just render statically (movement handled by table overlay) */}
      <div 
        className="relative z-10" 
        style={{ marginTop: 4, marginLeft: 3 }}
      >
        <Card card={topCard} size="md" highlighted={highlighted} className="sm:hidden" />
        <Card card={topCard} size="lg" highlighted={highlighted} className="hidden sm:block" />
      </div>
    </motion.div>
  );
}
