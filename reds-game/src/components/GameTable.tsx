'use client';

import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Card } from './Card';
import { Deck, DiscardPile } from './Card';
import { PlayerHand, OpponentHand } from './PlayerHand';
import { motion, AnimatePresence } from 'framer-motion';
import { getCardPowerUp, PowerUpType, Card as CardType } from '@/types/game';
import { getMultiplayerConnection } from '@/lib/multiplayer';

// Animation for cards moving (slower for visibility)
const cardMoveAnimation = {
  initial: { scale: 0.8, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.8, opacity: 0 },
  transition: { type: 'spring', stiffness: 200, damping: 20, duration: 0.5 }
};

// Animation timing constants (in ms)
const ANIMATION_TIMING = {
  draw: 500,
  swap: 1200, // Increased for sequential animations
  discard: 600,
  stack: 800,
  powerUp: 600,
  announcement: 2500,
};

// Helper component to trigger stack animation resolution
function StackAnimationResolver() {
  const { resolveStackAnimation } = useGameStore();
  
  useEffect(() => {
    // Wait for flip animation before resolving
    const timer = setTimeout(() => {
      resolveStackAnimation();
    }, 800);
    
    return () => clearTimeout(timer);
  }, [resolveStackAnimation]);
  
  return null;
}

// Helper component to clear stack animation after showing result
function StackAnimationClearer() {
  const { clearStackAnimation } = useGameStore();
  
  useEffect(() => {
    // Show result for 2 seconds then clear
    const timer = setTimeout(() => {
      clearStackAnimation();
    }, 2000);
    
    return () => clearTimeout(timer);
  }, [clearStackAnimation]);
  
  return null;
}

export function GameTable() {
  const {
    game,
    peerId,
    isHost,
    selectedCardIndex,
    inspectedCard,
    selectCard,
    setInspectedCard,
    drawCard,
    swapCard,
    discardCard,
    startPowerUp,
    usePowerUp,
    skipPowerUp,
    completePowerUp,
    cancelPowerUp,
    attemptStack,
    callReds,
    markReady,
    startSwapAnimation,
    setSwapSelection,
    clearSwapAnimation,
    clearPenaltyCardDisplay,
    setCardMoveAnimation,
    clearCardMoveAnimation,
  } = useGameStore();

  const [showInstructions, setShowInstructions] = useState(true);
  const [drawAnimation, setDrawAnimation] = useState<'deck' | 'discard' | null>(null);
  const [drawnCardSource, setDrawnCardSource] = useState<'deck' | 'discard' | null>(null);
  const [swapAnimation, setSwapAnimation] = useState<{ cardIndex: number; card: CardType } | null>(null);
  const [discardAnimation, setDiscardAnimation] = useState<CardType | null>(null);
  const [flyingCard, setFlyingCard] = useState<{ card: CardType; fromTop: boolean } | null>(null);
  
  // Card movement animation - persists card data for smooth animations after state change
  const [cardMoveAnim, setCardMoveAnim] = useState<{
    type: 'discard_drawn' | 'swap_cards' | null;
    drawnCard: CardType | null;
    handCard: CardType | null;
    handIndex: number | null;
    startTime: number;
  }>({ type: null, drawnCard: null, handCard: null, handIndex: null, startTime: 0 });
  
  // Action announcement overlay
  const [actionAnnouncement, setActionAnnouncement] = useState<{
    type: 'swap' | 'stack' | 'discard' | 'draw';
    playerName: string;
    card?: CardType;
  } | null>(null);
  
  // Flying cards for visual feedback
  const [flyingCards, setFlyingCards] = useState<{
    id: string;
    card: CardType;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  }[]>([]);
  
  // Power-up swap animation state
  const [powerUpSwapAnim, setPowerUpSwapAnim] = useState<{
    myCardIndex: number | null;
    opponentId: string | null;
    opponentCardIndex: number | null;
    // For _others power-ups (selecting two opponents)
    secondOpponentId: string | null;
    secondOpponentCardIndex: number | null;
    phase: 'idle' | 'selecting' | 'confirmed' | 'animating' | 'revealing';
    myCard?: CardType | null;
    opponentCard?: CardType | null;
    secondOpponentCard?: CardType | null;
  }>({
    myCardIndex: null,
    opponentId: null,
    opponentCardIndex: null,
    secondOpponentId: null,
    secondOpponentCardIndex: null,
    phase: 'idle',
  });
  
  // Power-up usage notification (shows to all players)
  const [powerUpNotification, setPowerUpNotification] = useState<{
    playerName: string;
    action: 'used' | 'skipped';
    powerUpType: PowerUpType;
  } | null>(null);
  
  // Triple-click tracking for stacking
  const clickCountRef = useRef<{ [key: string]: { count: number; timer: NodeJS.Timeout | null; lastClickTime?: number } }>({});
  const TRIPLE_CLICK_WINDOW = 700; // ms to register triple click (slightly slower)

  // Prevent double-select while stack-give is being processed/broadcast
  const isGivingCardRef = useRef(false);
  
  // Track last action for animations
  const lastActionRef = useRef<string>('');
  
  // Detect game actions and show announcements
  useEffect(() => {
    if (!game || game.lastAction === lastActionRef.current) return;
    
    const action = game.lastAction;
    lastActionRef.current = action;
    
    // Parse the action to show appropriate animation
    // Note: Swap animations are handled separately via swapAnimation state, no popup needed
    if (action.includes('stacked')) {
      const playerName = action.split(' stacked')[0];
      setActionAnnouncement({ type: 'stack', playerName });
      setTimeout(() => setActionAnnouncement(null), ANIMATION_TIMING.announcement);
    } else if (action.includes('discarded')) {
      const playerName = action.split(' discarded')[0];
      setActionAnnouncement({ type: 'discard', playerName });
      setTimeout(() => setActionAnnouncement(null), ANIMATION_TIMING.announcement);
    } else if (action.includes('drew')) {
      const playerName = action.split(' drew')[0];
      setActionAnnouncement({ type: 'draw', playerName });
      setTimeout(() => setActionAnnouncement(null), ANIMATION_TIMING.announcement);
    }
  }, [game?.lastAction]);
  
  // Reset power-up swap animation when turn phase changes
  useEffect(() => {
    if (game?.turnPhase !== 'power_up') {
      setPowerUpSwapAnim({
        myCardIndex: null,
        opponentId: null,
        opponentCardIndex: null,
        secondOpponentId: null,
        secondOpponentCardIndex: null,
        phase: 'selecting',
      });
    }
  }, [game?.turnPhase]);
  
  // Detect power-up usage/skip and show notification
  const lastPowerUpActionRef = useRef<string>('');
  useEffect(() => {
    if (!game) return;
    
    const action = game.lastAction;
    if (action === lastPowerUpActionRef.current) return;
    lastPowerUpActionRef.current = action;
    
    // Detect power-up used
    if (action.includes('used') && (action.includes('7') || action.includes('8') || action.includes('9') || action.includes('10'))) {
      const playerName = action.split(' used')[0];
      let powerUpType: PowerUpType = 'inspect_own';
      if (action.includes('7')) powerUpType = 'inspect_own';
      else if (action.includes('8')) powerUpType = 'inspect_other';
      else if (action.includes('9')) powerUpType = 'blind_swap';
      else if (action.includes('10')) powerUpType = 'inspect_swap';
      
      setPowerUpNotification({ playerName, action: 'used', powerUpType });
      setTimeout(() => setPowerUpNotification(null), ANIMATION_TIMING.announcement);
    }
    
    // Detect power-up skipped
    if (action.includes('skipped')) {
      const playerName = action.split(' skipped')[0];
      setPowerUpNotification({ playerName, action: 'skipped', powerUpType: 'inspect_own' });
      setTimeout(() => setPowerUpNotification(null), ANIMATION_TIMING.announcement);
    }
  }, [game?.lastAction]);

  if (!game) return null;

  const currentPlayer = game.players[game.currentPlayerIndex];
  const isMyTurn = currentPlayer?.id === peerId;
  const myPlayerIndex = game.players.findIndex(p => p.id === peerId);
  const myPlayer = game.players[myPlayerIndex];
  
  const isViewingMyCards = myPlayer && !myPlayer.hasSeenBottomCards;
  const allPlayersReady = game.players.every(p => p.hasSeenBottomCards);
  const gameIsActive = game.phase === 'playing' || game.phase === 'final_round';

  const opponents = game.players.filter(p => p.id !== peerId);

  // Triple-click handler for stacking
  const handleTripleClick = (cardKey: string, onTripleClick: () => void) => {
    const now = Date.now();
    
    if (!clickCountRef.current[cardKey]) {
      clickCountRef.current[cardKey] = { count: 0, timer: null };
    }
    
    const clickData = clickCountRef.current[cardKey];
    
    // Clear existing timer
    if (clickData.timer) {
      clearTimeout(clickData.timer);
    }
    
    // Increment click count
    clickData.count++;
    
    // Check for triple click
    if (clickData.count >= 3) {
      clickData.count = 0;
      onTripleClick();
      return;
    }
    
    // Set timer to reset count
    clickData.timer = setTimeout(() => {
      clickData.count = 0;
    }, TRIPLE_CLICK_WINDOW);
  };

  // Handle deck click - always draws from deck (if it's your turn to draw)
  const handleDeckClick = () => {
    if (!allPlayersReady) return;
    if (!isMyTurn || game.turnPhase !== 'draw') return;
    
    // Set animation in game state so all players see it
    setCardMoveAnimation({
      type: 'draw_deck',
      playerId: peerId!,
      playerName: myPlayer?.name || 'Player',
      drawnCard: null, // Card is unknown until drawn
      discardedCard: null,
      handIndex: null,
      startedAt: Date.now(),
    });
    setDrawAnimation('deck');
    setDrawnCardSource('deck');
    setTimeout(() => {
      drawCard(false);
      setDrawAnimation(null);
      clearCardMoveAnimation();
    }, ANIMATION_TIMING.draw);
  };

  // Handle discard pile click
  const handleDiscardClick = () => {
    if (!allPlayersReady) return;
    
    // If it's my turn and I'm in draw phase → draw from discard
    if (game.turnPhase === 'draw' && isMyTurn) {
      // Set animation in game state so all players see it
      setCardMoveAnimation({
        type: 'draw_discard',
        playerId: peerId!,
        playerName: myPlayer?.name || 'Player',
        drawnCard: game.discardPile[0] ? { ...game.discardPile[0], faceUp: true } : null,
        discardedCard: null,
        handIndex: null,
        startedAt: Date.now(),
      });
      setDrawAnimation('discard');
      setDrawnCardSource('discard');
      setTimeout(() => {
        drawCard(true);
        setDrawAnimation(null);
        clearCardMoveAnimation();
      }, ANIMATION_TIMING.draw);
      return;
    }
    
    // If it's my turn and I'm in decide phase → only allow discard if card came from DECK
    // Cards from discard pile MUST be swapped with one of your cards
    if (game.turnPhase === 'decide' && isMyTurn && drawnCardSource !== 'discard') {
      if (game.drawnCard) {
        // Set animation in game state so all players see it
        setCardMoveAnimation({
          type: 'discard',
          playerId: peerId!,
          playerName: myPlayer?.name || 'Player',
          drawnCard: { ...game.drawnCard, faceUp: true },
          discardedCard: { ...game.drawnCard, faceUp: true },
          handIndex: null,
          startedAt: Date.now(),
        });
        // Also keep local state for backward compatibility
        setCardMoveAnim({
          type: 'discard_drawn',
          drawnCard: { ...game.drawnCard },
          handCard: null,
          handIndex: null,
          startTime: Date.now(),
        });
        setDiscardAnimation(game.drawnCard);
        setDrawnCardSource(null);
        setTimeout(() => {
          discardCard();
          setDiscardAnimation(null);
          clearCardMoveAnimation();
          // Clear animation after it completes
          setTimeout(() => {
            setCardMoveAnim({ type: null, drawnCard: null, handCard: null, handIndex: null, startTime: 0 });
          }, 400);
        }, ANIMATION_TIMING.discard);
      }
      return;
    }
  };

  // Handle my card click
  const handleMyCardClick = (index: number) => {
    if (!allPlayersReady) return;
    
    if (game.phase === 'viewing_cards') return;

    // CARD GIVE MODE: If we just stacked an opponent's card, select which card to give them
    if (game.stackAnimation?.result?.awaitingCardGive && game.stackAnimation.result.stackerId === peerId) {
      if (isGivingCardRef.current) return;
      isGivingCardRef.current = true;
      const { completeStackGive } = useGameStore.getState();
      completeStackGive(index);
      return;
    }

    // Triple-click detection FIRST - for stacking
    const isCardBeingInspected = inspectedCard?.playerId === peerId && inspectedCard?.cardIndex === index;
    if (gameIsActive && !isCardBeingInspected) {
      const cardKey = `my-${index}`;
      const now = Date.now();
      
      if (!clickCountRef.current[cardKey]) {
        clickCountRef.current[cardKey] = { count: 0, timer: null, lastClickTime: 0 };
      }
      
      const clickData = clickCountRef.current[cardKey];
      const timeSinceLastClick = now - (clickData.lastClickTime || 0);
      
      // If clicks are happening fast (within 400ms), count them
      if (timeSinceLastClick < 400) {
        clickData.count++;
      } else {
        clickData.count = 1;
      }
      clickData.lastClickTime = now;
      
      // If triple click detected, attempt stack
      if (clickData.count >= 3) {
        clickData.count = 0;
        attemptStack(index);
        // After stack, player can still use power-up by clicking again
        return;
      }
    }

    // If I have a drawn card and it's decide phase → swap
    if (game.turnPhase === 'decide' && isMyTurn && game.drawnCard) {
      const oldCard = myPlayer.cards[index];
      // Set animation in game state so all players see it
      setCardMoveAnimation({
        type: 'swap',
        playerId: peerId!,
        playerName: myPlayer?.name || 'Player',
        drawnCard: { ...game.drawnCard, faceUp: false }, // Face down for others
        discardedCard: { ...oldCard, faceUp: true }, // This card goes to discard
        handIndex: index,
        startedAt: Date.now(),
      });
      // Store card data for animation BEFORE state change
      setCardMoveAnim({
        type: 'swap_cards',
        drawnCard: { ...game.drawnCard },
        handCard: { ...oldCard },
        handIndex: index,
        startTime: Date.now(),
      });
      setSwapAnimation({ cardIndex: index, card: oldCard });
      setTimeout(() => {
        swapCard(index);
        setSwapAnimation(null);
        clearCardMoveAnimation();
        // Clear animation after it completes
        setTimeout(() => {
          setCardMoveAnim({ type: null, drawnCard: null, handCard: null, handIndex: null, startTime: 0 });
        }, 400);
      }, ANIMATION_TIMING.swap);
      return;
    }

    // Power-up handling (only runs if not a triple-click)
    if (game.turnPhase === 'power_up' && game.currentPowerUp && isMyTurn) {
      const { type } = game.currentPowerUp;
      
      if (type === 'inspect_own') {
        // Set inspecting card in game state for real-time sync
        const { setInspectingCard } = useGameStore.getState();
        setInspectingCard({ playerId: peerId!, cardIndex: index });
        // Also set local inspectedCard for the flip animation
        setInspectedCard({
          playerId: peerId!,
          cardIndex: index,
          card: myPlayer.cards[index],
        });
        return;
      }

      // For blind_swap (9) or inspect_swap (10) - select my card
      if (type === 'blind_swap' || type === 'inspect_swap') {
        // Don't allow re-selection once both cards are selected (phase is confirmed or beyond)
        if (powerUpSwapAnim.phase === 'confirmed' || powerUpSwapAnim.phase === 'animating' || powerUpSwapAnim.phase === 'revealing') {
          return;
        }
        
        setPowerUpSwapAnim(prev => ({
          ...prev,
          myCardIndex: index,
          myCard: myPlayer.cards[index],
          phase: prev.opponentCardIndex !== null ? 'confirmed' : 'selecting',
        }));
        
        // Sync selection to all players
        if (powerUpSwapAnim.opponentId && powerUpSwapAnim.opponentCardIndex !== null) {
          // Both cards selected - sync and execute
          setSwapSelection(powerUpSwapAnim.opponentId, powerUpSwapAnim.opponentCardIndex, index, type);
          executePowerUpSwap(index, powerUpSwapAnim.opponentId, powerUpSwapAnim.opponentCardIndex, type);
        } else {
          // Only my card selected - sync partial selection
          setSwapSelection(null, null, index, type);
        }
        return;
      }
    }
  };

  // Reset local give-guard once the store clears awaitingCardGive
  useEffect(() => {
    if (!game?.stackAnimation?.result?.awaitingCardGive) {
      isGivingCardRef.current = false;
    }
  }, [game?.stackAnimation?.result?.awaitingCardGive]);

  // Auto-clear give animation shortly after it starts (only the initiator clears to avoid races)
  useEffect(() => {
    if (!game?.cardMoveAnimation) return;
    if (game.cardMoveAnimation.type !== 'give') return;
    if (game.cardMoveAnimation.playerId !== peerId) return;
    const timer = setTimeout(() => {
      clearCardMoveAnimation();
    }, 1400);
    return () => clearTimeout(timer);
  }, [game?.cardMoveAnimation?.type, game?.cardMoveAnimation?.startedAt, game?.cardMoveAnimation?.playerId, peerId, clearCardMoveAnimation]);

  // Handle opponent card click
  const handleOpponentCardClick = (playerId: string, cardIndex: number) => {
    // Triple-click detection FIRST - for stacking
    const isCardBeingInspected = inspectedCard?.playerId === playerId && inspectedCard?.cardIndex === cardIndex;
    if (gameIsActive && myPlayer && myPlayer.cards.length > 0 && !isCardBeingInspected) {
      const cardKey = `opp-${playerId}-${cardIndex}`;
      const now = Date.now();
      
      if (!clickCountRef.current[cardKey]) {
        clickCountRef.current[cardKey] = { count: 0, timer: null, lastClickTime: 0 };
      }
      
      const clickData = clickCountRef.current[cardKey];
      const timeSinceLastClick = now - (clickData.lastClickTime || 0);
      
      // If clicks are happening fast (within 400ms), count them
      if (timeSinceLastClick < 400) {
        clickData.count++;
      } else {
        clickData.count = 1;
      }
      clickData.lastClickTime = now;
      
      // If triple click detected, attempt stack
      if (clickData.count >= 3) {
        clickData.count = 0;
        // Stack opponent's card using my first card
        attemptStack(0, playerId, cardIndex);
        return;
      }
    }

    // Power-up handling (only runs if not a triple-click)
    if (game.turnPhase === 'power_up' && game.currentPowerUp && isMyTurn) {
      const { type } = game.currentPowerUp;
      const targetPlayer = game.players.find(p => p.id === playerId);

      if (type === 'inspect_other') {
        if (targetPlayer) {
          // Set inspecting card in game state for real-time sync
          const { setInspectingCard } = useGameStore.getState();
          setInspectingCard({ playerId, cardIndex });
          // Also set local inspectedCard for viewing
          setInspectedCard({
            playerId,
            cardIndex,
            card: targetPlayer.cards[cardIndex],
          });
        }
        return;
      }

      // For blind_swap (9) or inspect_swap (10) - select opponent's card
      if (type === 'blind_swap' || type === 'inspect_swap') {
        // Don't allow re-selection once both cards are selected (phase is confirmed or beyond)
        if (powerUpSwapAnim.phase === 'confirmed' || powerUpSwapAnim.phase === 'animating' || powerUpSwapAnim.phase === 'revealing') {
          return;
        }
        
        if (targetPlayer) {
          setPowerUpSwapAnim(prev => ({
            ...prev,
            opponentId: playerId,
            opponentCardIndex: cardIndex,
            opponentCard: targetPlayer.cards[cardIndex],
            phase: prev.myCardIndex !== null ? 'confirmed' : 'selecting',
          }));
          
          // Sync selection to all players
          if (powerUpSwapAnim.myCardIndex !== null) {
            // Both cards selected - sync and execute
            setSwapSelection(playerId, cardIndex, powerUpSwapAnim.myCardIndex, type);
            executePowerUpSwap(powerUpSwapAnim.myCardIndex, playerId, cardIndex, type);
          } else {
            // Only opponent card selected - sync partial selection
            setSwapSelection(playerId, cardIndex, null, type);
          }
        }
        return;
      }
      
      // For blind_swap_others (9 with 0 cards) or inspect_swap_others (10 with 0 cards)
      // Select TWO opponent cards
      if (type === 'blind_swap_others' || type === 'inspect_swap_others') {
        // Don't allow re-selection once both cards are selected (phase is confirmed or beyond)
        if (powerUpSwapAnim.phase === 'confirmed' || powerUpSwapAnim.phase === 'animating' || powerUpSwapAnim.phase === 'revealing') {
          return;
        }
        
        if (targetPlayer) {
          // If first opponent not selected yet
          if (powerUpSwapAnim.opponentId === null) {
            setPowerUpSwapAnim(prev => ({
              ...prev,
              opponentId: playerId,
              opponentCardIndex: cardIndex,
              opponentCard: targetPlayer.cards[cardIndex],
              phase: 'selecting',
            }));
          } 
          // If first is selected but second is not (and it's a different card)
          else if (powerUpSwapAnim.secondOpponentId === null && 
                   !(powerUpSwapAnim.opponentId === playerId && powerUpSwapAnim.opponentCardIndex === cardIndex)) {
            setPowerUpSwapAnim(prev => ({
              ...prev,
              secondOpponentId: playerId,
              secondOpponentCardIndex: cardIndex,
              secondOpponentCard: targetPlayer.cards[cardIndex],
              phase: 'confirmed',
            }));
            
            // Execute the swap between the two opponents
            executeOthersSwap(
              powerUpSwapAnim.opponentId!, 
              powerUpSwapAnim.opponentCardIndex!, 
              playerId, 
              cardIndex, 
              type
            );
          }
        }
        return;
      }
    }
  };
  
  // Execute power-up swap with animation
  const executePowerUpSwap = (myCardIdx: number, oppId: string, oppCardIdx: number, type: PowerUpType) => {
    const targetPlayer = game.players.find(p => p.id === oppId);
    if (!targetPlayer || !myPlayer) return;
    
    // Set to confirmed phase (both cards green)
    setPowerUpSwapAnim({
      myCardIndex: myCardIdx,
      opponentId: oppId,
      opponentCardIndex: oppCardIdx,
      secondOpponentId: null,
      secondOpponentCardIndex: null,
      myCard: myPlayer.cards[myCardIdx],
      opponentCard: targetPlayer.cards[oppCardIdx],
      phase: 'confirmed',
    });
    
    // After brief pause, animate
    setTimeout(() => {
      setPowerUpSwapAnim(prev => ({ ...prev, phase: 'animating' }));
      
      // For blind_swap (9), start the synced animation so all players see it
      if (type === 'blind_swap') {
        startSwapAnimation('blind_swap', oppId, oppCardIdx, myCardIdx);
      }
      
      // For inspect_swap (10), show revealing phase and wait for user decision
      if (type === 'inspect_swap') {
        setTimeout(() => {
          setPowerUpSwapAnim(prev => ({ ...prev, phase: 'revealing' }));
          // Don't auto-complete - wait for user to click Swap or Keep button
        }, 1000);
      } else {
        // For blind_swap (9), complete immediately after animation
        setTimeout(() => {
          completePowerUp(oppId, oppCardIdx, myCardIdx);
          clearSwapAnimation();
          setPowerUpSwapAnim({
            myCardIndex: null,
            opponentId: null,
            opponentCardIndex: null,
            secondOpponentId: null,
            secondOpponentCardIndex: null,
            myCard: null,
            opponentCard: null,
            phase: 'idle',
          });
        }, 1000);
      }
    }, 700);
  };
  
  // Execute swap between two opponents (when player has 0 cards)
  const executeOthersSwap = (
    firstOppId: string, 
    firstOppCardIdx: number, 
    secondOppId: string, 
    secondOppCardIdx: number, 
    type: PowerUpType
  ) => {
    const firstPlayer = game.players.find(p => p.id === firstOppId);
    const secondPlayer = game.players.find(p => p.id === secondOppId);
    if (!firstPlayer || !secondPlayer) return;
    
    // After brief pause, animate
    setTimeout(() => {
      setPowerUpSwapAnim(prev => ({ ...prev, phase: 'animating' }));
      
      // For blind_swap_others (9), start the synced animation so all players see it
      if (type === 'blind_swap_others') {
        startSwapAnimation('blind_swap_others', firstOppId, firstOppCardIdx, undefined, secondOppId, secondOppCardIdx);
      }
      
      // For inspect_swap_others (10), show revealing phase and wait for user decision
      if (type === 'inspect_swap_others') {
        setTimeout(() => {
          setPowerUpSwapAnim(prev => ({ ...prev, phase: 'revealing' }));
          // Don't auto-complete - wait for user to click Swap or Keep button
        }, 1000);
      } else {
        // For blind_swap_others (9), complete immediately after animation
        setTimeout(() => {
          completePowerUp(firstOppId, firstOppCardIdx, undefined, secondOppId, secondOppCardIdx);
          clearSwapAnimation();
          setPowerUpSwapAnim({
            myCardIndex: null,
            opponentId: null,
            opponentCardIndex: null,
            secondOpponentId: null,
            secondOpponentCardIndex: null,
            myCard: null,
            opponentCard: null,
            secondOpponentCard: null,
            phase: 'idle',
          });
        }, 1000);
      }
    }, 700);
  };

  const handleCallReds = () => {
    if (!isMyTurn || game.phase !== 'playing' || game.turnPhase !== 'draw') return;
    callReds();
  };

  const handleReadyClick = () => {
    markReady();
    const mp = getMultiplayerConnection();
    if (isHost) {
      setTimeout(() => {
        const updatedGame = useGameStore.getState().game;
        if (updatedGame) mp.broadcastState(updatedGame);
      }, 50);
    } else {
      mp.sendToAll({
        type: 'player_ready',
        payload: { playerId: peerId },
      });
    }
  };

  // Complete inspection (close the side panel)
  const handleCloseInspection = () => {
    setInspectedCard(null);
    // completePowerUp already clears inspectingCard in game state
    if (game.currentPowerUp?.type === 'inspect_own' || game.currentPowerUp?.type === 'inspect_other') {
      completePowerUp();
    }
  };

  // Confirm swap after inspecting (for inspect_swap)
  const handleConfirmSwap = () => {
    if (inspectedCard && game.currentPowerUp?.type === 'inspect_swap') {
      completePowerUp(inspectedCard.playerId, inspectedCard.cardIndex);
      setInspectedCard(null);
    }
  };

  const handleCancelSwap = () => {
    setInspectedCard(null);
    completePowerUp();
  };

  const getInstructionText = () => {
    if (game.phase === 'waiting') return 'Waiting for players to join...';

    if (game.phase === 'viewing_cards') {
      if (isViewingMyCards) return 'Memorize your bottom 2 cards! Click "Ready" when done.';
      return `Waiting for ${game.players.filter(p => !p.hasSeenBottomCards).length} player(s) to be ready...`;
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
      return 'Draw from deck or discard pile.';
    }

    if (game.turnPhase === 'decide') {
      if (drawnCardSource === 'discard') {
        return 'You must swap this card with one of yours! (Cannot discard back)';
      }
      return 'Click a card to swap, or click discard pile to discard.';
    }

    if (game.turnPhase === 'power_up_choice') {
      // This phase is no longer used - power-ups auto-activate
      return 'Power-up ready!';
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
      case 'blind_swap_others':
        return powerUpSwapAnim.opponentId 
          ? "Now click a SECOND opponent's card to complete the swap."
          : "Click TWO opponents' cards to swap them (blind).";
      case 'inspect_swap_others':
        return powerUpSwapAnim.opponentId 
          ? "Now click a SECOND opponent's card to inspect and swap."
          : "Click TWO opponents' cards to inspect and optionally swap.";
      default:
        return '';
    }
  };

  const getPowerUpName = (type: PowerUpType): string => {
    switch (type) {
      case 'inspect_own': return 'Peek at Own Card (7)';
      case 'inspect_other': return "Peek at Opponent's Card (8)";
      case 'blind_swap': return 'Blind Swap (9)';
      case 'inspect_swap': return 'Inspect & Swap (10)';
      case 'blind_swap_others': return 'Swap Opponents\' Cards (9)';
      case 'inspect_swap_others': return 'Inspect & Swap Opponents\' Cards (10)';
      default: return 'Power-Up';
    }
  };

  return (
    <div className="relative w-full h-screen bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 overflow-hidden">
      {/* Felt texture overlay */}
      <div className="absolute inset-0 opacity-30 felt-pattern" />

      {/* Game info panel - top left */}
      <div className="absolute top-4 left-4 bg-black/50 backdrop-blur px-4 py-3 rounded-lg z-20 max-w-xs">
        <div className="text-emerald-400 text-xs">Game Code</div>
        <div className="text-white font-mono text-xl font-bold tracking-wider mb-2">{game.gameCode}</div>
        
        {/* Last action */}
        <AnimatePresence mode="wait">
          <motion.div
            key={game.lastAction}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className="border-t border-white/20 pt-2"
          >
            <div className="text-amber-300 text-xs font-medium leading-snug">{game.lastAction}</div>
          </motion.div>
        </AnimatePresence>
        
        {/* Instructions */}
        <AnimatePresence>
          {showInstructions && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="border-t border-white/20 pt-2 mt-2"
            >
              <div className="text-emerald-100 text-xs leading-snug">{getInstructionText()}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Opponents in circular layout */}
      {opponents.map((opponent, idx) => {
        // Calculate position around the table
        // With N opponents, distribute them evenly in the top half of the circle
        const totalOpponents = opponents.length;
        
        // Angle calculation: spread opponents across the top arc (from -60 to 60 degrees for 2 players, etc.)
        let angle: number;
        let x: number;
        let y: number;
        let rotationAngle: number;
        
        if (totalOpponents === 1) {
          // Single opponent directly across (top)
          angle = 0;
          x = 50; // center
          y = 12; // top
          rotationAngle = 180;
        } else if (totalOpponents === 2) {
          // Two opponents at ±30 degrees from top
          const positions = [-35, 35];
          angle = positions[idx];
          // Convert angle to position (semi-circle layout)
          const radius = 38; // percentage from center
          x = 50 + radius * Math.sin(angle * Math.PI / 180);
          y = 50 - radius * Math.cos(angle * Math.PI / 180);
          rotationAngle = angle + 180;
        } else if (totalOpponents === 3) {
          // Three opponents spread across top
          const positions = [-50, 0, 50];
          angle = positions[idx];
          const radius = 38;
          x = 50 + radius * Math.sin(angle * Math.PI / 180);
          y = 50 - radius * Math.cos(angle * Math.PI / 180);
          rotationAngle = angle + 180;
        } else {
          // 4+ opponents - spread evenly
          const spreadAngle = 120; // total arc to spread across
          const step = spreadAngle / (totalOpponents - 1);
          angle = -spreadAngle / 2 + idx * step;
          const radius = 38;
          x = 50 + radius * Math.sin(angle * Math.PI / 180);
          y = 50 - radius * Math.cos(angle * Math.PI / 180);
          rotationAngle = angle + 180;
        }
        
        // Get the inspecting card index for this opponent
        const opponentInspectingIndex = game.inspectingCard?.playerId === opponent.id 
          ? game.inspectingCard.cardIndex 
          : null;
        
        return (
          <div
            key={opponent.id}
            className="absolute z-10"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <OpponentHand
              player={opponent}
              isCurrentPlayer={game.players[game.currentPlayerIndex]?.id === opponent.id}
              position="top"
              onCardClick={(cardIndex) => handleOpponentCardClick(opponent.id, cardIndex)}
              highlightedCardIndex={null}
              powerUpHighlight={
                isMyTurn &&
                game.turnPhase === 'power_up' && 
                game.currentPowerUp && 
                (game.currentPowerUp.type === 'blind_swap' || 
                 game.currentPowerUp.type === 'inspect_swap' || 
                 game.currentPowerUp.type === 'inspect_other' ||
                 game.currentPowerUp.type === 'blind_swap_others' ||
                 game.currentPowerUp.type === 'inspect_swap_others')
                  ? 'selectable'
                  : undefined
              }
              powerUpSelectedIndex={
                // Use synced state for all players to see selection
                game.swapAnimation?.targetPlayerId === opponent.id 
                  ? game.swapAnimation.targetCardIndex 
                  : game.swapAnimation?.secondTargetPlayerId === opponent.id 
                    ? game.swapAnimation.secondTargetCardIndex ?? null
                    : (powerUpSwapAnim.opponentId === opponent.id 
                        ? powerUpSwapAnim.opponentCardIndex 
                        : powerUpSwapAnim.secondOpponentId === opponent.id 
                          ? powerUpSwapAnim.secondOpponentCardIndex 
                          : null)
              }
              powerUpConfirmed={
                // Use synced state for all players to see confirmed selection
                (game.swapAnimation?.targetPlayerId === opponent.id || game.swapAnimation?.secondTargetPlayerId === opponent.id) ||
                ((powerUpSwapAnim.opponentId === opponent.id || powerUpSwapAnim.secondOpponentId === opponent.id) && 
                (powerUpSwapAnim.phase === 'confirmed' || powerUpSwapAnim.phase === 'animating' || powerUpSwapAnim.phase === 'revealing'))
              }
              inspectingCardIndex={opponentInspectingIndex}
              isViewerInspecting={isMyTurn && game.currentPowerUp?.type === 'inspect_other' && game.inspectingCard?.playerId === opponent.id}
              revealingSwapCardIndex={
                game.currentPowerUp?.type === 'inspect_swap' &&
                powerUpSwapAnim.phase === 'revealing' &&
                powerUpSwapAnim.opponentId === opponent.id
                  ? powerUpSwapAnim.opponentCardIndex
                  : null
              }
              isViewerRevealing={
                isMyTurn && 
                game.currentPowerUp?.type === 'inspect_swap' && 
                powerUpSwapAnim.phase === 'revealing' &&
                powerUpSwapAnim.opponentId === opponent.id
              }
              rotationAngle={rotationAngle}
            />
          </div>
        );
      })}

      {/* Center table area */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-16 z-10">
        {/* Deck */}
        <motion.div 
          className="flex flex-col items-center gap-2"
          animate={drawAnimation === 'deck' ? { scale: [1, 0.95, 1] } : {}}
          transition={{ duration: 0.2 }}
        >
          <Deck
            count={game.deck.length}
            onClick={handleDeckClick}
            disabled={!allPlayersReady || !isMyTurn || game.turnPhase !== 'draw'}
            highlighted={allPlayersReady && isMyTurn && game.turnPhase === 'draw'}
          />
          <span className="text-emerald-400 text-xs">Deck</span>
          
          {/* Show when opponent is drawing from deck */}
          <AnimatePresence>
            {!isMyTurn && game.drawnCard && game.lastAction.includes('deck') && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute -top-8 text-xs text-amber-400 font-medium whitespace-nowrap"
              >
                {currentPlayer?.name} drew ↑
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Discard pile */}
        <motion.div 
          className="flex flex-col items-center gap-2 relative"
          animate={
            discardAnimation ? { scale: [1, 1.05, 1] } : 
            drawAnimation === 'discard' ? { scale: [1, 0.95, 1] } : {}
          }
          transition={{ duration: 0.3 }}
        >
          <DiscardPile
            cards={game.discardPile}
            onClick={handleDiscardClick}
            highlighted={
              allPlayersReady && (
                (isMyTurn && game.turnPhase === 'draw') ||
                (isMyTurn && game.turnPhase === 'decide' && drawnCardSource !== 'discard')
              )
            }
          />
          <span className="text-emerald-400 text-xs">Discard</span>
          
          {/* Stacking locked indicator */}
          {game.lastDiscardWasStack && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute -top-2 -right-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-bold shadow-lg"
            >
              🔒
            </motion.div>
          )}
          
          {/* Show when opponent is drawing from discard */}
          <AnimatePresence>
            {!isMyTurn && game.drawnCard && game.lastAction.includes('discard') && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute -top-8 text-xs text-cyan-400 font-medium whitespace-nowrap"
              >
                {currentPlayer?.name} took ↑
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Drawn card animation - stays in place, enlarges 50% to simulate lifting */}
        <AnimatePresence mode="wait">
          {game.drawnCard && (
            <motion.div
              key={game.drawnCard.id}
              initial={{ scale: 1, opacity: 0.8 }}
              animate={{ scale: 1.5, opacity: 1 }}
              exit={{ scale: 1, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              className="flex flex-col items-center gap-2"
            >
              <div className="relative">
                {/* Shadow underneath to show depth */}
                <motion.div 
                  className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-20 h-6 bg-black/40 rounded-full blur-lg"
                  animate={{ scale: [1, 1.1, 1], opacity: [0.4, 0.6, 0.4] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                
                {/* Squeeze flip animation for deck draws */}
                {drawnCardSource === 'deck' && isMyTurn ? (
                  <div className="relative">
                    {/* Card back - squeezes out */}
                    <motion.div
                      initial={{ scaleX: 1, opacity: 1 }}
                      animate={{ scaleX: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeIn' }}
                      style={{ transformOrigin: 'center' }}
                      className="absolute inset-0"
                    >
                      <Card card={{ ...game.drawnCard, faceUp: false }} size="lg" />
                    </motion.div>
                    
                    {/* Card front - expands in */}
                    <motion.div
                      initial={{ scaleX: 0, opacity: 0 }}
                      animate={{ scaleX: 1, opacity: 1 }}
                      transition={{ duration: 0.25, ease: 'easeOut', delay: 0.25 }}
                      style={{ transformOrigin: 'center' }}
                    >
                      <Card card={game.drawnCard} size="lg" />
                    </motion.div>
                  </div>
                ) : (
                  /* No flip for discard draws or opponent view */
                  <Card 
                    card={isMyTurn ? game.drawnCard : { ...game.drawnCard, faceUp: false }} 
                    size="lg" 
                  />
                )}
                
                {/* Glow effect */}
                <motion.div
                  className="absolute inset-0 rounded-xl bg-amber-400/30 blur-xl -z-10"
                  animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              </div>
              <motion.span 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className={`text-xs font-medium ${drawnCardSource === 'discard' && isMyTurn ? 'text-orange-400' : 'text-amber-400'}`}
              >
                {isMyTurn 
                  ? (drawnCardSource === 'deck' 
                      ? '🎴 From Deck' 
                      : '♻️ From Discard (must swap!)')
                  : `${currentPlayer?.name} is deciding...`
                }
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Card Movement Animation Overlay - shows sliding cards for all players */}
      <AnimatePresence>
        {cardMoveAnim.type === 'discard_drawn' && cardMoveAnim.drawnCard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-30"
          >
            {/* Card sliding from drawn position to discard pile */}
            <motion.div
              initial={{ 
                position: 'fixed',
                top: '50%',
                left: '60%',
                x: '-50%',
                y: '-50%',
                scale: 1.5,
              }}
              animate={{ 
                top: '50%',
                left: '55%',
                x: '-50%',
                y: '-50%',
                scale: 1,
              }}
              transition={{ 
                type: 'spring', 
                stiffness: 120, 
                damping: 18,
              }}
              className="z-40"
            >
              <Card card={{ ...cardMoveAnim.drawnCard, faceUp: true }} size="lg" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Swap animation overlay - cards physically move on the table (SEQUENTIAL) */}
      <AnimatePresence>
        {cardMoveAnim.type === 'swap_cards' && cardMoveAnim.drawnCard && cardMoveAnim.handCard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-30"
          >
            {/* Subtle dark overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black"
            />
            
            {/* STEP 1: Card going OUT to discard (old card from hand) - flip and move to discard */}
            <motion.div
              initial={{ 
                position: 'fixed',
                // Start at the exact card position in hand (2x2 grid)
                // Index 0,1 = top row, Index 2,3 = bottom row
                bottom: cardMoveAnim.handIndex !== null && cardMoveAnim.handIndex < 2 ? '18%' : '8%',
                left: cardMoveAnim.handIndex !== null ? 
                  `calc(50% + ${(cardMoveAnim.handIndex % 2 === 0 ? -1 : 1) * 48}px)` : '50%',
                x: '-50%',
                scale: 1,
                zIndex: 50,
              }}
              animate={{ 
                // Move to discard pile position
                bottom: '50%',
                left: '55%',
                x: '-50%',
                y: '50%',
                scale: 1,
              }}
              transition={{ 
                type: 'spring', 
                stiffness: 120, 
                damping: 18,
                duration: 0.5,
              }}
              className="z-50"
            >
              {/* Squeeze flip animation */}
              <div className="relative w-20 h-28">
                {/* Card back squeezes out */}
                <motion.div
                  initial={{ scaleX: 1, opacity: 1 }}
                  animate={{ scaleX: 0, opacity: 0 }}
                  transition={{ duration: 0.15, ease: 'easeIn' }}
                  style={{ transformOrigin: 'center' }}
                  className="absolute inset-0"
                >
                  <Card card={{ ...cardMoveAnim.handCard, faceUp: false }} size="lg" />
                </motion.div>
                {/* Card front expands in */}
                <motion.div
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ duration: 0.15, ease: 'easeOut', delay: 0.15 }}
                  style={{ transformOrigin: 'center' }}
                >
                  <Card card={{ ...cardMoveAnim.handCard, faceUp: true }} size="lg" />
                </motion.div>
              </div>
            </motion.div>
            
            {/* STEP 2: Card coming IN to hand (drawn card) - moves to exact empty slot AFTER discard */}
            <motion.div
              initial={{ 
                position: 'fixed',
                // Start at center (where drawn card was shown)
                top: '50%',
                left: '50%',
                x: '-50%',
                y: '-50%',
                scale: 1.5,
                opacity: 1,
              }}
              animate={{ 
                // Move to the exact card position in hand where the old card was
                top: 'auto',
                bottom: cardMoveAnim.handIndex !== null && cardMoveAnim.handIndex < 2 ? '18%' : '8%',
                left: cardMoveAnim.handIndex !== null ? 
                  `calc(50% + ${(cardMoveAnim.handIndex % 2 === 0 ? -1 : 1) * 48}px)` : '50%',
                x: '-50%',
                y: '0%',
                scale: 1,
              }}
              transition={{ 
                type: 'spring', 
                stiffness: 120, 
                damping: 18,
                // Delay so this happens AFTER the discard animation
                delay: 0.6,
              }}
              className="z-40"
            >
              <Card card={cardMoveAnim.drawnCard} size="lg" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card Movement Animation for OTHER PLAYERS - shows sliding cards */}
      <AnimatePresence>
        {game.cardMoveAnimation && game.cardMoveAnimation.playerId !== peerId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-30"
          >
            {/* Subtle overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.2 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black"
            />
            
            {/* Player indicator */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="fixed top-4 left-1/2 -translate-x-1/2 z-50"
            >
              <div className="px-4 py-2 bg-amber-500/90 rounded-full font-bold text-white shadow-lg">
                {game.cardMoveAnimation.type === 'swap' && '🔄 '}
                {game.cardMoveAnimation.type === 'discard' && '🃏 '}
                {game.cardMoveAnimation.type === 'draw_deck' && '🎴 '}
                {game.cardMoveAnimation.type === 'draw_discard' && '↩️ '}
                {game.cardMoveAnimation.playerName}
                {game.cardMoveAnimation.type === 'swap' && ' swapping...'}
                {game.cardMoveAnimation.type === 'discard' && ' discarding...'}
                {game.cardMoveAnimation.type === 'draw_deck' && ' drawing from deck...'}
                {game.cardMoveAnimation.type === 'draw_discard' && ' taking from discard...'}
              </div>
            </motion.div>

            {/* For SWAP: Show card going to discard (face up) THEN card going to hand (face down) - SEQUENTIAL */}
            {game.cardMoveAnimation.type === 'swap' && game.cardMoveAnimation.discardedCard && (
              <>
                {/* STEP 1: Card going to discard pile - flips and moves */}
                <motion.div
                  initial={{ 
                    position: 'fixed',
                    // Start at opponent's hand position (they're at top of screen)
                    // Index 0,1 = bottom row (top for us), Index 2,3 = top row (farther up for us)
                    top: game.cardMoveAnimation.handIndex !== null && game.cardMoveAnimation.handIndex < 2 ? '25%' : '15%',
                    left: game.cardMoveAnimation.handIndex !== null ? 
                      `calc(50% + ${(game.cardMoveAnimation.handIndex % 2 === 0 ? -1 : 1) * 40}px)` : '50%',
                    x: '-50%',
                    scale: 1,
                    opacity: 1,
                  }}
                  animate={{ 
                    // Move to discard pile position
                    top: '50%',
                    left: '55%',
                    y: '-50%',
                    scale: 1,
                  }}
                  transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                  className="z-40"
                >
                  <div className="relative w-20 h-28">
                    <motion.div
                      initial={{ scaleX: 1 }}
                      animate={{ scaleX: 0 }}
                      transition={{ duration: 0.15, ease: 'easeIn' }}
                      style={{ transformOrigin: 'center' }}
                      className="absolute inset-0"
                    >
                      <Card card={{ ...game.cardMoveAnimation.discardedCard!, faceUp: false }} size="lg" />
                    </motion.div>
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.15, ease: 'easeOut', delay: 0.15 }}
                      style={{ transformOrigin: 'center' }}
                    >
                      <Card card={{ ...game.cardMoveAnimation.discardedCard!, faceUp: true }} size="lg" />
                    </motion.div>
                  </div>
                </motion.div>

                {/* STEP 2: Card going to player's hand (face down) - moves AFTER discard */}
                <motion.div
                  initial={{ 
                    position: 'fixed',
                    // Start at center where drawn card was
                    top: '50%',
                    left: '50%',
                    x: '-50%',
                    y: '-50%',
                    scale: 1.3,
                  }}
                  animate={{ 
                    // Move to exact hand position (opponent is at top)
                    top: game.cardMoveAnimation.handIndex !== null && game.cardMoveAnimation.handIndex < 2 ? '25%' : '15%',
                    left: game.cardMoveAnimation.handIndex !== null ? 
                      `calc(50% + ${(game.cardMoveAnimation.handIndex % 2 === 0 ? -1 : 1) * 40}px)` : '50%',
                    x: '-50%',
                    y: '0%',
                    scale: 1,
                  }}
                  transition={{ type: 'spring', stiffness: 120, damping: 18, delay: 0.6 }}
                  className="z-40"
                >
                  <Card card={{ ...game.cardMoveAnimation.drawnCard!, faceUp: false }} size="lg" />
                </motion.div>
              </>
            )}

            {/* For DISCARD: Show drawn card sliding to discard pile */}
            {game.cardMoveAnimation.type === 'discard' && game.cardMoveAnimation.discardedCard && (
              <motion.div
                initial={{ 
                  position: 'fixed',
                  top: '50%',
                  left: '60%',
                  x: '-50%',
                  y: '-50%',
                  scale: 1.3,
                }}
                animate={{ 
                  left: '55%',
                  scale: 1,
                }}
                transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                className="z-40"
              >
                <Card card={{ ...game.cardMoveAnimation.discardedCard, faceUp: true }} size="lg" />
              </motion.div>
            )}

            {/* For DRAW from DISCARD: Show card lifting from discard */}
            {game.cardMoveAnimation.type === 'draw_discard' && game.cardMoveAnimation.drawnCard && (
              <motion.div
                initial={{ 
                  position: 'fixed',
                  top: '50%',
                  left: '55%',
                  x: '-50%',
                  y: '-50%',
                  scale: 1,
                }}
                animate={{ 
                  left: '60%',
                  scale: 1.3,
                }}
                transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                className="z-40"
              >
                <Card card={{ ...game.cardMoveAnimation.drawnCard, faceUp: true }} size="lg" />
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Quick action indicator (non-blocking, subtle) */}
      <AnimatePresence>
        {actionAnnouncement && !swapAnimation && !discardAnimation && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          >
            <div className={`
              px-4 py-2 rounded-full font-bold text-sm text-white shadow-lg
              ${actionAnnouncement.type === 'swap' ? 'bg-amber-500/90' : ''}
              ${actionAnnouncement.type === 'stack' ? 'bg-purple-500/90' : ''}
              ${actionAnnouncement.type === 'discard' ? 'bg-rose-500/90' : ''}
              ${actionAnnouncement.type === 'draw' ? 'bg-cyan-500/90' : ''}
            `}>
              {actionAnnouncement.type === 'swap' && '🔄'}
              {actionAnnouncement.type === 'stack' && '⚡'}
              {actionAnnouncement.type === 'discard' && '🃏'}
              {actionAnnouncement.type === 'draw' && '🎴'}
              {' '}{actionAnnouncement.playerName}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Discard animation overlay */}
      <AnimatePresence>
        {discardAnimation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-30"
          >
            {/* Flying card to discard pile */}
            <motion.div
              initial={{ 
                opacity: 1, 
                scale: 1.5,
                x: 'calc(50vw - 50px)',
                y: 'calc(50vh - 70px)',
              }}
              animate={{ 
                opacity: 1, 
                scale: 1,
                x: 'calc(50vw + 40px)',
                y: 'calc(50vh - 70px)',
                rotate: [0, 10, 0],
              }}
              exit={{ 
                opacity: 0, 
                scale: 0.8,
              }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              className="absolute"
            >
              <Card card={discardAnimation} size="lg" />
            </motion.div>
            
            {/* DISCARD text */}
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ delay: 0.1 }}
              className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl font-black text-rose-400 drop-shadow-lg"
              style={{ textShadow: '0 0 20px rgba(244, 63, 94, 0.5)' }}
            >
              DISCARD!
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* My hand at bottom */}
      {myPlayer && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 overflow-visible">
          <PlayerHand
            player={myPlayer}
            isCurrentPlayer={isMyTurn}
            isMyHand={true}
            selectedCardIndex={selectedCardIndex}
            onCardClick={handleMyCardClick}
            showBottomCards={isViewingMyCards}
            position="bottom"
            powerUpHighlight={
              // Highlight for card give selection after stacking opponent
              (game.stackAnimation?.result?.awaitingCardGive && game.stackAnimation.result.stackerId === peerId)
                ? 'selectable'
                : (game.turnPhase === 'power_up' && 
                   game.currentPowerUp && 
                   (game.currentPowerUp.type === 'blind_swap' || 
                    game.currentPowerUp.type === 'inspect_swap' || 
                    game.currentPowerUp.type === 'inspect_own')
                    ? 'selectable'
                    : undefined)
            }
            powerUpSelectedIndex={
              // Use synced state for all players to see selection
              game.swapAnimation?.sourcePlayerId === peerId && game.swapAnimation?.sourceCardIndex !== undefined
                ? game.swapAnimation.sourceCardIndex
                : powerUpSwapAnim.myCardIndex
            }
            powerUpConfirmed={
              // Use synced state for all players to see confirmed selection
              (game.swapAnimation?.sourcePlayerId === peerId && game.swapAnimation?.sourceCardIndex !== undefined) ||
              (powerUpSwapAnim.phase === 'confirmed' || powerUpSwapAnim.phase === 'animating' || powerUpSwapAnim.phase === 'revealing')
            }
            inspectingCardIndex={game.inspectingCard?.playerId === peerId ? game.inspectingCard.cardIndex : null}
            isInspectingMyCard={isMyTurn && game.currentPowerUp?.type === 'inspect_own'}
            revealingSwapCardIndex={
              game.currentPowerUp?.type === 'inspect_swap' && 
              powerUpSwapAnim.phase === 'revealing' && 
              isMyTurn
                ? powerUpSwapAnim.myCardIndex 
                : null
            }
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-20">
        {game.phase === 'viewing_cards' && isViewingMyCards && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleReadyClick}
            className="px-8 py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-lg rounded-xl shadow-lg hover:shadow-xl transition-shadow"
          >
            Ready!
          </motion.button>
        )}

        {allPlayersReady && (game.phase === 'playing' || game.phase === 'final_round') && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            whileHover={isMyTurn && game.turnPhase === 'draw' && !game.redsCallerId ? { scale: 1.05 } : {}}
            whileTap={isMyTurn && game.turnPhase === 'draw' && !game.redsCallerId ? { scale: 0.95 } : {}}
            onClick={handleCallReds}
            disabled={!isMyTurn || game.turnPhase !== 'draw' || !!game.redsCallerId}
            className={`px-8 py-4 font-bold text-lg rounded-xl shadow-lg transition-all ${
              isMyTurn && game.turnPhase === 'draw' && !game.redsCallerId
                ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white hover:shadow-xl cursor-pointer'
                : game.redsCallerId
                  ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed line-through'
                  : 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
            }`}
          >
            {game.redsCallerId ? 'REDS Called!' : 'REDS!'}
          </motion.button>
        )}
      </div>

      {/* Subtle "give a card" prompt (no background dim) */}
      <AnimatePresence>
        {game.stackAnimation?.result?.awaitingCardGive && game.stackAnimation.result.stackerId === peerId && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-16 left-4 z-40 pointer-events-none"
          >
            <div className="px-3 py-2 rounded-xl bg-black/40 backdrop-blur text-white text-sm font-semibold shadow-lg border border-white/10">
              Give a card: <span className="text-amber-300">click any card in your hand</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Non-blocking Skip Power-Up button on the side */}
      <AnimatePresence>
        {game.turnPhase === 'power_up' && game.currentPowerUp && isMyTurn && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed right-4 bottom-1/3 z-30"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={skipPowerUp}
              className="px-4 py-2 bg-gray-700/90 hover:bg-gray-600 text-white font-semibold rounded-lg text-sm transition-colors shadow-lg"
            >
              Skip ⏭️
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Flying card animation (from opponent to side panel) */}
      <AnimatePresence>
        {flyingCard && (
          <motion.div
            initial={{ 
              opacity: 1, 
              x: '0vw',
              y: flyingCard.fromTop ? '-30vh' : '30vh',
              scale: 0.5,
            }}
            animate={{ 
              opacity: 1, 
              x: '35vw',
              y: '0vh',
              scale: 1,
            }}
            exit={{ opacity: 0 }}
            transition={{ 
              type: 'spring', 
              stiffness: 200, 
              damping: 25,
              duration: 0.5
            }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none"
          >
            <Card card={{ ...flyingCard.card, faceUp: true }} size="lg" />
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Power-up swap reveal - cards stay in place with highlighting */}
      
      {/* Power-up notification toast (non-blocking) */}
      <AnimatePresence>
        {powerUpNotification && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className="fixed top-4 left-1/2 z-50 pointer-events-none"
          >
            <div className={`
              px-4 py-2 rounded-lg font-semibold text-white shadow-lg flex items-center gap-2
              ${powerUpNotification.action === 'used' 
                ? 'bg-gradient-to-r from-amber-500 to-orange-500' 
                : 'bg-gradient-to-r from-gray-500 to-gray-600'
              }
            `}>
              {powerUpNotification.action === 'used' ? (
                <>
                  <span className="text-lg">
                    {powerUpNotification.powerUpType === 'inspect_own' && '👁️'}
                    {powerUpNotification.powerUpType === 'inspect_other' && '🔍'}
                    {powerUpNotification.powerUpType === 'blind_swap' && '🔀'}
                    {powerUpNotification.powerUpType === 'inspect_swap' && '👀🔀'}
                    {powerUpNotification.powerUpType === 'blind_swap_others' && '🔀🔀'}
                    {powerUpNotification.powerUpType === 'inspect_swap_others' && '👀🔀🔀'}
                  </span>
                  <span>{powerUpNotification.playerName} used power-up!</span>
                </>
              ) : (
                <>
                  <span className="text-lg">⏭️</span>
                  <span>{powerUpNotification.playerName} skipped power-up</span>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating "Done" button for 7 and 8 power-ups (card stays in place) */}
      <AnimatePresence>
        {inspectedCard && (game.currentPowerUp?.type === 'inspect_own' || game.currentPowerUp?.type === 'inspect_other') && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleCloseInspection}
              className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl text-lg shadow-lg shadow-amber-500/30"
            >
              👁️ Done Looking
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Floating Swap/Keep buttons for inspect_swap (10) - appears when both cards selected */}
      <AnimatePresence>
        {game.currentPowerUp?.type === 'inspect_swap' && 
         powerUpSwapAnim.myCardIndex !== null && 
         powerUpSwapAnim.opponentCardIndex !== null &&
         powerUpSwapAnim.phase === 'revealing' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 flex gap-4"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                // Execute swap - pass myCardIndex as sourceCardIndex
                if (powerUpSwapAnim.opponentId && powerUpSwapAnim.opponentCardIndex !== null && powerUpSwapAnim.myCardIndex !== null) {
                  completePowerUp(powerUpSwapAnim.opponentId, powerUpSwapAnim.opponentCardIndex, powerUpSwapAnim.myCardIndex);
                }
                setPowerUpSwapAnim({
                  myCardIndex: null,
                  opponentId: null,
                  opponentCardIndex: null,
                  secondOpponentId: null,
                  secondOpponentCardIndex: null,
                  myCard: null,
                  opponentCard: null,
                  phase: 'idle',
                });
              }}
              className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl text-lg shadow-lg shadow-green-500/30"
            >
              ✓ Swap Cards
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                // Keep cards - don't swap
                completePowerUp();
                setPowerUpSwapAnim({
                  myCardIndex: null,
                  opponentId: null,
                  opponentCardIndex: null,
                  secondOpponentId: null,
                  secondOpponentCardIndex: null,
                  myCard: null,
                  opponentCard: null,
                  phase: 'idle',
                });
              }}
              className="px-6 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-bold rounded-xl text-lg shadow-lg shadow-gray-500/30"
            >
              ✗ Keep My Card
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Floating Swap/Keep buttons for inspect_swap_others (10 with 0 cards) */}
      <AnimatePresence>
        {game.currentPowerUp?.type === 'inspect_swap_others' && 
         powerUpSwapAnim.opponentCardIndex !== null && 
         powerUpSwapAnim.secondOpponentCardIndex !== null &&
         powerUpSwapAnim.phase === 'revealing' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 flex gap-4"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                // Execute swap between opponents
                if (powerUpSwapAnim.opponentId && powerUpSwapAnim.opponentCardIndex !== null &&
                    powerUpSwapAnim.secondOpponentId && powerUpSwapAnim.secondOpponentCardIndex !== null) {
                  completePowerUp(
                    powerUpSwapAnim.opponentId, 
                    powerUpSwapAnim.opponentCardIndex, 
                    undefined,
                    powerUpSwapAnim.secondOpponentId, 
                    powerUpSwapAnim.secondOpponentCardIndex
                  );
                }
                setPowerUpSwapAnim({
                  myCardIndex: null,
                  opponentId: null,
                  opponentCardIndex: null,
                  secondOpponentId: null,
                  secondOpponentCardIndex: null,
                  myCard: null,
                  opponentCard: null,
                  secondOpponentCard: null,
                  phase: 'idle',
                });
              }}
              className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl text-lg shadow-lg shadow-green-500/30"
            >
              ✓ Swap Their Cards
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                // Don't swap - just complete
                completePowerUp();
                setPowerUpSwapAnim({
                  myCardIndex: null,
                  opponentId: null,
                  opponentCardIndex: null,
                  secondOpponentId: null,
                  secondOpponentCardIndex: null,
                  myCard: null,
                  opponentCard: null,
                  secondOpponentCard: null,
                  phase: 'idle',
                });
              }}
              className="px-6 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-bold rounded-xl text-lg shadow-lg shadow-gray-500/30"
            >
              ✗ Don't Swap
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Power-Up Swap Animation Overlay - visible to all players via synced game state */}
      <AnimatePresence>
        {game.swapAnimation && game.swapAnimation.phase === 'animating' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 pointer-events-none"
          >
            {/* Subtle backdrop */}
            <motion.div 
              className="absolute inset-0 bg-black/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            
            {/* Cards moving across the table */}
            <div className="absolute inset-0">
              {/* First card - starts from source position, moves to target position */}
              {(() => {
                // Determine if this is a regular swap (me <-> opponent) or others swap (opponent <-> opponent)
                const isOthersSwap = game.swapAnimation.type === 'blind_swap_others' || game.swapAnimation.type === 'inspect_swap_others';
                
                // Get card positions based on whose card it is
                const sourceIsMe = game.swapAnimation.sourcePlayerId === peerId;
                const targetIsMe = game.swapAnimation.targetPlayerId === peerId;
                
                // Position calculation (approximate based on table layout)
                // Bottom = my hand, Top = opponent across, etc.
                const myPosition = { x: '50%', y: '85%' };
                const getOpponentPosition = (playerId: string) => {
                  const opponentIndex = opponents.findIndex(o => o.id === playerId);
                  const count = opponents.length;
                  if (count === 1) return { x: '50%', y: '15%' };
                  if (count === 2) {
                    return opponentIndex === 0 ? { x: '20%', y: '30%' } : { x: '80%', y: '30%' };
                  }
                  // Default center top
                  return { x: '50%', y: '15%' };
                };
                
                const sourcePos = isOthersSwap 
                  ? getOpponentPosition(game.swapAnimation.targetPlayerId!)
                  : (sourceIsMe ? myPosition : getOpponentPosition(game.swapAnimation.sourcePlayerId || game.swapAnimation.playerId));
                
                const targetPos = isOthersSwap
                  ? getOpponentPosition(game.swapAnimation.secondTargetPlayerId!)
                  : (targetIsMe ? myPosition : getOpponentPosition(game.swapAnimation.targetPlayerId));
                
                const sourceName = isOthersSwap
                  ? game.players.find(p => p.id === game.swapAnimation?.targetPlayerId)?.name
                  : (sourceIsMe ? myPlayer?.name : game.swapAnimation.playerName);
                  
                const targetName = isOthersSwap
                  ? game.players.find(p => p.id === game.swapAnimation?.secondTargetPlayerId)?.name
                  : game.players.find(p => p.id === game.swapAnimation?.targetPlayerId)?.name;
                
                return (
                  <>
                    {/* First card moves from source to target */}
                    <motion.div
                      initial={{ 
                        left: sourcePos.x,
                        top: sourcePos.y,
                        x: '-50%',
                        y: '-50%',
                        scale: 1.5,
                      }}
                      animate={{ 
                        left: targetPos.x,
                        top: targetPos.y,
                        x: '-50%',
                        y: '-50%',
                        scale: 1.5,
                      }}
                      transition={{ 
                        duration: 0.8,
                        ease: [0.4, 0, 0.2, 1]
                      }}
                      className="absolute"
                    >
                      <div className="rounded-xl ring-4 ring-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.8)]">
                        <Card 
                          card={{ 
                            id: 'swap-card-1', 
                            suit: 'spades', 
                            rank: 'A', 
                            faceUp: false 
                          }} 
                          size="lg"
                        />
                      </div>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.1 }}
                        className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap"
                      >
                        <span className="px-2 py-1 rounded text-xs font-bold bg-emerald-600/90 text-white shadow-lg">
                          {sourceName}
                        </span>
                      </motion.div>
                    </motion.div>
                    
                    {/* Second card moves from target to source */}
                    <motion.div
                      initial={{ 
                        left: targetPos.x,
                        top: targetPos.y,
                        x: '-50%',
                        y: '-50%',
                        scale: 1.5,
                      }}
                      animate={{ 
                        left: sourcePos.x,
                        top: sourcePos.y,
                        x: '-50%',
                        y: '-50%',
                        scale: 1.5,
                      }}
                      transition={{ 
                        duration: 0.8,
                        ease: [0.4, 0, 0.2, 1]
                      }}
                      className="absolute"
                    >
                      <div className="rounded-xl ring-4 ring-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.8)]">
                        <Card 
                          card={{ 
                            id: 'swap-card-2', 
                            suit: 'hearts', 
                            rank: 'K', 
                            faceUp: false 
                          }} 
                          size="lg"
                        />
                      </div>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.1 }}
                        className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap"
                      >
                        <span className="px-2 py-1 rounded text-xs font-bold bg-emerald-600/90 text-white shadow-lg">
                          {targetName}
                        </span>
                      </motion.div>
                    </motion.div>
                  </>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stack Animation Overlay */}
      <AnimatePresence>
        {game.stackAnimation && game.stackAnimation.stacks.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 flex items-center justify-center z-40 pointer-events-none ${
              game.stackAnimation.result?.awaitingCardGive ? 'bg-transparent' : 'bg-black/60'
            }`}
          >
            <div className="relative flex flex-col items-center gap-6 pointer-events-auto">
              {/* Card flipping animation - squeeze and swap */}
              <motion.div
                initial={{ y: 100, scale: 0.8 }}
                animate={{ 
                  y: game.stackAnimation.result?.success === false ? 100 : 0,
                  scale: 1.1,
                }}
                transition={{ 
                  duration: 0.6,
                  type: 'spring',
                  stiffness: 200,
                }}
                className="relative"
              >
                {/* Card back - squeezes out */}
                <motion.div
                  initial={{ scaleX: 1, opacity: 1 }}
                  animate={{ scaleX: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeIn' }}
                  style={{ transformOrigin: 'center' }}
                  className="absolute inset-0"
                >
                  <Card 
                    card={{ ...game.stackAnimation.stacks[0].card, faceUp: false }} 
                    size="lg"
                  />
                </motion.div>
                
                {/* Card front - expands in */}
                <motion.div
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ duration: 0.3, ease: 'easeOut', delay: 0.3 }}
                  style={{ transformOrigin: 'center' }}
                >
                  <Card 
                    card={{ ...game.stackAnimation.stacks[0].card, faceUp: true }} 
                    size="lg"
                  />
                </motion.div>
                
                {/* Player name badge */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="absolute -bottom-10 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-sm font-bold whitespace-nowrap bg-emerald-600 text-white"
                >
                  {game.stackAnimation.stacks[0].playerName}
                </motion.div>
              </motion.div>
              
              {/* Result indicator - X or Checkmark */}
              <AnimatePresence>
                {game.stackAnimation.result && (
                  <motion.div
                    initial={{ scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                  >
                    {game.stackAnimation.result.success ? (
                      <div className="flex flex-col items-center gap-2">
                        <motion.div 
                          className="text-8xl text-green-500 font-black drop-shadow-lg"
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 0.5 }}
                        >
                          ✓
                        </motion.div>
                        <span className="text-2xl font-bold text-green-400">SUCCESS!</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <motion.div 
                          className="text-8xl text-red-500 font-black drop-shadow-lg"
                          animate={{ scale: [1, 1.2, 1], rotate: [0, -5, 5, 0] }}
                          transition={{ duration: 0.5 }}
                        >
                          ✗
                        </motion.div>
                        <span className="text-2xl font-bold text-red-400">MISTACK!</span>
                        <span className="text-sm text-red-300">Drawing penalty card...</span>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              
              {/* "STACK!" text while animating */}
              {!game.stackAnimation.result && (
                <motion.div
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  className="absolute -top-20"
                >
                  <span className="text-5xl font-black text-yellow-400 drop-shadow-lg tracking-wider">
                    STACKING...
                  </span>
                </motion.div>
              )}
              
              {/* (Prompt moved to a subtle pill; no blocking UI here) */}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trigger stack resolution after flip animation */}
      {game.stackAnimation && !game.stackAnimation.result && (
        <StackAnimationResolver />
      )}

      {/* Clear stack animation after showing result */}
      {game.stackAnimation?.result && !game.stackAnimation.result.awaitingCardGive && (
        <StackAnimationClearer />
      )}

      {/* Penalty Card Display Overlay - visible to ALL players */}
      <AnimatePresence>
        {game.penaltyCardDisplay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
            onClick={clearPenaltyCardDisplay}
          >
            <motion.div
              initial={{ scale: 0.5, y: 50 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.5, y: 50, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              className="flex flex-col items-center gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Title */}
              <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-center"
              >
                <div className="text-red-500 text-2xl font-black mb-1">❌ MISSTACK!</div>
                <div className="text-white text-lg">
                  <span className="font-bold text-amber-400">{game.penaltyCardDisplay.playerName}</span> drew a penalty card:
                </div>
              </motion.div>
              
              {/* The penalty card - face up for everyone to see */}
              <motion.div
                initial={{ rotateY: 180, scale: 0.8 }}
                animate={{ rotateY: 0, scale: 1.5 }}
                transition={{ type: 'spring', stiffness: 150, damping: 15, delay: 0.3 }}
                className="relative"
              >
                <Card 
                  card={game.penaltyCardDisplay.card} 
                  size="xl"
                />
                {/* Glow effect */}
                <motion.div
                  animate={{ 
                    boxShadow: ['0 0 20px rgba(239, 68, 68, 0.5)', '0 0 40px rgba(239, 68, 68, 0.8)', '0 0 20px rgba(239, 68, 68, 0.5)']
                  }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="absolute inset-0 rounded-xl pointer-events-none"
                />
              </motion.div>

              {/* Info text */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-center text-gray-300 text-sm"
              >
                This card has been added to {game.penaltyCardDisplay.playerName}&apos;s hand
              </motion.div>

              {/* Dismiss button */}
              <motion.button
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.6 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={clearPenaltyCardDisplay}
                className="px-6 py-2 bg-white/20 hover:bg-white/30 text-white font-medium rounded-lg transition-colors"
              >
                Continue
              </motion.button>
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
              initial={{ scale: 0, rotate: -5 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              className="bg-gradient-to-br from-emerald-800 to-emerald-900 p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4"
            >
              <motion.h2 
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-3xl font-bold text-center text-amber-400 mb-6"
              >
                Game Over!
              </motion.h2>
              
              <div className="space-y-4">
                {game.players
                  .map(p => ({
                    ...p,
                    score: p.cards.reduce((sum, c) => sum + (c.faceUp ? 
                      (c.rank === 'JOKER' ? 0 :
                       c.rank === 'A' ? 1 : 
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
                      transition={{ delay: 0.3 + idx * 0.1 }}
                      className={`
                        flex items-center justify-between p-4 rounded-xl
                        ${idx === 0 ? 'bg-amber-500/30 ring-2 ring-amber-400' : 'bg-white/10'}
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <motion.span 
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: 0.4 + idx * 0.1, type: 'spring' }}
                          className={`
                            w-8 h-8 rounded-full flex items-center justify-center font-bold
                            ${idx === 0 ? 'bg-amber-500 text-amber-950' : 'bg-emerald-700 text-emerald-200'}
                          `}
                        >
                          {idx + 1}
                        </motion.span>
                        <span className="text-white font-medium">
                          {player.name}
                          {player.hasCalledReds && <span className="ml-2 text-red-400">(Called Reds)</span>}
                        </span>
                      </div>
                      <motion.span 
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.5 + idx * 0.1, type: 'spring' }}
                        className={`text-2xl font-bold ${idx === 0 ? 'text-amber-400' : 'text-emerald-300'}`}
                      >
                        {player.score}
                      </motion.span>
                    </motion.div>
                  ))}
              </div>

              <motion.button
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.8 }}
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
