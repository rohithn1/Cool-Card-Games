'use client';

import { useEffect, useState, useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Card } from './Card';
import { Deck, DiscardPile } from './Card';
import { PlayerHand, OpponentHand } from './PlayerHand';
import { motion, AnimatePresence } from 'framer-motion';
import { getCardPowerUp, PowerUpType } from '@/types/game';

export function GameTable() {
  const {
    game,
    peerId,
    selectedCardIndex,
    showingBottomCards,
    inspectedCard,
    selectCard,
    setInspectedCard,
    viewBottomCards,
    finishViewingCards,
    drawCard,
    swapCard,
    discardCard,
    startPowerUp,
    completePowerUp,
    cancelPowerUp,
    attemptStack,
    callReds,
    endTurn,
  } = useGameStore();

  const [showInstructions, setShowInstructions] = useState(true);

  if (!game) return null;

  const currentPlayer = game.players[game.currentPlayerIndex];
  const isMyTurn = currentPlayer?.id === peerId;
  const myPlayerIndex = game.players.findIndex(p => p.id === peerId);
  const myPlayer = game.players[myPlayerIndex];

  // Get opponents in order (excluding self)
  const opponents = game.players.filter(p => p.id !== peerId);

  // Handle deck click
  const handleDeckClick = () => {
    if (!isMyTurn || game.turnPhase !== 'draw') return;
    drawCard(false);
  };

  // Handle discard pile click
  const handleDiscardClick = () => {
    if (game.turnPhase === 'draw' && isMyTurn) {
      // Draw from discard
      drawCard(true);
    } else if (game.turnPhase === 'decide' && isMyTurn) {
      // Discard drawn card
      discardCard();
    } else if (selectedCardIndex !== null && game.phase === 'playing') {
      // Attempt to stack
      attemptStack(selectedCardIndex);
      selectCard(null);
    }
  };

  // Handle my card click
  const handleMyCardClick = (index: number) => {
    if (game.phase === 'viewing_cards') {
      // Just viewing
      return;
    }

    if (game.turnPhase === 'decide' && isMyTurn) {
      // Swap with drawn card
      swapCard(index);
      return;
    }

    if (game.turnPhase === 'power_up' && game.currentPowerUp) {
      const { type } = game.currentPowerUp;
      
      if (type === 'inspect_own') {
        // Show the card temporarily
        setInspectedCard({
          playerId: peerId!,
          cardIndex: index,
          card: myPlayer.cards[index],
        });
        setTimeout(() => {
          setInspectedCard(null);
          completePowerUp();
        }, 3000);
        return;
      }

      if (type === 'blind_swap' || type === 'inspect_swap') {
        // Select source card for swap
        startPowerUp({
          ...game.currentPowerUp,
          sourceCardIndex: index,
        });
        return;
      }
    }

    // Toggle selection for stacking
    if (selectedCardIndex === index) {
      selectCard(null);
    } else {
      selectCard(index);
    }
  };

  // Handle opponent card click
  const handleOpponentCardClick = (playerId: string, cardIndex: number) => {
    if (game.turnPhase !== 'power_up' || !game.currentPowerUp) {
      // Check if we have a card selected for stacking opponent's card
      if (selectedCardIndex !== null && game.phase === 'playing') {
        attemptStack(selectedCardIndex, playerId, cardIndex);
        selectCard(null);
      }
      return;
    }

    const { type, sourceCardIndex } = game.currentPowerUp;
    const targetPlayer = game.players.find(p => p.id === playerId);

    if (type === 'inspect_other') {
      // Show opponent's card temporarily
      if (targetPlayer) {
        setInspectedCard({
          playerId,
          cardIndex,
          card: targetPlayer.cards[cardIndex],
        });
        setTimeout(() => {
          setInspectedCard(null);
          completePowerUp();
        }, 3000);
      }
      return;
    }

    if (type === 'blind_swap' && sourceCardIndex !== undefined) {
      // Complete blind swap
      completePowerUp(playerId, cardIndex);
      return;
    }

    if (type === 'inspect_swap' && sourceCardIndex !== undefined) {
      // Show card first, then option to swap
      if (targetPlayer) {
        setInspectedCard({
          playerId,
          cardIndex,
          card: targetPlayer.cards[cardIndex],
        });
      }
      return;
    }
  };

  // Handle call reds
  const handleCallReds = () => {
    if (!isMyTurn || game.phase !== 'playing' || game.turnPhase !== 'draw') return;
    callReds();
  };

  // Confirm swap after inspecting
  const handleConfirmSwap = () => {
    if (inspectedCard && game.currentPowerUp?.type === 'inspect_swap') {
      completePowerUp(inspectedCard.playerId, inspectedCard.cardIndex);
    }
  };

  const handleCancelSwap = () => {
    setInspectedCard(null);
    completePowerUp();
  };

  // Get instruction text
  const getInstructionText = () => {
    if (game.phase === 'waiting') {
      return 'Waiting for players to join...';
    }

    if (game.phase === 'viewing_cards') {
      if (showingBottomCards) {
        return 'Memorize your bottom 2 cards! Click "Ready" when done.';
      }
      return 'Waiting for all players to view their cards...';
    }

    if (game.phase === 'game_over') {
      const winner = game.players.find(p => p.id === game.winner);
      return `Game Over! ${winner?.name} wins!`;
    }

    if (game.phase === 'final_round') {
      return `Final round! ${game.finalRoundTurnsRemaining} turns remaining.`;
    }

    if (!isMyTurn) {
      return `${currentPlayer?.name}'s turn...`;
    }

    if (game.turnPhase === 'draw') {
      return 'Click the deck to draw, or click the discard pile to take the top card.';
    }

    if (game.turnPhase === 'decide') {
      return 'Click one of your cards to swap, or click the discard pile to discard.';
    }

    if (game.turnPhase === 'power_up' && game.currentPowerUp) {
      return getPowerUpInstruction(game.currentPowerUp.type);
    }

    return '';
  };

  const getPowerUpInstruction = (type: PowerUpType): string => {
    switch (type) {
      case 'inspect_own':
        return 'Click one of your cards to peek at it.';
      case 'inspect_other':
        return "Click an opponent's card to peek at it.";
      case 'blind_swap':
        return game.currentPowerUp?.sourceCardIndex !== undefined
          ? "Now click an opponent's card to swap with."
          : 'First click one of your cards to swap.';
      case 'inspect_swap':
        return game.currentPowerUp?.sourceCardIndex !== undefined
          ? "Click an opponent's card to inspect and optionally swap."
          : 'First click one of your cards to swap.';
      default:
        return '';
    }
  };

  return (
    <div className="relative w-full h-screen bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 overflow-hidden">
      {/* Felt texture overlay */}
      <div className="absolute inset-0 opacity-30 felt-pattern" />

      {/* Game code display */}
      <div className="absolute top-4 left-4 bg-black/40 backdrop-blur px-4 py-2 rounded-lg">
        <div className="text-emerald-400 text-xs">Game Code</div>
        <div className="text-white font-mono text-xl font-bold tracking-wider">{game.gameCode}</div>
      </div>

      {/* Last action */}
      <AnimatePresence mode="wait">
        <motion.div
          key={game.lastAction}
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur px-6 py-2 rounded-full"
        >
          <div className="text-amber-300 text-sm font-medium">{game.lastAction}</div>
        </motion.div>
      </AnimatePresence>

      {/* Instructions */}
      <AnimatePresence>
        {showInstructions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 bg-emerald-800/90 backdrop-blur px-6 py-3 rounded-xl max-w-md text-center"
          >
            <div className="text-emerald-100 text-sm">{getInstructionText()}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Opponents at top */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 flex gap-8">
        {opponents.map((opponent, idx) => (
          <OpponentHand
            key={opponent.id}
            player={opponent}
            isCurrentPlayer={game.players[game.currentPlayerIndex]?.id === opponent.id}
            position="top"
            onCardClick={(cardIndex) => handleOpponentCardClick(opponent.id, cardIndex)}
            highlightedCardIndex={
              game.turnPhase === 'power_up' && 
              (game.currentPowerUp?.type === 'inspect_other' || 
               game.currentPowerUp?.type === 'blind_swap' ||
               game.currentPowerUp?.type === 'inspect_swap') &&
              game.currentPowerUp?.sourceCardIndex !== undefined
                ? null // Highlight all for selection
                : null
            }
          />
        ))}
      </div>

      {/* Center table area */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-16">
        {/* Deck */}
        <div className="flex flex-col items-center gap-2">
          <Deck
            count={game.deck.length}
            onClick={handleDeckClick}
            disabled={!isMyTurn || game.turnPhase !== 'draw'}
            highlighted={isMyTurn && game.turnPhase === 'draw'}
          />
          <span className="text-emerald-400 text-xs">Deck</span>
        </div>

        {/* Discard pile */}
        <div className="flex flex-col items-center gap-2">
          <DiscardPile
            cards={game.discardPile}
            onClick={handleDiscardClick}
            highlighted={
              (isMyTurn && game.turnPhase === 'draw') ||
              (isMyTurn && game.turnPhase === 'decide') ||
              selectedCardIndex !== null
            }
          />
          <span className="text-emerald-400 text-xs">Discard</span>
        </div>

        {/* Drawn card */}
        <AnimatePresence>
          {game.drawnCard && (
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 180 }}
              className="flex flex-col items-center gap-2"
            >
              <Card card={game.drawnCard} size="lg" />
              <span className="text-amber-400 text-xs font-medium">Drawn Card</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* My hand at bottom */}
      {myPlayer && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <PlayerHand
            player={myPlayer}
            isCurrentPlayer={isMyTurn}
            isMyHand={true}
            selectedCardIndex={selectedCardIndex}
            onCardClick={handleMyCardClick}
            showBottomCards={showingBottomCards}
            position="bottom"
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        {/* Ready button during viewing phase */}
        {game.phase === 'viewing_cards' && showingBottomCards && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={finishViewingCards}
            className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-shadow"
          >
            Ready!
          </motion.button>
        )}

        {/* Call Reds button */}
        {game.phase === 'playing' && isMyTurn && game.turnPhase === 'draw' && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleCallReds}
            className="px-6 py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-shadow"
          >
            Call REDS!
          </motion.button>
        )}

        {/* Skip power-up */}
        {game.turnPhase === 'power_up' && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={cancelPowerUp}
            className="px-6 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-shadow"
          >
            Skip Power-Up
          </motion.button>
        )}
      </div>

      {/* Inspected card modal */}
      <AnimatePresence>
        {inspectedCard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 20 }}
              className="flex flex-col items-center gap-4"
            >
              <div className="text-white text-lg font-medium mb-2">
                {inspectedCard.playerId === peerId ? 'Your card' : "Opponent's card"}
              </div>
              <Card card={{ ...inspectedCard.card, faceUp: true }} size="lg" />
              
              {game.currentPowerUp?.type === 'inspect_swap' && inspectedCard.playerId !== peerId && (
                <div className="flex gap-4 mt-4">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleConfirmSwap}
                    className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl"
                  >
                    Swap Cards
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCancelSwap}
                    className="px-6 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-bold rounded-xl"
                  >
                    Don&apos;t Swap
                  </motion.button>
                </div>
              )}

              {game.currentPowerUp?.type !== 'inspect_swap' && (
                <div className="text-emerald-300 text-sm animate-pulse">
                  Memorizing... (auto-closing)
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game over overlay */}
      <AnimatePresence>
        {game.phase === 'game_over' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="bg-gradient-to-br from-emerald-800 to-emerald-900 p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4"
            >
              <h2 className="text-3xl font-bold text-center text-amber-400 mb-6">
                Game Over!
              </h2>
              
              <div className="space-y-4">
                {game.players
                  .map(p => ({
                    ...p,
                    score: p.cards.reduce((sum, c) => sum + (c.faceUp ? 
                      (c.rank === 'A' ? 1 : 
                       c.rank === 'J' ? 11 : 
                       c.rank === 'Q' ? 12 : 
                       c.rank === 'K' ? (c.suit === 'hearts' || c.suit === 'diamonds' ? -2 : 13) : 
                       parseInt(c.rank)) : 0), 0),
                  }))
                  .sort((a, b) => a.score - b.score)
                  .map((player, idx) => (
                    <motion.div
                      key={player.id}
                      initial={{ x: -50, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: idx * 0.1 }}
                      className={`
                        flex items-center justify-between p-4 rounded-xl
                        ${idx === 0 ? 'bg-amber-500/30 ring-2 ring-amber-400' : 'bg-white/10'}
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`
                          w-8 h-8 rounded-full flex items-center justify-center font-bold
                          ${idx === 0 ? 'bg-amber-500 text-amber-950' : 'bg-emerald-700 text-emerald-200'}
                        `}>
                          {idx + 1}
                        </span>
                        <span className="text-white font-medium">
                          {player.name}
                          {player.hasCalledReds && <span className="ml-2 text-red-400">(Called Reds)</span>}
                        </span>
                      </div>
                      <span className={`text-2xl font-bold ${idx === 0 ? 'text-amber-400' : 'text-emerald-300'}`}>
                        {player.score}
                      </span>
                    </motion.div>
                  ))}
              </div>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => window.location.reload()}
                className="w-full mt-6 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl shadow-lg"
              >
                Play Again
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

